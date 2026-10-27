include!("view.rs");

struct PlaygroundApp;

impl rs_lvgl_ui::App for PlaygroundApp {
    type Msg = ();

    fn update(&mut self, _: ()) {}

    fn view(&self, theme: &rs_lvgl_ui::Theme) -> rs_lvgl_ui::View<()> {
        view(theme)
    }
}

fn render() -> Result<(), String> {
    let width: u32 = std::env::var("RS_LVGL_PREVIEW_WIDTH")
        .unwrap()
        .parse()
        .unwrap();
    let height: u32 = std::env::var("RS_LVGL_PREVIEW_HEIGHT")
        .unwrap()
        .parse()
        .unwrap();
    let output = std::env::var("RS_LVGL_PREVIEW_OUTPUT").unwrap();
    let theme = if std::env::var("RS_LVGL_PREVIEW_THEME").as_deref() == Ok("dark") {
        rs_lvgl_ui::Theme::dark()
    } else {
        rs_lvgl_ui::Theme::light()
    };
    rs_lvgl::init();
    let display = rs_lvgl::Display::register::<_, { 960 * 16 }>(width, height, |_| {})
        .map_err(|error| format!("display:{error:?}"))?;
    let result = (|| {
        let mut ui =
            rs_lvgl_ui::Ui::new(&display, theme).map_err(|error| format!("mount:{error:?}"))?;
        let result = (|| {
            ui.mount(&PlaygroundApp)
                .map_err(|error| format!("mount:{error:?}"))?;
            for _ in 0..3 {
                rs_lvgl::tick_inc(std::time::Duration::from_millis(10));
                ui.timer_handler();
            }
            let snapshot = ui.snapshot().map_err(|error| format!("render:{error:?}"))?;
            let mut bytes = Vec::with_capacity(8 + snapshot.pixels.len());
            bytes.extend_from_slice(&snapshot.width.to_le_bytes());
            bytes.extend_from_slice(&snapshot.height.to_le_bytes());
            bytes.extend_from_slice(&snapshot.pixels);
            std::fs::write(output, bytes).map_err(|error| format!("output:{error}"))
        })();
        ui.unmount();
        result
    })();
    // SAFETY: the memory display has no asynchronous flush work. The controller
    // has been unmounted and dropped, and no input devices or callbacks remain.
    unsafe {
        display.delete();
        rs_lvgl::deinit();
    }
    result
}

fn main() {
    if let Err(error) = render() {
        eprintln!("RS_LVGL_PREVIEW_ERROR:{error}");
        std::process::exit(1);
    }
}
