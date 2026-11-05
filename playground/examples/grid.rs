use rs_lvgl_ui::prelude::*;

fn view(theme: &Theme) -> View<()> {
    let tiles = grid(
        [GridTrack::Fr(1), GridTrack::Fr(1)],
        [GridTrack::Px(72), GridTrack::Px(72)],
        [
            button("Top left").grid_cell(0, 0, 1, 1),
            button("Top right").grid_cell(1, 0, 1, 1),
            button("Two columns").grid_cell(0, 1, 2, 1),
        ],
    )
    .style(Style::surface(theme))
    .width(percent(100))
    .gap(12);

    column([
        label("A place for everything")
            .font(theme.title_font)
            .text_color(theme.text),
        tiles,
    ])
    .style(Style::screen(theme))
    .font(theme.body_font)
    .text_color(theme.text)
    .padding(24)
    .gap(20)
}
