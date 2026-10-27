use rs_lvgl_ui::prelude::*;

fn page_title<M>(text: &str, theme: &Theme) -> View<M> {
    column([
        label("WORKSPACE").style(Style::muted(theme)),
        label(text).style(Style::title(theme)),
    ])
    .style(Style::default().gap(8))
}

fn view(theme: &Theme) -> View<()> {
    let content = label("Notification preferences");
    let title = page_title("Settings", theme);

    column([title, content, button("Save").style(Style::accent(theme))])
        .style(Style::screen(theme).pad(24).gap(24))
}
