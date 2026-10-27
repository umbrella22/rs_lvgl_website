use crate::{
    program::Diagnostic,
    value::{Result, Value},
    Message,
};
use proc_macro2::Span;
use rs_lvgl_ui::prelude::*;
use std::{collections::BTreeMap, rc::Rc};

#[derive(Clone)]
pub struct NodeSpec {
    name: String,
    args: Vec<Value>,
    span: Span,
    modifiers: Vec<(String, Vec<Value>, Span)>,
}
impl NodeSpec {
    pub fn check_budget(&self, remaining: &mut usize, depth: usize, span: Span) -> Result<()> {
        for value in &self.args {
            value.check_budget(remaining, depth, span)?;
        }
        for (_, args, _) in &self.modifiers {
            for value in args {
                value.check_budget(remaining, depth, span)?;
            }
        }
        Ok(())
    }
}
#[derive(Eq, PartialEq, Ord, PartialOrd)]
pub enum Identity {
    Named(String),
    Id(u64),
}

const CONSTRUCTORS: &[&str] = &[
    "obj", "row", "column", "grid", "label", "button", "switch", "slider", "bar", "arc",
    "checkbox", "textarea", "dropdown", "roller", "spinbox", "spinner", "led",
];
const STYLE_METHODS: &[&str] = &[
    "pad",
    "pad_left",
    "pad_right",
    "pad_top",
    "pad_bottom",
    "gap",
    "radius",
    "width",
    "height",
    "min_width",
    "max_width",
    "min_height",
    "max_height",
    "flex_grow",
    "opacity",
    "bg_opacity",
    "bg",
    "fg",
    "border",
    "offset",
    "hidden",
    "disabled",
    "align",
    "flex_align",
    "text_align",
];
const NODE_METHODS: &[&str] = &[
    "style",
    "key",
    "child",
    "children",
    "grid_cell",
    "on_click",
    "on_value_changed",
    "on_text_changed",
    "on_long_press",
    "checked",
    "clickable",
    "scrollable",
    "focusable",
    "placeholder",
    "password",
    "multiline",
    "keyboard_id",
];

pub fn call_supported(name: &str) -> bool {
    CONSTRUCTORS.contains(&name)
        || matches!(
            name,
            "Style::default"
                | "Style::neutral"
                | "Style::screen"
                | "Style::title"
                | "Style::body"
                | "Style::muted"
                | "Style::surface"
                | "Style::accent"
                | "Size::Px"
                | "Size::Percent"
                | "GridTrack::Px"
                | "GridTrack::Fr"
                | "Key::Id"
                | "Key::Named"
                | "Color::rgb"
        )
}
pub fn method_supported(name: &str) -> bool {
    STYLE_METHODS.contains(&name) || NODE_METHODS.contains(&name)
}
pub fn constant_supported(name: &str) -> bool {
    matches!(
        name,
        "Size::Content"
            | "GridTrack::Content"
            | "Key::Auto"
            | "Align::TopLeft"
            | "Align::TopMid"
            | "Align::TopRight"
            | "Align::LeftMid"
            | "Align::Center"
            | "Align::RightMid"
            | "Align::BottomLeft"
            | "Align::BottomMid"
            | "Align::BottomRight"
            | "FlexAlign::Start"
            | "FlexAlign::End"
            | "FlexAlign::Center"
            | "FlexAlign::SpaceEvenly"
            | "FlexAlign::SpaceAround"
            | "FlexAlign::SpaceBetween"
            | "TextAlign::Auto"
            | "TextAlign::Left"
            | "TextAlign::Center"
            | "TextAlign::Right"
    )
}
fn count(args: &[Value], expected: usize, span: Span) -> Result<()> {
    if args.len() == expected {
        Ok(())
    } else {
        Err(Diagnostic::new(
            "type",
            span,
            format!("Expected {expected} arguments, found {}", args.len()),
        ))
    }
}
fn wrong(span: Span, expected: &str) -> Diagnostic {
    Diagnostic::new("type", span, format!("Expected {expected}"))
}

