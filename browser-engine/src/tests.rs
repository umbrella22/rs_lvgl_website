use super::*;
use crate::value::Value;

const SWITCH: &str = include_str!("../../playground/apps/switch.rs");
const WRAPPER: &str = include_str!("../../playground/view-app.rs");
fn screen(expression: &str) -> String {
    format!("use rs_lvgl_ui::prelude::*;\nfn view(theme: &Theme) -> View<()> {{ {expression} }}\n{WRAPPER}")
}
fn error(source: &str) -> Diagnostic {
    match InterpretedApp::new(source) {
        Err(error) => error,
        Ok(app) => match app.render(&Theme::light()) {
            Err(error) => error,
            Ok(_) => panic!("Expected diagnostic"),
        },
    }
}
#[test]
fn all_documentation_examples_evaluate() {
    for example in ["column", "controls", "grid", "keyed-list", "row", "title"] {
        let text = std::fs::read_to_string(format!("../playground/examples/{example}.rs")).unwrap();
        let app = InterpretedApp::new(&format!("{text}\n{WRAPPER}")).unwrap();
        app.render(&Theme::light()).unwrap();
        app.render(&Theme::dark()).unwrap();
    }
    InterpretedApp::new(SWITCH)
        .unwrap()
        .render(&Theme::light())
        .unwrap();
}
#[test]
fn messages_update_state_and_overflow_is_transactional() {
    let mut app = InterpretedApp::new(SWITCH).unwrap();
    app.dispatch(Message {
        handler: Value::Variant("Message::Enabled".into(), vec![Value::Bool(true)]),
        argument: None,
    })
    .unwrap();
    let Value::Record(_, fields) = &app.state else {
        panic!()
    };
    assert!(fields["enabled"]
        .boolean(proc_macro2::Span::call_site())
        .unwrap());
    assert_eq!(
        fields["changes"]
            .integer(proc_macro2::Span::call_site())
            .unwrap(),
        1
    );
    let source = SWITCH.replace("changes: 0", "changes: 4294967295");
    let mut app = InterpretedApp::new(&source).unwrap();
    let error = app
        .dispatch(Message {
            handler: Value::Variant("Message::Enabled".into(), vec![Value::Bool(true)]),
            argument: None,
        })
        .err()
        .unwrap();
    assert_eq!(error.kind, "range");
    let Value::Record(_, fields) = &app.state else {
        panic!()
    };
    assert!(!fields["enabled"]
        .boolean(proc_macro2::Span::call_site())
        .unwrap());
}
#[test]
fn dead_branches_are_validated() {
    for expression in [
        "if false { loop {} } label(\"ok\")",
        "if false { unsafe { obj() }; } label(\"ok\")",
        "if false { std::fs::read(\"secret\"); } label(\"ok\")",
        "if false { label(\"x\").unknown(); } label(\"ok\")",
    ] {
        let error = error(&screen(expression));
        assert_eq!(error.kind, "unsupported");
        assert_eq!(error.line, 2);
    }
}
#[test]
fn errors_have_source_locations_and_checked_boundaries() {
    for expression in [
        "label(\"x\").style(Style::default().width(Size::Px(40000)))",
        "label(\"x\").style(Style::default().opacity(256))",
        "label(\"x\").grid_cell(65536,0,1,1)",
        "label(\"x\").key(Key::Id(-1))",
        "slider(0,100,2147483648)",
    ] {
        let e = error(&screen(expression));
        assert_eq!(e.kind, "range", "{}", e.message);
        assert_eq!(e.line, 2);
        assert!(e.column > 1);
    }
    assert_eq!(error(&screen("label(\"x\"")).kind, "syntax");
}
#[test]
fn recursive_helpers_stop_at_the_budget() {
    let text = screen("recur(theme)") + "\nfn recur(theme: &Theme) -> View<()> { recur(theme) }";
    assert_eq!(error(&text).kind, "limit");
}
#[test]
fn keys_preserve_full_u64_and_separate_named_namespace() {
    let app = InterpretedApp::new(&screen("column([label(\"a\").key(Key::Id(18446744073709551615u64)), label(\"b\").key(Key::Named(\"18446744073709551615\"))])")).unwrap();
    app.render(&Theme::light()).unwrap();
    app.render(&Theme::light()).unwrap();
    assert_eq!(app.keys.borrow().len(), 2);
}
#[test]
fn scalar_types_and_formatting_are_checked() {
    assert_eq!(
        error(&screen(
            "let value: u8 = 255; let next = value + 1; label(format!(\"{next}\"))"
        ))
        .kind,
        "range"
    );
    assert_eq!(
        error(&screen("let value: bool = 1; label(\"x\")")).kind,
        "type"
    );
    assert_eq!(error(&screen("label(format!(\"{:?}\", 1))")).kind, "name");
}

#[test]
fn source_and_value_expansion_are_bounded() {
    assert_eq!(
        error(&screen(&format!(
            "{}label(\"x\"){}",
            "(".repeat(2000),
            ")".repeat(2000)
        )))
        .kind,
        "limit"
    );
    let text = format!(
        "let a = [0, 0, 0, 0]; {} label(\"done\")",
        (0..10)
            .map(|_| "let a = [a.clone(), a.clone(), a.clone(), a.clone()];")
            .collect::<String>()
    );
    assert_eq!(error(&screen(&text)).kind, "limit");
    InterpretedApp::new(&screen(&format!("label(r#\"{}\"#)", "[".repeat(100))))
        .unwrap()
        .render(&Theme::light())
        .unwrap();
}

#[test]
fn local_bindings_do_not_restore_an_earlier_value() {
    let source = screen(
        "let mut a: u8 = 0; a += 1; let b = 1; if a != b { label(true) } else { label(\"ok\") }",
    );
    InterpretedApp::new(&source)
        .unwrap()
        .render(&Theme::light())
        .unwrap();
}

#[test]
fn builtin_names_cannot_be_shadowed_into_invalid_native_arguments() {
    assert_eq!(
        error(&(screen("label(\"x\").key(Key::Id)") + "\nenum Key { Id }")).kind,
        "unsupported"
    );
}

#[test]
fn operation_budget_rejects_bounded_but_expensive_recursion() {
    let source = screen("let value = work(16); label(format!(\"{value}\"))")
        + "\nfn work(n: u32) -> u32 { if n == 0 { 0 } else { work(n - 1) + work(n - 1) } }";
    let diagnostic = error(&source);
    assert_eq!(diagnostic.kind, "limit");
    assert!(diagnostic.message.contains("20,000"));
}

#[test]
fn signed_minima_and_tuple_annotations_keep_their_ranges() {
    InterpretedApp::new(&screen("let n = -128i8; label(format!(\"{n}\"))"))
        .unwrap()
        .render(&Theme::light())
        .unwrap();
    assert_eq!(
        error(&screen("let n = -129i8; label(format!(\"{n}\"))")).kind,
        "range"
    );
    assert_eq!(
        error(&screen(
            "let (a, b): (u8, bool) = (256, true); label(\"x\")"
        ))
        .kind,
        "range"
    );
    assert_eq!(
        error(&screen("let (a, b): (u8, bool) = (1, 2); label(\"x\")")).kind,
        "type"
    );
}
