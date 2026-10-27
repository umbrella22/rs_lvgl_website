mod eval;
mod program;
mod ui;
mod value;

use eval::Evaluator;
pub use program::{Diagnostic, Program, MAX_SOURCE_BYTES};
use rs_lvgl_ui::{App, Theme, View};
use std::{cell::RefCell, collections::BTreeMap, rc::Rc};
use value::{Env, Value};

#[derive(Clone)]
pub struct Message {
    handler: Value,
    argument: Option<Value>,
}

pub struct InterpretedApp {
    program: Rc<Program>,
    state: Value,
    pub diagnostic: Rc<RefCell<Option<Diagnostic>>>,
    keys: RefCell<BTreeMap<ui::Identity, u64>>,
}

impl InterpretedApp {
    pub fn new(source: &str) -> Result<Self, Diagnostic> {
        let program = Rc::new(Program::parse(source)?);
        let state =
            Evaluator::new(&program).function("app", vec![], proc_macro2::Span::call_site())?;
        let Value::Record(ref name, _) = state else {
            return Err(Diagnostic::new(
                "type",
                program.entry_span(),
                "app() must return the App struct",
            ));
        };
        if name != &program.app_type {
            return Err(Diagnostic::new(
                "type",
                program.entry_span(),
                "app() returned a different struct",
            ));
        }
        Ok(Self {
            program,
            state,
            diagnostic: Rc::default(),
            keys: RefCell::default(),
        })
    }

    pub fn view_location(&self) -> (u32, u32) {
        let location = self.program.entry_span().start();
        (location.line.max(1) as u32, location.column as u32 + 1)
    }

    fn render(&self, theme: &Theme) -> Result<View<Message>, Diagnostic> {
        let mut evaluator = Evaluator::new(&self.program);
        let method = &self.program.view;
        let mut env = Env::new();
        env.insert("self".into(), self.state.clone());
        evaluator.bind_parameters(&method.sig, vec![Value::Theme(theme.clone())], &mut env)?;
        let value = evaluator.block(&method.block, &mut env)?;
        let Value::Node(node) = value else {
            return Err(Diagnostic::new(
                "type",
                self.program.entry_span(),
                "view() must return a View",
            ));
        };
        ui::materialize(&node, &mut self.keys.borrow_mut(), &mut 512)
    }

    fn dispatch(&mut self, message: Message) -> Result<(), Diagnostic> {
        let mut evaluator = Evaluator::new(&self.program);
        let value = match message.argument {
            Some(argument) => evaluator.closure(message.handler, vec![argument])?,
            None => message.handler,
        };
        let method = &self.program.update;
        let mut env = Env::new();
        env.insert("self".into(), self.state.clone());
        evaluator.allow_state_updates = true;
        evaluator.bind_parameters(&method.sig, vec![value], &mut env)?;
        evaluator.block(&method.block, &mut env)?;
        // Commit only after the complete update succeeds.
        self.state = env.remove("self").unwrap();
        Ok(())
    }
}

impl App for InterpretedApp {
    type Msg = Message;
    fn update(&mut self, message: Message) {
        if self.diagnostic.borrow().is_some() {
            return;
        }
        if let Err(error) = self.dispatch(message) {
            *self.diagnostic.borrow_mut() = Some(error);
        }
    }
    fn view(&self, theme: &Theme) -> View<Message> {
        match self.render(theme) {
            Ok(view) => view,
            Err(error) => {
                *self.diagnostic.borrow_mut() = Some(error);
                rs_lvgl_ui::obj()
            }
        }
    }
}

#[cfg(test)]
mod tests;