pub fn call(name: &str, args: Vec<Value>, span: Span) -> Result<Value> {
    if CONSTRUCTORS.contains(&name) {
        return Ok(Value::Node(Rc::new(NodeSpec {
            name: name.into(),
            args,
            span,
            modifiers: vec![],
        })));
    }
    if let Some(preset) = name.strip_prefix("Style::") {
        if preset == "default" || preset == "neutral" {
            count(&args, 0, span)?;
            return Ok(Value::Style(Box::new(if preset == "default" {
                Style::default()
            } else {
                Style::neutral()
            })));
        }
        count(&args, 1, span)?;
        let Value::Theme(theme) = &args[0] else {
            return Err(wrong(span, "Theme"));
        };
        return Ok(Value::Style(Box::new(match preset {
            "screen" => Style::screen(theme),
            "title" => Style::title(theme),
            "body" => Style::body(theme),
            "muted" => Style::muted(theme),
            "surface" => Style::surface(theme),
            "accent" => Style::accent(theme),
            _ => return Err(wrong(span, "a supported style preset")),
        })));
    }
    count(&args, if name == "Color::rgb" { 3 } else { 1 }, span)?;
    match name {
        "Size::Px" | "GridTrack::Px" => {
            args[0].number::<i16>(span)?;
        }
        "Size::Percent" | "GridTrack::Fr" => {
            args[0].number::<u8>(span)?;
        }
        "Key::Id" => {
            args[0].number::<u64>(span)?;
        }
        "Key::Named" => {
            args[0].text(span)?;
        }
        "Color::rgb" => {
            for arg in &args {
                arg.number::<u8>(span)?;
            }
        }
        _ => return Err(wrong(span, "a supported constructor")),
    }
    Ok(Value::Variant(name.into(), args))
}

