---
title: UI 0.6.0 migration
description: Migrate from rs_lvgl_ui 0.5.0 to 0.6.0 with unified names, explicit transform units, independent flex alignment and semantic widget parts.
---

# UI 0.6.0 migration

Version 0.6.0 introduces breaking UI changes relative to 0.5.0. Install
`rs_lvgl_ui = "0.6.0"` and migrate the names, units, layouts and widget parts below.
The website's `source/` pins the same release. Studio runs the compiled library;
the online Playground supports a bounded Rust subset, including the renamed
container/progress constructors, plain styles and independent alignment. Typed
construction, transform units and part styles in the complete example require
the native Rust compiler.

From the website checkout, validate the pinned release with:

```sh
npm run check-development-ui -- --source ./source
```

The command records the selected source identity, compiles the example below
with real Rust/LVGL, renders both themes, and checks deliberate unit/capability
errors. Results and images are in `target/development-ui/`.

## Names

| 0.5.0 | 0.6.0 |
| --- | --- |
| obj, bar, msgbox, anim_image | container, progress_bar, message_box, animated_image; ordinary and typed |
| typed::kind::Obj/Bar/Msgbox/AnimImage | Container/ProgressBar/MessageBox/AnimatedImage |
| ScrollDir / scroll_dir / HOR / VER | ScrollDirection / scroll_direction / HORIZONTAL / VERTICAL |
| TopMid / BottomMid / LeftMid / RightMid | TopCenter / BottomCenter / CenterLeft / CenterRight |
| LabelLongMode / Dots / ScrollCircular | TextOverflow / Ellipsis / ScrollLoop; label.text_overflow |
| Style::neutral | Style::plain; unchanged explicit base values |
| msgbox_title/buttons / spinner_anim / anim_duration | message_box_title/buttons / spinner_animation / animation_duration |
| bg_grad_color/dir, bg_main_stop/bg_grad_stop | background_gradient_color/direction, background_gradient_start/end |
| bg_main_opacity/bg_grad_opacity | background_gradient_start_opacity/end_opacity |
| text_letter_space/text_line_space / outline_pad | letter_spacing/line_spacing / outline_offset |
| image_recolor/image_recolor_opacity | image_tint/image_tint_opacity |
| Part / part_style / part_state_style | NativePart / native_part_style / native_part_state_style |

Old paths are removed without aliases. Native feature names and low-level
rs_lvgl names retain their API. A message box remains inline, with no new modal
contract. Ordinary containers/labels already apply plain base values; set local
fields directly. Keep explicit plain resets when they intentionally remove a
control's native surface or overwrite previous fields. Plain is not an empty
patch or a complete reset; extended styles and inherited text remain unset.

## Units, placement and parts

Use Scale::percent(50) for half size, Scale::ratio(n,d) for exact ratios, and
Angle::degrees(90) or Angle::tenths(455) for angles. Scales round to native 1/256,
ties upward; ratio rejects zero denominator or native overflow. Native scales
are 0..=65535; image scales additionally reject zero. Rotation is checked against
-32768..=32767 tenths before mutation. Typed Animation::rotation/scale_x/scale_y
replace raw Rotation/ScaleX/ScaleY endpoints; scalar animations remain. Spinner
sweep stays whole degrees. The library's `docs/ui-api-migration.md` gives the
complete mapping, including transition/diagnostic variants and constants.

Replace flex_align(main,cross) with justify_content(main), align_items(cross as
ItemAlign), and align_content(cross as FlexAlign) to preserve existing placement.
The three properties merge independently. ItemAlign supports Start/Center/End;
align_content maps native track placement, including single-line containers.
Floating keeps both layout and parent-scroll exclusion; CSS stretch/absolute
semantics are not implied.

Thumb styles support Slider/Switch. Progress styles support Slider/ProgressBar.
Other parts use NativePart explicitly; Arc's indicator has its own meaning.
Typed misuse fails a capability bound; erased misuse follows diagnostics/strict.
A later patch for the same part/state replaces the whole earlier patch; combine
fields in one patch. Removing a selector restores native/base values.

## Compiled local example

```rust
// rs_lvgl_ui 0.6.0; validate with check-development-ui against the pinned source.
use rs_lvgl_ui::prelude::*;

fn view(theme: &Theme) -> View<()> {
    column([
        label("Fan settings").font(theme.title_font).text_color(theme.text)
            .text_overflow(TextOverflow::Ellipsis),
        row([
            typed::slider(0, 100, 50).width(px(240)).height(px(16))
                .thumb_style(style().background(theme.accent))
                .progress_style(style().background(theme.accent)).into_view(),
            typed::switch(true).into_view(),
        ]).width(percent(100)).padding(16)
            .justify_content(FlexAlign::SpaceBetween)
            .align_items(ItemAlign::Center).align_content(FlexAlign::Center),
        progress_bar(0, 100, 50).width(percent(100))
            .progress_style(style().background(theme.accent)),
        container().width(px(64)).height(px(64)).child(
            container().width(px(24)).height(px(24)).align(Align::Center)
                .background(theme.accent)
                .transform_scale_x(Scale::percent(150))
                .transform_scale_y(Scale::percent(150))
                .transform_pivot_x(12).transform_pivot_y(12)
                .transform_rotation(Angle::degrees(45)),
        ),
        message_box("Changes apply after Save.").message_box_title("Inline message"),
    ]).width(percent(100)).height(percent(100))
        .background(theme.background).text_color(theme.text).padding(24).gap(16)
        .scroll_direction(ScrollDirection::VERTICAL)
}
```

The thumb color patch retains LVGL's circular geometry. A fixed radius changes
the contour even when its width and height stay the same. The square uses equal
150% scales and a centered pivot; its 64 px slot reserves space for all four
rotated corners without overlapping the following message box. The two scale
axes remain independent for designs that require stretching.
