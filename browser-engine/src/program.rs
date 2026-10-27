use crate::{ui, value::Result};
use proc_macro2::Span;
use std::collections::BTreeMap;
use syn::{
    spanned::Spanned,
    visit::{self, Visit},
    Expr, ImplItem, Item,
};

pub const MAX_SOURCE_BYTES: usize = 32_768;

#[derive(Clone, Debug)]
pub struct Diagnostic {
    pub kind: &'static str,
    pub message: String,
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
}
impl Diagnostic {
    pub fn new(kind: &'static str, span: Span, message: impl Into<String>) -> Self {
        let start = span.start();
        let end = span.end();
        Self {
            kind,
            message: message.into(),
            line: start.line.max(1) as u32,
            column: start.column as u32 + 1,
            end_line: end.line.max(1) as u32,
            end_column: end.column as u32 + 1,
        }
    }
}
impl std::fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}: {}", self.line, self.column, self.message)
    }
}

pub fn path(path: &syn::Path) -> String {
    path.segments
        .iter()
        .map(|s| s.ident.to_string())
        .collect::<Vec<_>>()
        .join("::")
}

pub struct Program {
    pub functions: BTreeMap<String, syn::ItemFn>,
    pub structs: BTreeMap<String, syn::Fields>,
    pub variants: BTreeMap<String, Vec<syn::Type>>,
    pub app_type: String,
    pub view: syn::ImplItemFn,
    pub update: syn::ImplItemFn,
}
impl Program {
    pub fn entry_span(&self) -> Span {
        self.view.block.span()
    }
    pub fn parse(source: &str) -> Result<Self> {
        if source.len() > MAX_SOURCE_BYTES {
            return Err(Diagnostic::new(
                "limit",
                Span::call_site(),
                "Source limit: 32 KiB",
            ));
        }
        lexical_budget(source)?;
        let file = syn::parse_file(source)
            .map_err(|e| Diagnostic::new("syntax", e.span(), e.to_string()))?;
        let mut functions = BTreeMap::new();
        let mut structs = BTreeMap::new();
        let mut variants = BTreeMap::new();
        let mut app_type = None;
        let mut view = None;
        let mut update = None;
        for item in &file.items {
            let declaration = match item {
                Item::Struct(s) => Some(&s.ident),
                Item::Enum(e) => Some(&e.ident),
                _ => None,
            };
            if let Some(name) = declaration {
                if matches!(
                    name.to_string().as_str(),
                    "App"
                        | "Theme"
                        | "Style"
                        | "View"
                        | "Key"
                        | "Size"
                        | "GridTrack"
                        | "Color"
                        | "Align"
                        | "FlexAlign"
                        | "TextAlign"
                ) {
                    return Err(Diagnostic::new(
                        "unsupported",
                        name.span(),
                        "Choose an application type name that does not shadow the UI API",
                    ));
                }
            }
            match item {
                Item::Use(u) => {
                    fn valid(tree: &syn::UseTree) -> bool {
                        match tree {
                            syn::UseTree::Path(p) => valid(&p.tree),
                            syn::UseTree::Name(_) | syn::UseTree::Glob(_) => true,
                            syn::UseTree::Group(g) => g.items.iter().all(valid),
                            _ => false,
                        }
                    }
                    if !matches!(&u.tree, syn::UseTree::Path(p) if p.ident == "rs_lvgl_ui" && valid(&p.tree))
                    {
                        return Err(Diagnostic::new(
                            "unsupported",
                            u.span(),
                            "Only rs_lvgl_ui imports without aliases are supported",
                        ));
                    }
                }
                Item::Struct(s)
                    if s.generics.params.is_empty()
                        && !matches!(s.fields, syn::Fields::Unnamed(_)) =>
                {
                    if structs
                        .insert(s.ident.to_string(), s.fields.clone())
                        .is_some()
                    {
                        return Err(Diagnostic::new("syntax", s.span(), "Duplicate struct"));
                    }
                }
                Item::Enum(e) if e.generics.params.is_empty() => {
                    for v in &e.variants {
                        if v.discriminant.is_some() || matches!(v.fields, syn::Fields::Named(_)) {
                            return Err(Diagnostic::new(
                                "unsupported",
                                v.span(),
                                "Use unit or tuple message variants",
                            ));
                        }
                        if variants
                            .insert(
                                format!("{}::{}", e.ident, v.ident),
                                v.fields.iter().map(|f| f.ty.clone()).collect(),
                            )
                            .is_some()
                        {
                            return Err(Diagnostic::new("syntax", v.span(), "Duplicate variant"));
                        }
                    }
                }
                Item::Fn(f) => {
                    if functions
                        .insert(f.sig.ident.to_string(), f.clone())
                        .is_some()
                    {
                        return Err(Diagnostic::new("syntax", f.span(), "Duplicate function"));
                    }
                }
                Item::Impl(i)
                    if i.unsafety.is_none()
                        && i.generics.params.is_empty()
                        && matches!(&i.trait_, Some((None, p, _)) if path(p) == "App" || path(p) == "rs_lvgl_ui::App") =>
                {
                    let syn::Type::Path(t) = &*i.self_ty else {
                        return Err(Diagnostic::new(
                            "unsupported",
                            i.span(),
                            "App needs a named struct",
                        ));
                    };
                    if app_type.replace(path(&t.path)).is_some() {
                        return Err(Diagnostic::new(
                            "unsupported",
                            i.span(),
                            "Use exactly one App implementation",
                        ));
                    }
                    let mut message_type = false;
                    for member in &i.items {
                        match member {
                            ImplItem::Fn(f) if f.sig.ident == "view" && view.is_none() => {
                                view = Some(f.clone())
                            }
                            ImplItem::Fn(f) if f.sig.ident == "update" && update.is_none() => {
                                update = Some(f.clone())
                            }
                            ImplItem::Type(t) if t.ident == "Msg" && !message_type => {
                                message_type = true
                            }
                            _ => {
                                return Err(Diagnostic::new(
                                    "unsupported",
                                    member.span(),
                                    "App supports Msg, view and update in the browser",
                                ))
                            }
                        }
                    }
                    if !message_type {
                        return Err(Diagnostic::new("syntax", i.span(), "App requires type Msg"));
                    }
                }
                _ => {
                    return Err(Diagnostic::new(
                        "unsupported",
                        item.span(),
                        "Supported items: use, struct, enum, helper functions and impl App",
                    ))
                }
            }
        }
        let missing = || {
            Diagnostic::new(
                "syntax",
                file.span(),
                "Provide fn app() and one App with view() and update()",
            )
        };
        if !functions.contains_key("app") {
            return Err(missing());
        }
        let program = Self {
            functions,
            structs,
            variants,
            app_type: app_type.ok_or_else(missing)?,
            view: view.ok_or_else(missing)?,
            update: update.ok_or_else(missing)?,
        };
        let mut validator = Validator {
            program: &program,
            error: None,
            depth: 0,
        };
        validator.visit_file(&file);
        if let Some(error) = validator.error {
            return Err(error);
        }
        Ok(program)
    }
}

