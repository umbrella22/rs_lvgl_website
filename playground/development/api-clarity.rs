// rs_lvgl_ui 0.7.0; validate with check-development-ui against the pinned source.
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