pub fn method(receiver: Value, name: &str, args: Vec<Value>, span: Span) -> Result<Value> {
    match receiver {
        Value::Style(style) => Ok(Value::Style(Box::new(style_method(
            *style, name, &args, span,
        )?))),
        Value::Node(node) if NODE_METHODS.contains(&name) => {
            let mut node = (*node).clone();
            node.modifiers.push((name.into(), args, span));
            Ok(Value::Node(Rc::new(node)))
        }
        _ => Err(Diagnostic::new(
            "type",
            span,
            format!("{name} is not supported on this value"),
        )),
    }
}
fn size(value: &Value, span: Span) -> Result<Size> {
    match value {
        Value::Variant(name, args) => match name.as_str() {
            "Size::Content" => Ok(Size::Content),
            "Size::Px" => Ok(Size::Px(args[0].number(span)?)),
            "Size::Percent" => Ok(Size::Percent(args[0].number(span)?)),
            _ => Err(wrong(span, "Size")),
        },
        _ => Err(wrong(span, "Size")),
    }
}
fn color(value: &Value, span: Span) -> Result<Color> {
    match value {
        Value::Variant(name, a) if name == "Color::rgb" => Ok(Color::rgb(
            a[0].number(span)?,
            a[1].number(span)?,
            a[2].number(span)?,
        )),
        _ => Err(wrong(span, "Color::rgb(r, g, b)")),
    }
}
macro_rules! enum_value {
    ($value:expr, $span:expr, $kind:ident, $($variant:ident),+) => {{
        match $value {
            Value::Variant(name, a) if a.is_empty() => match name.as_str() { $(concat!(stringify!($kind), "::", stringify!($variant)) => Ok($kind::$variant),)+ _ => Err(wrong($span, stringify!($kind))) },
            _ => Err(wrong($span, stringify!($kind))),
        }
    }};
}
fn style_method(s: Style, name: &str, a: &[Value], span: Span) -> Result<Style> {
    count(
        a,
        if matches!(name, "border" | "offset" | "flex_align") {
            2
        } else {
            1
        },
        span,
    )?;
    Ok(match name {
        "pad" => s.pad(a[0].number(span)?),
        "pad_left" => s.pad_left(a[0].number(span)?),
        "pad_right" => s.pad_right(a[0].number(span)?),
        "pad_top" => s.pad_top(a[0].number(span)?),
        "pad_bottom" => s.pad_bottom(a[0].number(span)?),
        "gap" => s.gap(a[0].number(span)?),
        "radius" => s.radius(a[0].number(span)?),
        "width" => s.width(size(&a[0], span)?),
        "height" => s.height(size(&a[0], span)?),
        "min_width" => s.min_width(size(&a[0], span)?),
        "max_width" => s.max_width(size(&a[0], span)?),
        "min_height" => s.min_height(size(&a[0], span)?),
        "max_height" => s.max_height(size(&a[0], span)?),
        "flex_grow" => s.flex_grow(a[0].number(span)?),
        "opacity" => s.opacity(a[0].number(span)?),
        "bg_opacity" => s.bg_opacity(a[0].number(span)?),
        "bg" => s.bg(color(&a[0], span)?),
        "fg" => s.fg(color(&a[0], span)?),
        "border" => s.border(color(&a[0], span)?, a[1].number(span)?),
        "offset" => s.offset(a[0].number(span)?, a[1].number(span)?),
        "hidden" => s.hidden(a[0].boolean(span)?),
        "disabled" => s.disabled(a[0].boolean(span)?),
        "align" => s.align(enum_value!(
            &a[0],
            span,
            Align,
            TopLeft,
            TopMid,
            TopRight,
            LeftMid,
            Center,
            RightMid,
            BottomLeft,
            BottomMid,
            BottomRight
        )?),
        "text_align" => s.text_align(enum_value!(
            &a[0], span, TextAlign, Auto, Left, Center, Right
        )?),
        "flex_align" => s.flex_align(
            enum_value!(
                &a[0],
                span,
                FlexAlign,
                Start,
                End,
                Center,
                SpaceEvenly,
                SpaceAround,
                SpaceBetween
            )?,
            enum_value!(
                &a[1],
                span,
                FlexAlign,
                Start,
                End,
                Center,
                SpaceEvenly,
                SpaceAround,
                SpaceBetween
            )?,
        ),
        _ => {
            return Err(Diagnostic::new(
                "unsupported",
                span,
                "Unsupported Style method",
            ))
        }
    })
}
fn tracks(value: &Value, span: Span) -> Result<Vec<GridTrack>> {
    value
        .sequence(span)?
        .iter()
        .map(|v| match v {
            Value::Variant(name, a) => match name.as_str() {
                "GridTrack::Content" => Ok(GridTrack::Content),
                "GridTrack::Px" => Ok(GridTrack::Px(a[0].number(span)?)),
                "GridTrack::Fr" => Ok(GridTrack::Fr(a[0].number(span)?)),
                _ => Err(wrong(span, "GridTrack")),
            },
            _ => Err(wrong(span, "GridTrack")),
        })
        .collect()
}
fn children(
    value: &Value,
    span: Span,
    keys: &mut BTreeMap<Identity, u64>,
    budget: &mut usize,
) -> Result<Vec<View<Message>>> {
    value
        .sequence(span)?
        .iter()
        .map(|v| child(v, span, keys, budget))
        .collect()
}
fn child(
    value: &Value,
    span: Span,
    keys: &mut BTreeMap<Identity, u64>,
    budget: &mut usize,
) -> Result<View<Message>> {
    let Value::Node(n) = value else {
        return Err(wrong(span, "View"));
    };
    materialize(n, keys, budget)
}
fn strings(value: &Value, span: Span) -> Result<Vec<String>> {
    value.sequence(span)?.iter().map(|v| v.text(span)).collect()
}