struct Validator<'a> {
    program: &'a Program,
    error: Option<Diagnostic>,
    depth: usize,
}
impl Validator<'_> {
    fn reject(&mut self, span: Span, message: &str) {
        if self.error.is_none() {
            self.error = Some(Diagnostic::new("unsupported", span, message));
        }
    }
}
impl<'ast> Visit<'ast> for Validator<'_> {
    fn visit_attribute(&mut self, attr: &'ast syn::Attribute) {
        if !attr.path().is_ident("derive")
            || attr
                .parse_args_with(
                    syn::punctuated::Punctuated::<syn::Path, syn::Token![,]>::parse_terminated,
                )
                .map_or(true, |v| v.iter().any(|p| !p.is_ident("Clone")))
        {
            self.reject(attr.span(), "Only #[derive(Clone)] is supported");
        }
    }
    fn visit_signature(&mut self, sig: &'ast syn::Signature) {
        if sig.asyncness.is_some()
            || sig.unsafety.is_some()
            || sig.constness.is_some()
            || sig.abi.is_some()
            || sig.variadic.is_some()
            || sig.generics.where_clause.is_some()
        {
            self.reject(
                sig.span(),
                "Use ordinary synchronous functions without unsafe or where clauses",
            );
        }
        for parameter in &sig.generics.params {
            if !matches!(parameter, syn::GenericParam::Type(t) if t.bounds.is_empty() && t.default.is_none())
            {
                self.reject(
                    parameter.span(),
                    "Only unbounded type parameters are supported",
                );
            }
        }
        visit::visit_signature(self, sig);
    }
    fn visit_type(&mut self, ty: &'ast syn::Type) {
        if !matches!(
            ty,
            syn::Type::Path(_)
                | syn::Type::Reference(_)
                | syn::Type::Tuple(_)
                | syn::Type::ImplTrait(_)
        ) {
            self.reject(ty.span(), "This type is not supported in the browser");
        }
        visit::visit_type(self, ty);
    }
    fn visit_pat(&mut self, pat: &'ast syn::Pat) {
        if !matches!(pat, syn::Pat::Ident(p) if p.by_ref.is_none() && p.subpat.is_none())
            && !matches!(
                pat,
                syn::Pat::Wild(_)
                    | syn::Pat::Tuple(_)
                    | syn::Pat::TupleStruct(_)
                    | syn::Pat::Path(_)
                    | syn::Pat::Type(_)
                    | syn::Pat::Lit(_)
            )
        {
            self.reject(
                pat.span(),
                "Use a name, tuple, literal or message variant pattern",
            );
        }
        visit::visit_pat(self, pat);
    }
    fn visit_stmt(&mut self, stmt: &'ast syn::Stmt) {
        if matches!(stmt, syn::Stmt::Item(_) | syn::Stmt::Macro(_)) {
            self.reject(
                stmt.span(),
                "Nested items and statement macros are not supported",
            );
        }
        if matches!(stmt, syn::Stmt::Local(l) if l.init.as_ref().is_none_or(|i| i.diverge.is_some()))
        {
            self.reject(
                stmt.span(),
                "let requires a value; let-else is not supported",
            );
        }
        visit::visit_stmt(self, stmt);
    }
    fn visit_expr(&mut self, expr: &'ast Expr) {
        if self.error.is_some() {
            return;
        }
        self.depth += 1;
        if self.depth > 64 {
            self.reject(expr.span(), "Expression nesting limit: 64");
            self.depth -= 1;
            return;
        }
        match expr {
            Expr::Lit(l) if matches!(l.lit, syn::Lit::Str(_) | syn::Lit::Bool(_) | syn::Lit::Int(_)) => (),
            Expr::Path(p) => {
                let name = path(&p.path);
                if p.qself.is_some() || (name.contains("::") && !self.program.variants.contains_key(&name) && !ui::constant_supported(&name) && !ui::call_supported(&name)) {
                    self.reject(p.span(), "This qualified value is outside the supported UI API");
                }
            }
            Expr::Array(_) | Expr::Tuple(_) | Expr::Paren(_) | Expr::Group(_) | Expr::Reference(_) | Expr::Field(_) | Expr::Block(_) | Expr::If(_) | Expr::Assign(_) | Expr::Index(_) => (),
            Expr::Struct(s) if s.rest.is_none() && s.qself.is_none() => (),
            Expr::Closure(c) if c.asyncness.is_none() && c.movability.is_none() && c.constness.is_none() && c.lifetimes.is_none() => (),
            Expr::Match(m) if m.arms.iter().all(|a| a.guard.is_none()) => (),
            Expr::Unary(u) if matches!(u.op, syn::UnOp::Neg(_) | syn::UnOp::Not(_)) => (),
            Expr::Binary(b) if matches!(b.op, syn::BinOp::Add(_) | syn::BinOp::Sub(_) | syn::BinOp::Mul(_) | syn::BinOp::Div(_) | syn::BinOp::Rem(_) | syn::BinOp::AddAssign(_) | syn::BinOp::SubAssign(_) | syn::BinOp::MulAssign(_) | syn::BinOp::Eq(_) | syn::BinOp::Ne(_) | syn::BinOp::Lt(_) | syn::BinOp::Le(_) | syn::BinOp::Gt(_) | syn::BinOp::Ge(_) | syn::BinOp::And(_) | syn::BinOp::Or(_)) => (),
            Expr::Call(c) => {
                if !matches!(&*c.func, Expr::Path(p) if p.qself.is_none() && (self.program.functions.contains_key(&path(&p.path)) || self.program.variants.contains_key(&path(&p.path)) || ui::call_supported(&path(&p.path)))) {
                    self.reject(c.func.span(), "This function is not supported in the browser; use the local compiler for full Rust");
                }
            }
            Expr::MethodCall(c) if ui::method_supported(&c.method.to_string()) || matches!(&*c.method.to_string(), "into_iter" | "map" | "to_string" | "clone" | "len") => (),
            Expr::Macro(m) if m.mac.path.is_ident("format") => {
                match m.mac.parse_body_with(syn::punctuated::Punctuated::<Expr, syn::Token![,]>::parse_terminated) {
                    Ok(arguments) => for arg in &arguments { self.visit_expr(arg); },
                    Err(e) => self.reject(e.span(), "Invalid format! arguments"),
                }
            }
            _ => self.reject(expr.span(), "This expression is not supported in the browser; loops, casts, unsafe and arbitrary macros require the local compiler"),
        }
        visit::visit_expr(self, expr);
        self.depth -= 1;
    }
}

