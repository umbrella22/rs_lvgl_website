use rs_lvgl_ui::prelude::*;

fn page_title<M>(text: &str, theme: &Theme) -> View<M> {
    column([
        label("WORKSPACE")
            .font(theme.body_font)
            .text_color(theme.muted),
        label(text).font(theme.title_font).text_color(theme.text),
    ])
    .gap(8)
}

fn view(theme: &Theme) -> View<()> {
    let content = label("Notification preferences");
    let title = page_title("Settings", theme);

    column([title, content, button("Save").style(Style::accent(theme))])
        .style(Style::screen(theme))
        .font(theme.body_font)
        .text_color(theme.text)
        .padding(24)
        .gap(24)
}
