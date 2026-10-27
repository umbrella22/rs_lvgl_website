use rs_lvgl_browser_engine::{Diagnostic, InterpretedApp, MAX_SOURCE_BYTES};

include!(concat!(env!("OUT_DIR"), "/runtime.rs"));

thread_local! {
    static ORIGIN: Cell<(u32, u32)> = const { Cell::new((1, 1)) };
    static SOURCE: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static PREPARED: RefCell<Option<InterpretedApp>> = const { RefCell::new(None) };
    static ERROR: Rc<RefCell<Option<Diagnostic>>> = Rc::default();
}

fn app() -> InterpretedApp {
    PREPARED.with_borrow_mut(|slot| slot.take()).unwrap_or_else(|| {
        // Invalid bridge use is reported, never panics across the exported ABI.
        let mut fallback = InterpretedApp::new("struct Empty; impl rs_lvgl_ui::App for Empty { type Msg = (); fn update(&mut self, _: ()) {} fn view(&self, theme: &rs_lvgl_ui::Theme) -> rs_lvgl_ui::View<()> { obj() } } fn app() -> impl rs_lvgl_ui::App { Empty }").expect("fixed fallback");
        fallback.diagnostic = ERROR.with(Clone::clone);
        *fallback.diagnostic.borrow_mut() = Some(Diagnostic::new("runtime", proc_macro2::Span::call_site(), "Load source before initializing the preview"));
        fallback
    })
}

/// Return owned writable storage valid until the next reserve/load call. The
/// host must copy exactly `length` UTF-8 bytes before calling exercise_load.
#[no_mangle]
pub extern "C" fn exercise_reserve(length: usize) -> *mut u8 {
    if length > MAX_SOURCE_BYTES {
        return std::ptr::null_mut();
    }
    SOURCE.with_borrow_mut(|source| {
        source.clear();
        source.resize(length, 0);
        source.as_mut_ptr()
    })
}
#[no_mangle]
pub extern "C" fn exercise_load() -> i32 {
    if RUNTIME.with_borrow(|slot| slot.is_some()) {
        return -1;
    }
    ERROR.with(|slot| slot.borrow_mut().take());
    PREPARED.with_borrow_mut(|slot| {
        slot.take();
    });
    let result = SOURCE.with_borrow(|source| match std::str::from_utf8(source) {
        Ok(text) => InterpretedApp::new(text),
        Err(_) => Err(Diagnostic::new(
            "syntax",
            proc_macro2::Span::call_site(),
            "Source must be UTF-8",
        )),
    });
    match result {
        Ok(mut app) => {
            ORIGIN.with(|origin| origin.set(app.view_location()));
            app.diagnostic = ERROR.with(Clone::clone);
            PREPARED.with_borrow_mut(|slot| *slot = Some(app));
            0
        }
        Err(error) => {
            ERROR.with(|slot| *slot.borrow_mut() = Some(error));
            -1
        }
    }
}
/// Borrowed UTF-8 diagnostic storage; valid until the next load/init/frame call.
#[no_mangle]
pub extern "C" fn exercise_error_ptr() -> *const u8 {
    ERROR.with(|slot| {
        slot.borrow()
            .as_ref()
            .map_or(std::ptr::null(), |e| e.message.as_ptr())
    })
}
#[no_mangle]
pub extern "C" fn exercise_error_len() -> usize {
    ERROR.with(|slot| slot.borrow().as_ref().map_or(0, |e| e.message.len()))
}
#[no_mangle]
pub extern "C" fn exercise_error_field(field: u32) -> u32 {
    if field == 5 {
        return ORIGIN.with(|origin| origin.get().0);
    }
    if field == 6 {
        return ORIGIN.with(|origin| origin.get().1);
    }
    ERROR.with(|slot| {
        slot.borrow().as_ref().map_or(0, |e| match field {
            0 => e.line,
            1 => e.column,
            2 => e.end_line,
            3 => e.end_column,
            4 => match e.kind {
                "syntax" => 1,
                "unsupported" => 2,
                "range" => 3,
                "limit" => 4,
                "type" => 5,
                "name" => 6,
                _ => 7,
            },
            _ => 0,
        })
    })
}
