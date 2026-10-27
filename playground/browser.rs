//! Owned, single-threaded LVGL runtime for an ordinary user App.
include!("view.rs");

use rs_lvgl_ui::{App as PreviewApp, Theme as PreviewTheme, Ui};
use std::{
    cell::{Cell, RefCell},
    collections::VecDeque,
    ptr::NonNull,
    rc::Rc,
    time::Duration,
};

#[derive(Clone, Copy, Default)]
struct Pointer {
    x: i32,
    y: i32,
    pressed: bool,
}

#[derive(Default)]
struct Input {
    pointer: Cell<Pointer>,
    pointers: RefCell<VecDeque<Pointer>>,
    key: Cell<(u32, bool)>,
    keys: RefCell<VecDeque<(u32, bool)>>,
}

trait Instance {
    fn frame(&mut self, elapsed: u32) -> Result<(), String>;
    fn pixels(&self) -> *const u8;
    fn input(&self) -> &Input;
    fn state(&self, field: u32) -> i32;
}

struct BrowserApp<A: PreviewApp> {
    app: A,
    ui: Option<Ui<A::Msg>>,
    display: Option<rs_lvgl::Display>,
    mouse: Option<NonNull<rs_lvgl_sys::lv_indev_t>>,
    keyboard: Option<NonNull<rs_lvgl_sys::lv_indev_t>>,
    input: Box<Input>,
    pixels: Rc<RefCell<Box<[u8]>>>,
    generation: Rc<Cell<u32>>,
    width: u32,
    height: u32,
}

impl<A: PreviewApp> BrowserApp<A> {
    fn new(app: A, width: u32, height: u32, dark: bool) -> Result<Self, String> {
        rs_lvgl::init();
        let mut state = Self {
            app,
            ui: None,
            display: None,
            mouse: None,
            keyboard: None,
            input: Box::default(),
            pixels: Rc::new(RefCell::new(
                vec![0; (width * height * 4) as usize].into_boxed_slice(),
            )),
            generation: Rc::new(Cell::new(0)),
            width,
            height,
        };
        let pixels = state.pixels.clone();
        let generation = state.generation.clone();
        state.display = Some(
            rs_lvgl::Display::register::<_, 10240>(width, height, move |refresh| {
                let mut pixels = pixels.borrow_mut();
                let area = &refresh.area;
                let row_width = (area.x2 - area.x1 + 1) as usize;
                for y in area.y1..=area.y2 {
                    for x in area.x1..=area.x2 {
                        let color = refresh.colors
                            [(y - area.y1) as usize * row_width + (x - area.x1) as usize];
                        let offset = ((y as u32 * width + x as u32) * 4) as usize;
                        pixels[offset..offset + 4].copy_from_slice(&[
                            color.r(),
                            color.g(),
                            color.b(),
                            255,
                        ]);
                    }
                }
                generation.set(generation.get().wrapping_add(1));
            })
            .map_err(|e| format!("display:{e}"))?,
        );
        let theme = if dark {
            PreviewTheme::dark()
        } else {
            PreviewTheme::light()
        };
        state.ui = Some(
            Ui::new(state.display.as_ref().unwrap(), theme).map_err(|e| format!("mount:{e}"))?,
        );
        let ui = state.ui.as_mut().unwrap();
        ui.mount(&state.app).map_err(|e| format!("mount:{e}"))?;
        // SAFETY: callbacks borrow this stable Input box synchronously. Devices
        // are removed before the box/display, including partial initialization.
        unsafe {
            let data = (&mut *state.input as *mut Input).cast();
            let mouse =
                NonNull::new(rs_lvgl_sys::lv_indev_create()).ok_or("pointer allocation failed")?;
            state.mouse = Some(mouse);
            rs_lvgl_sys::lv_indev_set_type(
                mouse.as_ptr(),
                rs_lvgl_sys::lv_indev_type_t_LV_INDEV_TYPE_POINTER,
            );
            rs_lvgl_sys::lv_indev_set_user_data(mouse.as_ptr(), data);
            rs_lvgl_sys::lv_indev_set_read_cb(mouse.as_ptr(), Some(read_pointer));
            let keyboard =
                NonNull::new(rs_lvgl_sys::lv_indev_create()).ok_or("keyboard allocation failed")?;
            state.keyboard = Some(keyboard);
            rs_lvgl_sys::lv_indev_set_type(
                keyboard.as_ptr(),
                rs_lvgl_sys::lv_indev_type_t_LV_INDEV_TYPE_KEYPAD,
            );
            rs_lvgl_sys::lv_indev_set_user_data(keyboard.as_ptr(), data);
            rs_lvgl_sys::lv_indev_set_read_cb(keyboard.as_ptr(), Some(read_key));
            ui.bind_input(keyboard).map_err(|e| format!("input:{e}"))?;
        }
        Ok(state)
    }
}

impl<A: PreviewApp> Instance for BrowserApp<A> {
    fn frame(&mut self, elapsed: u32) -> Result<(), String> {
        rs_lvgl::tick_inc(Duration::from_millis(elapsed.into()));
        let ui = self.ui.as_mut().unwrap();
        ui.timer_handler();
        ui.drain(&mut self.app, 128)
            .map_err(|e| format!("update:{e}"))?;
        ui.tick(elapsed).map_err(|e| format!("animation:{e}"))?;
        Ok(())
    }
    fn pixels(&self) -> *const u8 {
        self.pixels.borrow().as_ptr()
    }
    fn input(&self) -> &Input {
        &self.input
    }
    fn state(&self, field: u32) -> i32 {
        match field {
            0 => self.width as i32,
            1 => self.height as i32,
            2 => self.ui.as_ref().unwrap().stats().messages_processed as i32,
            7 => self.generation.get() as i32,
            _ => -1,
        }
    }
}

