use crate::program::Diagnostic;
use proc_macro2::Span;
use rs_lvgl_ui::{Style, Theme};
use std::{collections::BTreeMap, rc::Rc};
use syn::{spanned::Spanned, Type};

pub type Env = BTreeMap<String, Value>;
pub type Result<T> = std::result::Result<T, Diagnostic>;

#[derive(Clone)]
pub enum Value {
    Unit,
    Bool(bool),
    Int(i128, Option<String>),
    Text(String),
    Sequence(Vec<Value>),
    Tuple(Vec<Value>),
    Record(String, Env),
    Variant(String, Vec<Value>),
    Theme(Theme),
    Style(Box<Style>),
    Node(Rc<crate::ui::NodeSpec>),
    Closure(Rc<syn::ExprClosure>, Env),
}

impl Value {
    pub fn check_budget(&self, remaining: &mut usize, depth: usize, span: Span) -> Result<()> {
        if depth > 64 || *remaining == 0 {
            return Err(Diagnostic::new(
                "limit",
                span,
                "Value limit: 4096 entries and 64 levels",
            ));
        }
        *remaining -= 1;
        match self {
            Self::Text(text) if text.len() > 16_384 => {
                return Err(Diagnostic::new("limit", span, "Text limit: 16 KiB"))
            }
            Self::Sequence(values) | Self::Tuple(values) | Self::Variant(_, values) => {
                if values.len() > 512 {
                    return Err(Diagnostic::new(
                        "limit",
                        span,
                        "Collection limit: 512 items",
                    ));
                }
                for value in values {
                    value.check_budget(remaining, depth + 1, span)?;
                }
            }
            Self::Record(_, fields) | Self::Closure(_, fields) => {
                for value in fields.values() {
                    value.check_budget(remaining, depth + 1, span)?;
                }
            }
            Self::Node(node) => node.check_budget(remaining, depth + 1, span)?,
            _ => (),
        }
        Ok(())
    }

    pub fn integer(&self, span: Span) -> Result<i128> {
        match self {
            Self::Int(n, _) => Ok(*n),
            _ => Err(Diagnostic::new("type", span, "Expected an integer")),
        }
    }
    pub fn number<T: TryFrom<i128>>(&self, span: Span) -> Result<T> {
        T::try_from(self.integer(span)?).map_err(|_| {
            Diagnostic::new(
                "range",
                span,
                format!("Value is outside {} range", std::any::type_name::<T>()),
            )
        })
    }
    pub fn boolean(&self, span: Span) -> Result<bool> {
        match self {
            Self::Bool(v) => Ok(*v),
            _ => Err(Diagnostic::new("type", span, "Expected bool")),
        }
    }
    pub fn text(&self, span: Span) -> Result<String> {
        match self {
            Self::Text(v) => Ok(v.clone()),
            _ => Err(Diagnostic::new("type", span, "Expected a string")),
        }
    }
    pub fn display(&self, span: Span) -> Result<String> {
        match self {
            Self::Text(v) => Ok(v.clone()),
            Self::Int(v, _) => Ok(v.to_string()),
            Self::Bool(v) => Ok(v.to_string()),
            _ => Err(Diagnostic::new(
                "type",
                span,
                "Only strings, integers and booleans can be formatted",
            )),
        }
    }
    pub fn sequence(&self, span: Span) -> Result<Vec<Value>> {
        match self {
            Self::Sequence(v) => Ok(v.clone()),
            _ => Err(Diagnostic::new(
                "type",
                span,
                "Expected an array or mapped iterator",
            )),
        }
    }
}

pub fn integer_type(name: &str) -> Option<(i128, i128)> {
    Some(match name {
        "i8" => (i8::MIN.into(), i8::MAX.into()),
        "i16" => (i16::MIN.into(), i16::MAX.into()),
        "i32" | "isize" => (i32::MIN.into(), i32::MAX.into()),
        "i64" => (i64::MIN.into(), i64::MAX.into()),
        "u8" => (0, u8::MAX.into()),
        "u16" => (0, u16::MAX.into()),
        "u32" | "usize" => (0, u32::MAX.into()),
        "u64" => (0, u64::MAX.into()),
        _ => return None,
    })
}

pub fn checked_integer(n: i128, kind: Option<String>, span: Span) -> Result<Value> {
    if let Some(ref kind) = kind {
        let (min, max) = integer_type(kind).ok_or_else(|| {
            Diagnostic::new(
                "unsupported",
                span,
                "Supported integer types: i8..i64, u8..u64, isize, usize (32-bit)",
            )
        })?;
        if n < min || n > max {
            return Err(Diagnostic::new(
                "range",
                span,
                format!("{n} is outside {kind} range"),
            ));
        }
    }
    Ok(Value::Int(n, kind))
}

pub fn typed(value: Value, ty: &Type) -> Result<Value> {
    let span = ty.span();
    if let Type::Reference(reference) = ty {
        return typed(value, &reference.elem);
    }
    let valid = match ty {
        Type::Tuple(t) => match &value {
            Value::Unit => t.elems.is_empty(),
            Value::Tuple(v) if v.len() == t.elems.len() => {
                return Ok(Value::Tuple(
                    v.iter()
                        .cloned()
                        .zip(&t.elems)
                        .map(|(value, ty)| typed(value, ty))
                        .collect::<Result<_>>()?,
                ));
            }
            _ => false,
        },
        Type::Path(t) => {
            let name = t.path.segments.last().unwrap().ident.to_string();
            if integer_type(&name).is_some() {
                if let Value::Int(_, Some(ref previous)) = value {
                    if previous != &name {
                        return Err(Diagnostic::new(
                            "type",
                            span,
                            format!("Expected {name}, found {previous}"),
                        ));
                    }
                }
                return checked_integer(value.integer(span)?, Some(name), span);
            }
            match (&*name, &value) {
                ("bool", Value::Bool(_))
                | ("str" | "String", Value::Text(_))
                | ("Theme", Value::Theme(_))
                | ("Style", Value::Style(_))
                | ("View", Value::Node(_)) => true,
                (name, Value::Record(record, _)) => name == record,
                (name, Value::Variant(variant, _)) => variant.starts_with(&format!("{name}::")),
                _ => false,
            }
        }
        _ => false,
    };
    if valid {
        Ok(value)
    } else {
        Err(Diagnostic::new(
            "type",
            span,
            "Value does not match the declared supported type",
        ))
    }
}
