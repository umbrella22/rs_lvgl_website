use rs_lvgl_ui::prelude::*;

struct Settings {
    enabled: bool,
    changes: u32,
}

#[derive(Clone)]
enum Message {
    Enabled(bool),
    Reset,
}

impl App for Settings {
    type Msg = Message;

    fn update(&mut self, message: Message) {
        match message {
            Message::Enabled(value) => {
                self.enabled = value;
                self.changes += 1;
            }
            Message::Reset => {
                self.enabled = false;
                self.changes = 0;
            }
        }
    }

    fn view(&self, theme: &Theme) -> View<Message> {
        column([
            label("Notifications").style(Style::title(theme)),
            row([
                switch(self.enabled).on_value_changed(|value| Message::Enabled(value != 0)),
                label(if self.enabled { "Enabled" } else { "Disabled" }),
            ])
            .style(Style::surface(theme).gap(24)),
            label(format!("Changed {} times", self.changes)),
            button("Reset")
                .on_click(Message::Reset)
                .style(Style::accent(theme)),
        ])
        .style(Style::screen(theme).pad(32).gap(24))
    }
}

fn app() -> impl App {
    Settings {
        enabled: false,
        changes: 0,
    }
}
