---
title: Composition and controlled forms
description: Use lazy children, semantic events, typed widget construction, component slots and explicit form bindings in rs_lvgl_ui 0.7.0.
---

# Composition and controlled forms

`rs_lvgl_ui` 0.7.0 provides these APIs from crates.io. Install `rs_lvgl_ui = "0.7.0"` and enable the widget features used by the form. The website's `source/` pins the matching library release. The online Playground interpreter supports a bounded Rust subset; the conditional children, semantic callbacks, slots, typed constructors and bindings on this page require the native Rust compiler.

## Compose children in ordinary Rust

`child_if(show, || view)` evaluates its closure once only when `show` is true. It may borrow local data; false branches allocate no child description. Arrays, `child`, `children` and iterators preserve insertion order. Use business keys for a changing list, so native objects and viable focus follow the items.

```rust
use rs_lvgl_ui::prelude::*;

fn devices(ids: &[u64], show_help: bool) -> View<()> {
    column([label("Devices")])
        .children(ids.iter().map(|id| button(format!("Device {id}")).key(Key::Id(*id))))
        .child_if(show_help, || label("Select a device"))
        .gap(8)
}
```

A reusable component remains a function: arguments supply state and content, the returned view contains its actions, and `.map(ParentAction::Child)` adapts them. It adds no independent state or render cache.

## Choose a semantic callback

| Method | Value | Controls |
| --- | --- | --- |
| `on_toggle` | `bool` | Switch, checkbox |
| `on_value_changed` | `i32` | Slider, bar, arc, spinbox |
| `on_selection_changed` | `Option<u32>` | Dropdown, roller, tabs, tiles, button matrix, message-box footer |
| `on_cell_selected` | `Option<TableCell>` | Table; separate row and column |
| `on_date_selected` | `Option<CalendarDate>` | Calendar |
| `on_text_changed` | `&str` during the callback | Textarea |

`None` is valid absence, such as no pressed button or a day-name calendar cell. Invalid native representations produce no semantic action. Numeric and semantic methods replace one shared value-handler slot in call order. Text, click and generic-event handlers remain independent. Erased views retain the legacy numeric encoding when explicitly requested.

## Retain widget capabilities until composition

`typed::switch(...)` retains a switch marker through styles, keys, animations and `map`. A textarea property such as `placeholder` then fails Rust compilation on a switch. Shared style modifiers retain their existing part semantics.

A single `.child(typed::switch(...))` or component slot accepts a typed node directly. Mixed arrays and iterator items convert with `.into_view()`; branches with different widget types and functions returning `View` also erase explicitly. After conversion the existing diagnostic/strict runtime checks apply. Optional constructors and markers use the same widget feature gates.

```rust
use rs_lvgl_ui::prelude::*;

fn status(enabled: bool) -> View<()> {
    typed::column([
        typed::label("Power").into_view(),
        typed::switch(enabled).on_toggle(|_| ()).into_view(),
    ])
    .child_if(enabled, || typed::label("Enabled"))
    .into_view()
}
```

## Bind a current value to an action mapper

A binding is consumed during construction. It combines the current value with a callback; `update` still decides whether to change state.

```rust
use rs_lvgl_ui::prelude::*;

#[derive(Clone)]
enum FanSettingsAction {
    SpeedChanged(i32),
    EnabledChanged(bool),
    NameChanged(String),
}

fn fields(speed: i32, enabled: bool, name: &str) -> View<FanSettingsAction> {
    typed::column([])
        .child(typed::slider(0, 100, binding(speed, FanSettingsAction::SpeedChanged)))
        .child(typed::switch(binding(enabled, FanSettingsAction::EnabledChanged)))
        .child(typed::textarea(binding(name, |text: &str| {
            FanSettingsAction::NameChanged(text.into())
        })).placeholder("Device name"))
        .padding(12)
        .gap(12)
        .into_view()
}
```

Each nested form container reserves its own inner padding for drawing. Slider knobs extend beyond the track, and focus outlines extend beyond the control's layout box; an outer container's padding or sibling gap cannot protect pixels clipped by an inner container. The example uses 12 px with the bundled defaults. Custom knob, shadow or outline styles need matching space and native checks at both slider endpoints.

Numeric constructors accept `i32` or its binding; switch/checkbox accept `bool`; textarea accepts `String`, `&String` or `&str`. The mapper is static, and borrowed current text is copied into the existing descriptor. No mutable model borrow or automatic field setter survives. Native input follows callback → queue → update → view → reconciliation.

If a slider moves from 50 to 80 and `update` rejects 80 while leaving the model at 50, reconciliation must still restore 50. Programmatic correction suppresses feedback. `RenderDecision::Skip` requires that native correction is unnecessary; unchanged model data alone does not justify it.

## Supply component slots

ListItem `leading` replaces `icon`, `content` replaces the default text, and `trailing` replaces `detail`. Slots preserve explicit keys, styles and mapped handlers. Unkeyed slot roots receive stable slot keys, with default styling below explicit values. No additional native wrapper is created.

Panel `header_action`/`header_actions` append header widgets; `action` remains available. Panel and Dialog `content` replaces the body, then later `child`/`children` append. Dialog footer actions remain separate from body content.

Typed markers do not enlarge a view and erasure moves the existing fields. Bindings use one existing handler slot. Child vectors, owned strings, capturing closures, map and explicit list slots can allocate; native LVGL storage is measured separately.

## Check native form rendering

From this website checkout, validate the pinned library release:

```sh
npm run check-development-ui -- --source ./source
```

The checker compiles `playground/development/forms.rs` with the native Playground renderer, verifies light/dark snapshots and full slider-knob pixels at minimum, intermediate and maximum values, changes the model value and checks the changed pixels, and requires a wrong typed property to fail in rustc. It also renders the library skill form and the ordinary controls example, with a clipped negative control. Images and source receipts are written under `target/development-ui/`. A local library checkout can be selected with `--source ../lv_binding_rust`; `RS_LVGL_SOURCE` is an alternative for this command.

The online interpreter does not support the composition and form additions on this page. Native snapshots validate the form with the full Rust compiler. A snippet that maps actions to `()` has no application state changes; the library's runnable form and binding tests cover updates and rejected-input correction. See [Contribute](./development.md) for checks and [Mount and update](./ui-runtime.mdx) for platform integration.
