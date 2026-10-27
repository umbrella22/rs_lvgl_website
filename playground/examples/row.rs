use rs_lvgl_ui::prelude::*;

fn view(theme: &Theme) -> View<()> {
    let actions = row([
        button("Back").style(Style::body(theme)),
        label("Step 2 of 3").style(Style::body(theme).flex_grow(1)),
        button("Continue").style(Style::accent(theme)),
    ])
    .style(Style::surface(theme).width(Size::Percent(100)).gap(12));

    column([
        label("Make room").style(Style::title(theme)),
        label("The middle label grows into the available space."),
        actions,
    ])
    .style(Style::screen(theme).pad(24).gap(20))
}