impl<A: PreviewApp> Drop for BrowserApp<A> {
    fn drop(&mut self) {
        if let Some(mut ui) = self.ui.take() {
            ui.unmount();
            drop(ui);
        }
        // SAFETY: native calls are synchronous; no render is pending. Release
        // Ui, devices, display and LVGL in order before retained Rust storage.
        unsafe {
            for device in [self.mouse.take(), self.keyboard.take()]
                .into_iter()
                .flatten()
            {
                rs_lvgl_sys::lv_indev_delete(device.as_ptr());
            }
            if let Some(display) = self.display.take() {
                display.delete();
            }
            rs_lvgl::deinit();
        }
    }
}

unsafe extern "C" fn read_pointer(
    device: *mut rs_lvgl_sys::lv_indev_t,
    data: *mut rs_lvgl_sys::lv_indev_data_t,
) {
    // SAFETY: LVGL invokes this only for a registered live device; user_data
    // points to its owner's Input box and data is writable for this callback.
    unsafe {
        let input = &*rs_lvgl_sys::lv_indev_get_user_data(device).cast::<Input>();
        let mut queue = input.pointers.borrow_mut();
        if let Some(pointer) = queue.pop_front() {
            input.pointer.set(pointer);
        }
        let pointer = input.pointer.get();
        (*data).point.x = pointer.x;
        (*data).point.y = pointer.y;
        (*data).state = u32::from(pointer.pressed);
        (*data).continue_reading = !queue.is_empty();
    }
}

unsafe extern "C" fn read_key(
    device: *mut rs_lvgl_sys::lv_indev_t,
    data: *mut rs_lvgl_sys::lv_indev_data_t,
) {
    // SAFETY: identical ownership and callback lifetime to read_pointer above.
    unsafe {
        let input = &*rs_lvgl_sys::lv_indev_get_user_data(device).cast::<Input>();
        let mut queue = input.keys.borrow_mut();
        if let Some(key) = queue.pop_front() {
            input.key.set(key);
        }
        let (key, pressed) = input.key.get();
        (*data).key = key;
        (*data).state = u32::from(pressed);
        (*data).continue_reading = !queue.is_empty();
    }
}

thread_local! {
    static RUNTIME: RefCell<Option<Box<dyn Instance>>> = const { RefCell::new(None) };
}

#[no_mangle]
pub extern "C" fn studio_init(width: u32, height: u32, dark: u32) -> i32 {
    if !(240..=960).contains(&width) || !(160..=720).contains(&height) || dark > 1 {
        return -1;
    }
    RUNTIME.with_borrow_mut(|slot| {
        if slot.is_some() {
            return -1;
        }
        match BrowserApp::new(app(), width, height, dark == 1) {
            Ok(runtime) => {
                *slot = Some(Box::new(runtime));
                0
            }
            Err(error) => {
                eprintln!("RS_LVGL_PREVIEW_ERROR:{error}");
                -1
            }
        }
    })
}

#[no_mangle]
pub extern "C" fn studio_destroy() {
    RUNTIME.with_borrow_mut(|slot| {
        slot.take();
    });
}

#[no_mangle]
pub extern "C" fn studio_frame(elapsed: u32) -> i32 {
    if elapsed > 1000 {
        return -1;
    }
    RUNTIME.with_borrow_mut(|slot| match slot {
        Some(state) => match state.frame(elapsed) {
            Ok(()) => 0,
            Err(error) => {
                eprintln!("RS_LVGL_PREVIEW_ERROR:{error}");
                -1
            }
        },
        None => -1,
    })
}

/// Read-only pixels valid until teardown; copy before the next native call.
#[no_mangle]
pub extern "C" fn studio_pixels() -> *const u8 {
    RUNTIME.with_borrow(|slot| {
        slot.as_ref()
            .map_or(core::ptr::null(), |state| state.pixels())
    })
}

#[no_mangle]
pub extern "C" fn studio_pointer(x: i32, y: i32, pressed: u32) -> i32 {
    RUNTIME.with_borrow(|slot| match slot {
        Some(state)
            if x >= 0 && x < state.state(0) && y >= 0 && y < state.state(1) && pressed <= 1 =>
        {
            state.input().pointers.borrow_mut().push_back(Pointer {
                x,
                y,
                pressed: pressed == 1,
            });
            0
        }
        _ => -1,
    })
}

#[no_mangle]
pub extern "C" fn studio_key(key: u32, pressed: u32) -> i32 {
    if char::from_u32(key).is_none() || pressed > 1 {
        return -1;
    }
    RUNTIME.with_borrow(|slot| match slot {
        Some(state) => {
            state
                .input()
                .keys
                .borrow_mut()
                .push_back((key, pressed == 1));
            0
        }
        None => -1,
    })
}

#[no_mangle]
pub extern "C" fn studio_command(_: u32, _: u32) -> i32 {
    -1
}

#[no_mangle]
pub extern "C" fn studio_state(field: u32) -> i32 {
    RUNTIME.with_borrow(|slot| slot.as_ref().map_or(-1, |state| state.state(field)))
}

fn main() {}
