// rs_lvgl_ui 0.5.0: compile against the pinned release or a matching local checkout.
// This snapshot preview maps actions to (); the library's form example handles state.
use rs_lvgl_ui::components::{list::ListItem, panel::Panel};
use rs_lvgl_ui::prelude::*;

fn view(theme: &Theme) -> View<()> {
    let speed = 50;
    let fields = typed::column([])
        .child(typed::slider(0, 100, binding(speed, |_: i32| ())).key(Key::Named("speed")))
        .child(typed::textarea(binding("Desk fan", |_: &str| ())).placeholder("Device name"))
        .child_if(true, || typed::label("Speed is controlled by the model"))
        .child_if(false, || -> View<()> {
            panic!("hidden child must not be built")
        })
        .children((0..2).map(|id| {
            typed::label(format!("Profile {id}"))
                .key(Key::Id(id))
                .into_view()
        }))
        // Knobs extend outside their tracks, including at the range endpoints.
        .padding(12)
        .gap(12);
    let enabled = ListItem::new("Enabled")
        .trailing(typed::switch(binding(true, |_: bool| ())))
        .view(theme);
    Panel::new("Fan settings")
        .header_action(typed::button("Save").on_click(()))
        .content(fields)
        .child(enabled)
        .view(theme)
        .width(percent(100))
        .height(percent(100))
}
