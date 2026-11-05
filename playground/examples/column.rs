use rs_lvgl_ui::prelude::*;

fn view(theme: &Theme) -> View<()> {
    column([
        label("Hello, LVGL")
            .font(theme.title_font)
            .text_color(theme.text),
        label("A screen is a tree of ordinary Rust values.")
            .font(theme.body_font)
            .text_color(theme.text),
        button("Start building").style(Style::accent(theme)),
    ])
    .style(Style::screen(theme))
    .font(theme.body_font)
    .text_color(theme.text)
    .padding(24)
    .gap(16)
}
