use rs_lvgl_ui::prelude::*;

fn view(theme: &Theme) -> View<()> {
    let devices = [(41, "Studio"), (73, "Kitchen"), (92, "Bedroom")];
    let rows = devices.into_iter().map(|(id, name)| {
        row([
            label(name)
                .font(theme.body_font)
                .text_color(theme.text)
                .grow(1),
            label(format!("ID {id}"))
                .font(theme.body_font)
                .text_color(theme.muted),
        ])
        .key(Key::Id(id))
        .style(Style::surface(theme))
        .width(percent(100))
        .padding(16)
    });

    column([label("Your devices")
        .font(theme.title_font)
        .text_color(theme.text)])
    .children(rows)
    .style(Style::screen(theme))
    .font(theme.body_font)
    .text_color(theme.text)
    .padding(24)
    .gap(12)
}
