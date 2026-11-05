use rs_lvgl_ui::prelude::*;

fn view(theme: &Theme) -> View<()> {
    column([
        label("Device settings")
            .font(theme.title_font)
            .text_color(theme.text),
        row([
            label("Brightness")
                .font(theme.body_font)
                .text_color(theme.text),
            slider(0, 100, 64).width(px(240)).height(px(16)),
            label("64%"),
        ])
        .style(Style::surface(theme))
        .gap(24),
        row([label("Notifications"), switch(true)])
            .style(Style::surface(theme))
            .gap(24),
        button("Apply settings").style(Style::accent(theme)),
    ])
    .style(Style::screen(theme))
    .font(theme.body_font)
    .text_color(theme.text)
    .padding(24)
    .gap(24)
}
