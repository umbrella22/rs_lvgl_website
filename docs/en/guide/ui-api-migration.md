---
title: UI 0.7.0 migration
description: Migrate from rs_lvgl_ui 0.6.0 to 0.7.0 with ChartSpec, stable series, property-aware custom widgets, controlled range sliders and textarea editing options.
---

# UI 0.7.0 migration

Version 0.7.0 replaces chart and custom-widget construction. Upgrade direct
`rs_lvgl`, `rs_lvgl_sys`, `rs_lvgl_codegen` and `rs_lvgl_ui` dependencies together
where present. Migrate callers to the single new interface for each widget.

```toml
[dependencies]
rs_lvgl = { version = "0.7.0", default-features = false, features = ["alloc"] }
rs_lvgl_ui = "0.7.0"
```

The native provider remains vendored LVGL 9.6. Default features and the existing
explicit units, Flex alignment and widget-part names remain available. Projects
coming from 0.5.0 or earlier should first apply the
[historical 0.6.0 migration](https://github.com/umbrella22/rs_lvgl/blob/v0.6.0/docs/ui-api-migration.md).

## Replace chart descriptions

| 0.6.0 | 0.7.0 |
| --- | --- |
| `chart(kind, min, max, series)` | `chart(ChartSpec::new(kind, axes, series))`; also `typed::chart(spec)` |
| `ChartSeries { color, values }` | `ChartSeries::new(stable_id, color, ChartData::values(values))` |
| Constructor min/max arguments | Explicit `ChartAxes` with primary/secondary X/Y `ChartRange` values |
| Implicit series identity by position | Stable IDs for logical signals; `.axes(x_axis, y_axis)` selects each coordinate independently |

Choose an explicit X range even for a chart using sample slots. Line, Bar,
Stacked and Curve use Y samples; Scatter uses XY samples. Curve requires the
effective native `LV_USE_VECTOR_GRAPHIC` capability. `ChartValue::Missing`
represents a gap; `i32::MAX` is reserved. Duplicate IDs, invalid ranges,
inconsistent lengths and incompatible sample kinds reject the render before
native mutation. Bar requires complete samples; Stacked also rejects negative
values, mixed Y axes and cumulative overflow.

For streaming data, keep `ChartHistory` in application state and pass
`ChartData::History(history.snapshot())`. History has an explicit epoch,
nonzero capacity and sample kind. Shift and Circular choose displayed ordering.
Appends require matching metadata and retained overlap; gaps, changed capacity,
replacement and remount recover by full synchronization. Snapshot creation copies
retained data; compare costs with the application's batch size rather than
assuming a frame-rate improvement. A `ChartCursor` uses its own stable ID and a
pixel or series/point target.

## Use controlled range and text input

`range_slider(min, max, SliderRange::new(lower, upper))` emits both endpoints
through `on_range_changed`. Typed construction also accepts `binding`.
Unordered or out-of-domain endpoints reject; the constructor does not sort or
clamp them. An ignored edit is restored from the model on reconciliation.

Textarea modifiers configure editing: `accepted_chars`,
`input_max_length(Option<NonZeroU32>)`, `cursor_position(Option<u32>)` and
`cursor_click_position(bool)`. Lengths and cursor positions count Unicode scalar
values. `None` removes the length limit; there is no zero-length-limit sentinel.
The application model remains authoritative: filters do not truncate the full
model string during reconciliation. Manual `WidgetKind::Textarea` literals must
supply the new `input: Option<Box<TextareaInputOptions>>` field; prefer builders
for the opaque settings.

Flex `.flex_wrap(bool)` and `.flex_reverse(bool)` select native flow independently.
Stable keys and descriptor child order retain their meaning. This complete view
fragment compiles against the pinned 0.7.0 source:

```rust
// rs_lvgl_ui 0.7.0; validate with check-development-ui against the pinned source.
use core::num::NonZeroU32;
use rs_lvgl_ui::prelude::*;

fn view(theme: &Theme) -> View<()> {
    column([
        label("Sensor controls").font(theme.title_font),
        row([
            typed::range_slider(0, 100,
                binding(SliderRange::new(20, 70), |_: SliderRange| ()))
                .width(px(220)).height(px(18)).into_view(),
            typed::textarea(binding("42", |_: &str| ()))
                .accepted_chars("0123456789")
                .input_max_length(NonZeroU32::new(4))
                .cursor_position(Some(2)).cursor_click_position(false)
                .width(px(160)).height(px(52)).into_view(),
        ]).flex_wrap(true).flex_reverse(false)
            .align_items(ItemAlign::Center).gap(24).padding(16),
        chart(ChartSpec::new(
            ChartType::Line,
            ChartAxes::new(ChartRange::new(0, 100), ChartRange::new(0, 100)),
            vec![ChartSeries::new(
                7, theme.accent, ChartData::values([20, 45, 30, 70]),
            )],
        )).width(px(420)).height(px(140)).key(Key::Named("readings")),
    ]).width(percent(100)).height(percent(100)).padding(24).gap(16)
        .background(theme.background).text_color(theme.text)
}
```

Enable the matching `widget-slider`, `widget-textarea` and `widget-chart` features
when disabling defaults. The native compiler validates this example; the online
Playground interpreter supports a smaller Rust subset.

## Deliver custom properties explicitly

| 0.6.0 | 0.7.0 |
| --- | --- |
| `custom(widget)` | `custom(widget, props)` |
| `create(parent)` | Associated `type Props` and `create(parent, &Props)` |
| `update(object, elapsed_ms)` | `apply_props(object, &Props)` for model input; `tick(object, elapsed_ms)` for time |
| Shared state or key changes to force refresh | Current properties delivered to the mounted instance on every compatible reconciliation |

Implement `apply_props` even for `Props = ()`. Pure `validate` runs before either
main or overlay mutates. A matching key and concrete type retains the widget;
changing either replaces it. `Ui::tick` advances only `tick`.

```rust
// rs_lvgl_ui 0.7.0 custom properties; native Rust compilation is required.
use core::ptr::NonNull;
use rs_lvgl::{sys, NativeObject};
use rs_lvgl_ui::prelude::*;

struct Gauge;
struct GaugeProps(i32);

impl CustomWidget for Gauge {
    type Props = GaugeProps;

    fn validate(props: &GaugeProps) -> Result<(), UiError> {
        if (0..=100).contains(&props.0) { Ok(()) }
        else { Err(UiError::InvalidProperty) }
    }

    fn create(&mut self, parent: &mut Obj<'_>, _: &GaugeProps)
        -> Result<CustomObject, UiError>
    {
        // SAFETY: this hook creates one live direct child for the mounted owner.
        unsafe {
            let child = NonNull::new(sys::lv_arc_create(parent.raw().as_ptr()))
                .ok_or(UiError::Allocation)?;
            CustomObject::new(parent, child)
        }
    }

    fn apply_props(&mut self, object: &mut CustomObject, props: &GaugeProps)
        -> Result<(), UiError>
    {
        // SAFETY: this hook exclusively borrows its live arc on the UI thread.
        unsafe { sys::lv_arc_set_value(object.raw().as_ptr(), props.0); }
        Ok(())
    }

    fn delete(&mut self, _: &mut CustomObject) {
        // No external registrations or retained buffers to retire in this widget.
    }
}

fn view(theme: &Theme) -> View<()> {
    column([custom(Gauge, GaugeProps(65)).key(Key::Named("gauge"))])
        .padding(24).width(percent(100)).height(percent(100))
        .background(theme.background).text_color(theme.text)
}
```

A successful property application must retire native references to previous
properties. If application partially fails, old and incoming properties remain
alive until native deletion completes. `delete` runs once while the root is live;
it retires external registrations and must not delete the root or reenter `Ui`.
A failed `create` cleans up its own partial construction. Native callbacks must
not unwind across C. The raw pointer and teardown contracts remain in force.

## Verify the upgraded application

Run native tests serially, check disabled widget/layout configurations and
`no_std` where used, and exercise accepted/rejected input plus custom deletion on
the actual target. The website runs `check-development-ui` against its pinned
release, including both examples above and old-signature rejection controls.
For a complete native memory-display program and detailed limits, see
[capability-depth.rs](https://github.com/umbrella22/rs_lvgl/blob/v0.7.0/.agents/skills/rs-lvgl-ui/references/capability-depth.rs)
and the [capability guide](https://github.com/umbrella22/rs_lvgl/blob/v0.7.0/docs/ui-capability-depth.md).
