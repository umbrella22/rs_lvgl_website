use rs_lvgl_ui::prelude::*;

fn view(theme: &Theme) -> View<()> {
    column([
        label("Hello, LVGL").style(Style::title(theme)),
        label("A screen is a tree of ordinary Rust values.").style(Style::body(theme)),
        button("Start building").style(Style::accent(theme)),
    ])
    .style(Style::screen(theme).pad(24).gap(16))
}
