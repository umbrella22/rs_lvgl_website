// rs_lvgl_ui 0.7.0 custom properties; native Rust compilation is required.
use core::ptr::NonNull;
use rs_lvgl::{sys, NativeObject};
use rs_lvgl_ui::prelude::*;

struct Gauge;
struct GaugeProps(i32);

impl CustomWidget for Gauge {
    type Props = GaugeProps;

    fn validate(props: &GaugeProps) -> Result<(), UiError> {
        if (0..=100).contains(&props.0) { Ok(()) }
        else { Err(UiError::InvalidProperty) }
    }

    fn create(&mut self, parent: &mut Obj<'_>, _: &GaugeProps)
        -> Result<CustomObject, UiError>
    {
        // SAFETY: this hook creates one live direct child for the mounted owner.
        unsafe {
            let child = NonNull::new(sys::lv_arc_create(parent.raw().as_ptr()))
                .ok_or(UiError::Allocation)?;
            CustomObject::new(parent, child)
        }
    }

    fn apply_props(&mut self, object: &mut CustomObject, props: &GaugeProps)
        -> Result<(), UiError>
    {
        // SAFETY: this hook exclusively borrows its live arc on the UI thread.
        unsafe { sys::lv_arc_set_value(object.raw().as_ptr(), props.0); }
        Ok(())
    }

    fn delete(&mut self, _: &mut CustomObject) {
        // No external registrations or retained buffers to retire in this widget.
    }
}

fn view(theme: &Theme) -> View<()> {
    column([custom(Gauge, GaugeProps(65)).key(Key::Named("gauge"))])
        .padding(24).width(percent(100)).height(percent(100))
        .background(theme.background).text_color(theme.text)
}
