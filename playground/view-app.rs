struct Example;

impl rs_lvgl_ui::App for Example {
    type Msg = ();

    fn update(&mut self, _: ()) {}

    fn view(&self, theme: &rs_lvgl_ui::Theme) -> rs_lvgl_ui::View<()> {
        view(theme)
    }
}

fn app() -> impl rs_lvgl_ui::App {
    Example
}
