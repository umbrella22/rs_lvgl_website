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
