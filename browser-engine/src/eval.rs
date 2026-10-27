use crate::{
    program::{path, Diagnostic, Program},
    ui,
    value::{checked_integer, typed, Env, Result, Value},
};
use proc_macro2::Span;
use std::rc::Rc;
use syn::{spanned::Spanned, BinOp, Expr, Pat, Stmt};

pub struct Evaluator<'a> {
    program: &'a Program,
    operations: usize,
    calls: usize,
    depth: usize,
    pub allow_state_updates: bool,
}
impl<'a> Evaluator<'a> {
    pub fn new(program: &'a Program) -> Self {
        Self {
            program,
            operations: 20_000,
            calls: 0,
            depth: 0,
            allow_state_updates: false,
        }
    }
    fn step(&mut self, span: Span) -> Result<()> {
        self.operations = self.operations.checked_sub(1).ok_or_else(|| {
            Diagnostic::new(
                "limit",
                span,
                "Evaluation limit: 20,000 operations per view or update",
            )
        })?;
        Ok(())
    }
    pub fn bind_parameters(
        &self,
        sig: &syn::Signature,
        values: Vec<Value>,
        env: &mut Env,
    ) -> Result<()> {
        let inputs: Vec<_> = sig
            .inputs
            .iter()
            .filter_map(|i| match i {
                syn::FnArg::Typed(p) => Some(p),
                _ => None,
            })
            .collect();
        if inputs.len() != values.len() {
            return Err(Diagnostic::new(
                "type",
                sig.span(),
                "Incorrect number of arguments",
            ));
        }
        for (parameter, value) in inputs.into_iter().zip(values) {
            bind(&parameter.pat, typed(value, &parameter.ty)?, env)?;
        }
        Ok(())
    }
    pub fn function(&mut self, name: &str, args: Vec<Value>, span: Span) -> Result<Value> {
        self.calls += 1;
        if self.calls > 32 {
            return Err(Diagnostic::new(
                "limit",
                span,
                "Function call depth limit: 32",
            ));
        }
        let function = self
            .program
            .functions
            .get(name)
            .ok_or_else(|| Diagnostic::new("unsupported", span, "Unknown helper function"))?
            .clone();
        let mut env = Env::new();
        self.bind_parameters(&function.sig, args, &mut env)?;
        let result = self.block(&function.block, &mut env);
        self.calls -= 1;
        result
    }
    pub fn closure(&mut self, closure: Value, args: Vec<Value>) -> Result<Value> {
        let Value::Closure(function, mut env) = closure else {
            return Err(Diagnostic::new(
                "type",
                Span::call_site(),
                "Expected an event closure",
            ));
        };
        if function.inputs.len() != args.len() {
            return Err(Diagnostic::new(
                "type",
                function.span(),
                "Incorrect closure argument count",
            ));
        }
        for (pat, value) in function.inputs.iter().zip(args) {
            bind(pat, value, &mut env)?;
        }
        self.expr(&function.body, &mut env)
    }
    pub fn block(&mut self, block: &syn::Block, outer: &mut Env) -> Result<Value> {
        let mut env = outer.clone();
        let mut locals = Env::new();
        let mut result = Value::Unit;
        for stmt in &block.stmts {
            self.step(stmt.span())?;
            match stmt {
                Stmt::Local(local) => {
                    let value = self.expr(&local.init.as_ref().unwrap().expr, &mut env)?;
                    let mut bindings = Env::new();
                    bind(&local.pat, value, &mut bindings)?;
                    locals.extend(bindings.clone());
                    env.extend(bindings);
                    result = Value::Unit;
                }
                Stmt::Expr(expr, semi) => {
                    result = self.expr(expr, &mut env)?;
                    if semi.is_some() {
                        result = Value::Unit;
                    }
                }
                _ => {
                    return Err(Diagnostic::new(
                        "unsupported",
                        stmt.span(),
                        "Unsupported statement",
                    ))
                }
            }
        }
        for (name, value) in outer.iter_mut() {
            if !locals.contains_key(name) {
                *value = env[name].clone();
            }
        }
        Ok(result)
    }
    pub fn expr(&mut self, expr: &Expr, env: &mut Env) -> Result<Value> {
        self.depth += 1;
        if self.depth > 96 {
            return Err(Diagnostic::new(
                "limit",
                expr.span(),
                "Evaluation nesting limit: 96",
            ));
        }
        let result = self.expr_inner(expr, env).and_then(|value| {
            value.check_budget(&mut 4096, 0, expr.span())?;
            Ok(value)
        });
        self.depth -= 1;
        result
    }
    fn expr_inner(&mut self, expr: &Expr, env: &mut Env) -> Result<Value> {
        let span = expr.span();
        self.step(span)?;
        match expr {
            Expr::Lit(l) => match &l.lit {
                syn::Lit::Str(s) => Ok(Value::Text(s.value())),
                syn::Lit::Bool(b) => Ok(Value::Bool(b.value)),
                syn::Lit::Int(i) => checked_integer(
                    i.base10_parse()
                        .map_err(|_| Diagnostic::new("range", span, "Integer literal too large"))?,
                    if i.suffix().is_empty() {
                        None
                    } else {
                        Some(i.suffix().into())
                    },
                    span,
                ),
                _ => Err(Diagnostic::new("type", span, "Unsupported literal")),
            },
            Expr::Path(p) => {
                let name = path(&p.path);
                if let Some(value) = env.get(&name) {
                    return Ok(value.clone());
                }
                if matches!(self.program.structs.get(&name), Some(syn::Fields::Unit)) {
                    return Ok(Value::Record(name, Env::new()));
                }
                if matches!(self.program.variants.get(&name), Some(v) if v.is_empty())
                    || ui::constant_supported(&name)
                {
                    return Ok(Value::Variant(name, vec![]));
                }
                Err(Diagnostic::new(
                    "name",
                    span,
                    format!("Unknown value: {name}"),
                ))
            }
            Expr::Array(a) => {
                if a.elems.len() > 512 {
                    return Err(Diagnostic::new(
                        "limit",
                        span,
                        "Collection limit: 512 items",
                    ));
                }
                Ok(Value::Sequence(
                    a.elems
                        .iter()
                        .map(|x| self.expr(x, env))
                        .collect::<Result<_>>()?,
                ))
            }
            Expr::Tuple(t) => {
                if t.elems.is_empty() {
                    Ok(Value::Unit)
                } else {
                    Ok(Value::Tuple(
                        t.elems
                            .iter()
                            .map(|x| self.expr(x, env))
                            .collect::<Result<_>>()?,
                    ))
                }
            }
            Expr::Paren(p) => self.expr(&p.expr, env),
            Expr::Group(g) => self.expr(&g.expr, env),
            Expr::Reference(r) => self.expr(&r.expr, env),
            Expr::Field(f) => {
                let value = self.expr(&f.base, env)?;
                match (value, &f.member) {
                    (Value::Record(_, fields), syn::Member::Named(name)) => fields
                        .get(&name.to_string())
                        .cloned()
                        .ok_or_else(|| Diagnostic::new("name", span, "Unknown field")),
                    (Value::Tuple(values), syn::Member::Unnamed(index)) => values
                        .get(index.index as usize)
                        .cloned()
                        .ok_or_else(|| Diagnostic::new("range", span, "Tuple index out of bounds")),
                    _ => Err(Diagnostic::new(
                        "type",
                        span,
                        "Expected a struct or tuple field",
                    )),
                }
            }
            Expr::Struct(s) => {
                let name = path(&s.path);
                let fields = self
                    .program
                    .structs
                    .get(&name)
                    .ok_or_else(|| Diagnostic::new("name", span, "Unknown struct"))?
                    .clone();
                let mut values = Env::new();
                for field in &s.fields {
                    let syn::Member::Named(member) = &field.member else {
                        return Err(Diagnostic::new("type", span, "Expected named field"));
                    };
                    let declaration = fields
                        .iter()
                        .find(|f| f.ident.as_ref() == Some(member))
                        .ok_or_else(|| {
                            Diagnostic::new("name", field.span(), "Unknown struct field")
                        })?;
                    let value = typed(self.expr(&field.expr, env)?, &declaration.ty)?;
                    if values.insert(member.to_string(), value).is_some() {
                        return Err(Diagnostic::new(
                            "type",
                            field.span(),
                            "Duplicate struct field",
                        ));
                    }
                }
                if values.len() != fields.len() {
                    return Err(Diagnostic::new("type", span, "Provide every struct field"));
                }
                Ok(Value::Record(name, values))
            }
            Expr::Block(b) => self.block(&b.block, env),
            Expr::If(i) => {
                if self.expr(&i.cond, env)?.boolean(i.cond.span())? {
                    self.block(&i.then_branch, env)
                } else if let Some((_, other)) = &i.else_branch {
                    self.expr(other, env)
                } else {
                    Ok(Value::Unit)
                }
            }
            Expr::Match(m) => {
                let value = self.expr(&m.expr, env)?;
                for arm in &m.arms {
                    let mut bindings = Env::new();
                    if matches_pattern(&arm.pat, &value, &mut bindings)? {
                        let mut local = env.clone();
                        local.extend(bindings.clone());
                        let result = self.expr(&arm.body, &mut local)?;
                        for (key, value) in env.iter_mut() {
                            if !bindings.contains_key(key) {
                                *value = local[key].clone();
                            }
                        }
                        return Ok(result);
                    }
                }
                Err(Diagnostic::new(
                    "type",
                    span,
                    "No match arm handles this value",
                ))
            }
            Expr::Closure(c) => Ok(Value::Closure(Rc::new(c.clone()), env.clone())),
            Expr::Call(c) => {
                let Expr::Path(p) = &*c.func else {
                    return Err(Diagnostic::new(
                        "unsupported",
                        span,
                        "Expected a named function",
                    ));
                };
                let name = path(&p.path);
                let args: Vec<Value> = c
                    .args
                    .iter()
                    .map(|a| self.expr(a, env))
                    .collect::<Result<_>>()?;
                if self.program.functions.contains_key(&name) {
                    return self.function(&name, args, span);
                }
                if let Some(types) = self.program.variants.get(&name) {
                    if types.len() != args.len() {
                        return Err(Diagnostic::new(
                            "type",
                            span,
                            "Incorrect message payload count",
                        ));
                    }
                    return Ok(Value::Variant(
                        name,
                        args.into_iter()
                            .zip(types)
                            .map(|(value, ty)| typed(value, ty))
                            .collect::<Result<_>>()?,
                    ));
                }
                ui::call(&name, args, span)
            }
            Expr::MethodCall(m) => {
                let receiver = self.expr(&m.receiver, env)?;
                let args = m
                    .args
                    .iter()
                    .map(|a| self.expr(a, env))
                    .collect::<Result<Vec<_>>>()?;
                match m.method.to_string().as_str() {
                    "into_iter" if args.is_empty() => Ok(Value::Sequence(receiver.sequence(span)?)),
                    "map" if args.len() == 1 => {
                        let values = receiver.sequence(span)?;
                        let mut mapped = Vec::new();
                        for value in values {
                            mapped.push(self.closure(args[0].clone(), vec![value])?);
                        }
                        Ok(Value::Sequence(mapped))
                    }
                    "clone" if args.is_empty() => Ok(receiver),
                    "to_string" if args.is_empty() => Ok(Value::Text(receiver.display(span)?)),
                    "len" if args.is_empty() => checked_integer(
                        receiver.sequence(span)?.len() as i128,
                        Some("usize".into()),
                        span,
                    ),
                    _ => ui::method(receiver, &m.method.to_string(), args, span),
                }
            }
            Expr::Index(i) => {
                let values = self.expr(&i.expr, env)?.sequence(span)?;
                let index = self.expr(&i.index, env)?.number::<usize>(span)?;
                values
                    .get(index)
                    .cloned()
                    .ok_or_else(|| Diagnostic::new("range", span, "Array index out of bounds"))
            }
            Expr::Unary(u) => {
                // Rust permits signed minima such as -128i8: the magnitude
                // must be negated before checking the suffixed integer type.
                if matches!(u.op, syn::UnOp::Neg(_)) {
                    if let Expr::Lit(syn::ExprLit {
                        lit: syn::Lit::Int(literal),
                        ..
                    }) = &*u.expr
                    {
                        let magnitude = literal.base10_parse::<i128>().map_err(|_| {
                            Diagnostic::new("range", span, "Integer literal too large")
                        })?;
                        let kind =
                            (!literal.suffix().is_empty()).then(|| literal.suffix().to_string());
                        return checked_integer(-magnitude, kind, span);
                    }
                }
                let value = self.expr(&u.expr, env)?;
                match (&u.op, value) {
                    (syn::UnOp::Not(_), Value::Bool(v)) => Ok(Value::Bool(!v)),
                    (syn::UnOp::Neg(_), Value::Int(v, ty)) => checked_integer(
                        v.checked_neg()
                            .ok_or_else(|| Diagnostic::new("range", span, "Integer overflow"))?,
                        ty,
                        span,
                    ),
                    _ => Err(Diagnostic::new(
                        "type",
                        span,
                        "Expected a boolean for ! or integer for -",
                    )),
                }
            }
            Expr::Binary(b) => {
                let left = self.expr(&b.left, env)?;
                if matches!(b.op, BinOp::And(_)) && !left.boolean(span)? {
                    return Ok(Value::Bool(false));
                }
                if matches!(b.op, BinOp::Or(_)) && left.boolean(span)? {
                    return Ok(Value::Bool(true));
                }
                let right = self.expr(&b.right, env)?;
                let value = binary(left, &b.op, right, span)?;
                if matches!(
                    b.op,
                    BinOp::AddAssign(_) | BinOp::SubAssign(_) | BinOp::MulAssign(_)
                ) {
                    self.assign(&b.left, value, env)?;
                    Ok(Value::Unit)
                } else {
                    Ok(value)
                }
            }
            Expr::Assign(a) => {
                let value = self.expr(&a.right, env)?;
                self.assign(&a.left, value, env)?;
                Ok(Value::Unit)
            }
            Expr::Macro(m) => self.format(&m.mac, env),
            _ => Err(Diagnostic::new(
                "unsupported",
                span,
                "Unsupported expression",
            )),
        }
    }
    fn assign(&self, target: &Expr, value: Value, env: &mut Env) -> Result<()> {
        match target {
            Expr::Field(f) if matches!(&*f.base, Expr::Path(p) if p.path.is_ident("self")) => {
                if !self.allow_state_updates {
                    return Err(Diagnostic::new(
                        "type",
                        target.span(),
                        "State may only change in update()",
                    ));
                }
                let syn::Member::Named(member) = &f.member else {
                    return Err(Diagnostic::new(
                        "type",
                        target.span(),
                        "Expected named state field",
                    ));
                };
                let Some(Value::Record(name, fields)) = env.get_mut("self") else {
                    return Err(Diagnostic::new("type", target.span(), "No App state"));
                };
                let declaration = self.program.structs[name]
                    .iter()
                    .find(|field| field.ident.as_ref() == Some(member))
                    .ok_or_else(|| Diagnostic::new("name", target.span(), "Unknown state field"))?;
                fields.insert(
                    member.to_string(),
                    typed(value, &declaration.ty).map_err(|mut e| {
                        let location = Diagnostic::new(e.kind, target.span(), "");
                        e.line = location.line;
                        e.column = location.column;
                        e.end_line = location.end_line;
                        e.end_column = location.end_column;
                        e
                    })?,
                );
                Ok(())
            }
            Expr::Path(p) if !p.path.is_ident("self") => {
                let slot = env.get_mut(&path(&p.path)).ok_or_else(|| {
                    Diagnostic::new("name", target.span(), "Unknown local variable")
                })?;
                if std::mem::discriminant(slot) != std::mem::discriminant(&value) {
                    return Err(Diagnostic::new(
                        "type",
                        target.span(),
                        "Assignment changes the variable type",
                    ));
                }
                *slot = if let Value::Int(_, ty) = slot {
                    checked_integer(value.integer(target.span())?, ty.clone(), target.span())?
                } else {
                    value
                };
                Ok(())
            }
            _ => Err(Diagnostic::new(
                "unsupported",
                target.span(),
                "Assign a local variable or self.field in update()",
            )),
        }
    }
    fn format(&mut self, mac: &syn::Macro, env: &mut Env) -> Result<Value> {
        let expressions = mac
            .parse_body_with(syn::punctuated::Punctuated::<Expr, syn::Token![,]>::parse_terminated)
            .map_err(|e| Diagnostic::new("syntax", e.span(), e.to_string()))?;
        let mut expressions = expressions.iter();
        let Some(Expr::Lit(syn::ExprLit {
            lit: syn::Lit::Str(template),
            ..
        })) = expressions.next()
        else {
            return Err(Diagnostic::new(
                "unsupported",
                mac.span(),
                "format! requires a literal format string",
            ));
        };
        let args = expressions
            .map(|e| self.expr(e, env))
            .collect::<Result<Vec<_>>>()?;
        let mut index = 0;
        let mut output = String::new();
        let text = template.value();
        let mut chars = text.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '{' {
                if chars.peek() == Some(&'{') {
                    chars.next();
                    output.push('{');
                    continue;
                }
                let mut name = String::new();
                let mut closed = false;
                for c in chars.by_ref() {
                    if c == '}' {
                        closed = true;
                        break;
                    }
                    name.push(c);
                }
                if !closed {
                    return Err(Diagnostic::new(
                        "syntax",
                        mac.span(),
                        "Unclosed format placeholder",
                    ));
                }
                let value = if name.is_empty() {
                    let value = args.get(index);
                    index += 1;
                    value
                } else {
                    env.get(&name)
                };
                output.push_str(&value.ok_or_else(|| Diagnostic::new("name", mac.span(), "Use {} with an argument or {name} with a local variable; format specifiers are not supported"))?.display(mac.span())?);
            } else if c == '}' {
                if chars.next() != Some('}') {
                    return Err(Diagnostic::new(
                        "syntax",
                        mac.span(),
                        "Unmatched } in format string",
                    ));
                }
                output.push('}');
            } else {
                output.push(c);
            }
            if output.len() > 16_384 {
                return Err(Diagnostic::new(
                    "limit",
                    mac.span(),
                    "Formatted text limit: 16 KiB",
                ));
            }
        }
        if index != args.len() {
            return Err(Diagnostic::new(
                "type",
                mac.span(),
                "Unused format arguments",
            ));
        }
        Ok(Value::Text(output))
    }
}