// Bound parser recursion before handing source to syn. Strings and comments do
// not contribute delimiter nesting; the real parser still validates syntax.
fn lexical_budget(source: &str) -> Result<()> {
    let bytes = source.as_bytes();
    let mut i = 0;
    let mut depth = 0usize;
    while i < bytes.len() {
        if bytes[i..].starts_with(b"//") {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
        } else if bytes[i..].starts_with(b"/*") {
            i += 2;
            let mut comments = 1;
            while i < bytes.len() && comments > 0 {
                if bytes[i..].starts_with(b"/*") {
                    comments += 1;
                    i += 2;
                } else if bytes[i..].starts_with(b"*/") {
                    comments -= 1;
                    i += 2;
                } else {
                    i += 1;
                }
            }
        } else if bytes[i] == b'r' && {
            let mut end = i + 1;
            while bytes.get(end) == Some(&b'#') {
                end += 1;
            }
            bytes.get(end) == Some(&b'"')
        } {
            let mut end = i + 1;
            while bytes.get(end) == Some(&b'#') {
                end += 1;
            }
            let hashes = end - i - 1;
            i = end + 1;
            while i < bytes.len() {
                if bytes[i] == b'"'
                    && bytes
                        .get(i + 1..i + 1 + hashes)
                        .is_some_and(|suffix| suffix.iter().all(|c| *c == b'#'))
                {
                    i += hashes + 1;
                    break;
                }
                i += 1;
            }
        } else if bytes[i] == b'"' {
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'\\' {
                    i = (i + 2).min(bytes.len());
                } else if bytes[i] == b'"' {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }
        } else {
            if matches!(bytes[i], b'(' | b'[' | b'{') {
                depth += 1;
                if depth > 64 {
                    let prefix = &source[..i];
                    let line = prefix.bytes().filter(|b| *b == b'\n').count() as u32 + 1;
                    let column = prefix.rsplit('\n').next().unwrap().chars().count() as u32 + 1;
                    return Err(Diagnostic {
                        kind: "limit",
                        message: "Source nesting limit: 64".into(),
                        line,
                        column,
                        end_line: line,
                        end_column: column + 1,
                    });
                }
            } else if matches!(bytes[i], b')' | b']' | b'}') {
                depth = depth.saturating_sub(1);
            }
            i += 1;
        }
    }
    Ok(())
}
