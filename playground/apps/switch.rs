use rs_lvgl_ui::prelude::*;

struct Settings {
    enabled: bool,
    changes: u32,
}

#[derive(Clone)]
enum NotificationSettingsAction {
    Enabled(bool),
    Reset,
}

impl App for Settings {
    type Action = NotificationSettingsAction;

    fn update(&mut self, action: NotificationSettingsAction) {
        match action {
            NotificationSettingsAction::Enabled(value) => {
                self.enabled = value;
                self.changes += 1;
            }
            NotificationSettingsAction::Reset => {
                self.enabled = false;
                self.changes = 0;
            }
        }
    }

    fn view(&self, theme: &Theme) -> View<NotificationSettingsAction> {
        column([
            label("Notifications")
                .font(theme.title_font)
                .text_color(theme.text),
            row([
                switch(self.enabled)
                    .on_value_changed(|value| NotificationSettingsAction::Enabled(value != 0)),
                label(if self.enabled { "Enabled" } else { "Disabled" }),
            ])
            .style(Style::surface(theme))
            .gap(24),
            label(format!("Changed {} times", self.changes)),
            button("Reset")
                .on_click(NotificationSettingsAction::Reset)
                .style(Style::accent(theme)),
        ])
        .style(Style::screen(theme))
        .font(theme.body_font)
        .text_color(theme.text)
        .padding(32)
        .gap(24)
    }
}

fn app() -> impl App {
    Settings {
        enabled: false,
        changes: 0,
    }
}
