use rs_lvgl_ui::prelude::*;

fn view(theme: &Theme) -> View<()> {
    let actions = row([
        button("Back").font(theme.body_font).text_color(theme.text),
        label("Step 2 of 3")
            .font(theme.body_font)
            .text_color(theme.text)
            .grow(1),
        button("Continue").style(Style::accent(theme)),
    ])
    .style(Style::surface(theme))
    .width(percent(100))
    .gap(12);

    column([
        label("Make room")
            .font(theme.title_font)
            .text_color(theme.text),
        label("The middle label grows into the available space."),
        actions,
    ])
    .style(Style::screen(theme))
    .font(theme.body_font)
    .text_color(theme.text)
    .padding(24)
    .gap(20)
}