pub fn materialize(
    node: &NodeSpec,
    keys: &mut BTreeMap<Identity, u64>,
    budget: &mut usize,
) -> Result<View<Message>> {
    let s = node.span;
    let a = &node.args;
    *budget = budget
        .checked_sub(1)
        .ok_or_else(|| Diagnostic::new("limit", s, "View limit: 512 nodes"))?;
    count(
        a,
        match node.name.as_str() {
            "obj" | "spinner" => 0,
            "grid" | "slider" | "bar" | "arc" | "spinbox" => 3,
            "checkbox" | "dropdown" | "roller" => 2,
            _ => 1,
        },
        s,
    )?;
    let mut view = match node.name.as_str() {
        "obj" => obj(),
        "spinner" => spinner(),
        "row" => row(children(&a[0], s, keys, budget)?),
        "column" => column(children(&a[0], s, keys, budget)?),
        "grid" => grid(
            tracks(&a[0], s)?,
            tracks(&a[1], s)?,
            children(&a[2], s, keys, budget)?,
        ),
        "label" => label(a[0].text(s)?),
        "button" => button(a[0].text(s)?),
        "switch" => switch(a[0].boolean(s)?),
        "slider" => slider(a[0].number(s)?, a[1].number(s)?, a[2].number(s)?),
        "bar" => bar(a[0].number(s)?, a[1].number(s)?, a[2].number(s)?),
        "arc" => arc(a[0].number(s)?, a[1].number(s)?, a[2].number(s)?),
        "spinbox" => spinbox(a[0].number(s)?, a[1].number(s)?, a[2].number(s)?),
        "checkbox" => checkbox(a[0].text(s)?, a[1].boolean(s)?),
        "textarea" => textarea(a[0].text(s)?),
        "dropdown" => dropdown(strings(&a[0], s)?, a[1].number(s)?),
        "roller" => roller(strings(&a[0], s)?, a[1].number(s)?),
        "led" => led(color(&a[0], s)?),
        _ => return Err(wrong(s, "a supported widget")),
    };
    for (name, a, s) in &node.modifiers {
        let s = *s;
        count(
            a,
            match name.as_str() {
                "grid_cell" => 4,
                "multiline" => 0,
                _ => 1,
            },
            s,
        )?;
        view = match name.as_str() {
            "style" => {
                let Value::Style(style) = &a[0] else {
                    return Err(wrong(s, "Style"));
                };
                view.style(**style)
            }
            "child" => view.child(child(&a[0], s, keys, budget)?),
            "children" => view.children(children(&a[0], s, keys, budget)?),
            "grid_cell" => view.grid_cell(
                a[0].number(s)?,
                a[1].number(s)?,
                a[2].number(s)?,
                a[3].number(s)?,
            ),
            "key" => {
                let Value::Variant(name, values) = &a[0] else {
                    return Err(wrong(s, "Key"));
                };
                let identity = match name.as_str() {
                    "Key::Auto" => None,
                    "Key::Id" => Some(Identity::Id(values[0].number(s)?)),
                    "Key::Named" => Some(Identity::Named(values[0].text(s)?)),
                    _ => return Err(wrong(s, "Key")),
                };
                match identity {
                    None => view.key(Key::Auto),
                    Some(identity) => {
                        if !keys.contains_key(&identity) && keys.len() >= 4096 {
                            return Err(Diagnostic::new(
                                "limit",
                                s,
                                "Key identity limit: 4096 per run",
                            ));
                        }
                        let next = keys.len() as u64;
                        let id = *keys.entry(identity).or_insert(next);
                        view.key(Key::Id(id))
                    }
                }
            }
            "on_click" => view.on_click(Message {
                handler: a[0].clone(),
                argument: None,
            }),
            "on_long_press" => view.on_long_press(Message {
                handler: a[0].clone(),
                argument: None,
            }),
            "on_value_changed" | "on_text_changed" => {
                if !matches!(a[0], Value::Closure(..)) {
                    return Err(wrong(
                        s,
                        "a closure, such as |value| Message::Changed(value)",
                    ));
                }
                let handler = a[0].clone();
                // Native callbacks enqueue data only. Evaluation happens in App::update.
                if name == "on_value_changed" {
                    view.on_value_changed(move |value| Message {
                        handler: handler.clone(),
                        argument: Some(Value::Int(value.into(), Some("i32".into()))),
                    })
                } else {
                    view.on_text_changed(move |value| Message {
                        handler: handler.clone(),
                        argument: Some(Value::Text(value.into())),
                    })
                }
            }
            "checked" => view.checked(a[0].boolean(s)?),
            "clickable" => view.clickable(a[0].boolean(s)?),
            "scrollable" => view.scrollable(a[0].boolean(s)?),
            "focusable" => view.focusable(a[0].boolean(s)?),
            "placeholder" => view.placeholder(a[0].text(s)?),
            "password" => view.password(a[0].boolean(s)?),
            "multiline" => view.multiline(),
            "keyboard_id" => view.keyboard_id(a[0].number(s)?),
            _ => return Err(wrong(s, "a supported View method")),
        };
    }
    Ok(view)
}
