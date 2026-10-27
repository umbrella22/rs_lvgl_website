use rs_lvgl_ui::prelude::*;

fn view(theme: &Theme) -> View<()> {
    let devices = [(41, "Studio"), (73, "Kitchen"), (92, "Bedroom")];
    let rows = devices.into_iter().map(|(id, name)| {
        row([
            label(name).style(Style::body(theme).flex_grow(1)),
            label(format!("ID {id}")).style(Style::muted(theme)),
        ])
        .key(Key::Id(id))
        .style(Style::surface(theme).width(Size::Percent(100)).pad(16))
    });

    column([label("Your devices").style(Style::title(theme))])
        .children(rows)
        .style(Style::screen(theme).pad(24).gap(12))
}