fn bind(pattern: &Pat, value: Value, env: &mut Env) -> Result<()> {
    if matches_pattern(pattern, &value, env)? {
        Ok(())
    } else {
        Err(Diagnostic::new(
            "type",
            pattern.span(),
            "Pattern does not match the value",
        ))
    }
}
fn matches_pattern(pattern: &Pat, value: &Value, env: &mut Env) -> Result<bool> {
    Ok(match (pattern, value) {
        (Pat::Wild(_), _) => true,
        (Pat::Ident(i), _) => {
            env.insert(i.ident.to_string(), value.clone());
            true
        }
        (Pat::Type(t), _) => {
            bind(&t.pat, typed(value.clone(), &t.ty)?, env)?;
            true
        }
        (Pat::Tuple(t), Value::Unit) => t.elems.is_empty(),
        (Pat::Tuple(t), Value::Tuple(v)) if t.elems.len() == v.len() => {
            for (pat, value) in t.elems.iter().zip(v) {
                if !matches_pattern(pat, value, env)? {
                    return Ok(false);
                }
            }
            true
        }
        (Pat::TupleStruct(t), Value::Variant(name, v))
            if path(&t.path) == *name && t.elems.len() == v.len() =>
        {
            for (pat, value) in t.elems.iter().zip(v) {
                if !matches_pattern(pat, value, env)? {
                    return Ok(false);
                }
            }
            true
        }
        (Pat::Path(p), Value::Variant(name, v)) => path(&p.path) == *name && v.is_empty(),
        (Pat::Lit(l), Value::Bool(b)) => matches!(&l.lit, syn::Lit::Bool(v) if v.value == *b),
        (Pat::Lit(l), Value::Int(n, _)) => {
            matches!(&l.lit, syn::Lit::Int(v) if v.base10_parse::<i128>().ok() == Some(*n))
        }
        _ => false,
    })
}
fn binary(left: Value, op: &BinOp, right: Value, span: Span) -> Result<Value> {
    match (&left, &right) {
        (Value::Bool(a), Value::Bool(b)) => {
            return match op {
                BinOp::And(_) => Ok(Value::Bool(*a && *b)),
                BinOp::Or(_) => Ok(Value::Bool(*a || *b)),
                BinOp::Eq(_) => Ok(Value::Bool(a == b)),
                BinOp::Ne(_) => Ok(Value::Bool(a != b)),
                _ => Err(Diagnostic::new(
                    "type",
                    span,
                    "Unsupported boolean operation",
                )),
            }
        }
        (Value::Text(a), Value::Text(b)) => {
            return match op {
                BinOp::Eq(_) => Ok(Value::Bool(a == b)),
                BinOp::Ne(_) => Ok(Value::Bool(a != b)),
                _ => Err(Diagnostic::new(
                    "type",
                    span,
                    "Only == and != are supported for strings",
                )),
            }
        }
        _ => (),
    }
    let (Value::Int(a, ta), Value::Int(b, tb)) = (left, right) else {
        return Err(Diagnostic::new(
            "type",
            span,
            "Operation requires matching scalar types",
        ));
    };
    if ta.is_some() && tb.is_some() && ta != tb {
        return Err(Diagnostic::new("type", span, "Integer types do not match"));
    }
    let ty = ta.or(tb);
    // An unsuffixed operand must also fit the inferred type before arithmetic.
    checked_integer(a, ty.clone(), span)?;
    checked_integer(b, ty.clone(), span)?;
    let n = match op {
        BinOp::Eq(_) => return Ok(Value::Bool(a == b)),
        BinOp::Ne(_) => return Ok(Value::Bool(a != b)),
        BinOp::Lt(_) => return Ok(Value::Bool(a < b)),
        BinOp::Le(_) => return Ok(Value::Bool(a <= b)),
        BinOp::Gt(_) => return Ok(Value::Bool(a > b)),
        BinOp::Ge(_) => return Ok(Value::Bool(a >= b)),
        BinOp::Add(_) | BinOp::AddAssign(_) => a.checked_add(b),
        BinOp::Sub(_) | BinOp::SubAssign(_) => a.checked_sub(b),
        BinOp::Mul(_) | BinOp::MulAssign(_) => a.checked_mul(b),
        BinOp::Div(_) => a.checked_div(b),
        BinOp::Rem(_) => a.checked_rem(b),
        _ => None,
    }
    .ok_or_else(|| Diagnostic::new("range", span, "Integer overflow or division by zero"))?;
    checked_integer(n, ty, span)
}
