use rs_lvgl_ui::prelude::*;

fn view(theme: &Theme) -> View<()> {
    column([
        label("Device settings").style(Style::title(theme)),
        row([
            label("Brightness").style(Style::body(theme)),
            slider(0, 100, 64).style(Style::default().width(Size::Px(240)).height(Size::Px(16))),
            label("64%"),
        ])
        .style(Style::surface(theme).gap(24)),
        row([label("Notifications"), switch(true)]).style(Style::surface(theme).gap(24)),
        button("Apply settings").style(Style::accent(theme)),
    ])
    .style(Style::screen(theme).pad(24).gap(24))
}
