//! Global shortcuts run ordinary control actions, never audio work.

use parking_lot::Mutex;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const KEYS: [&str; 12] = [
    "Ctrl+Alt+Space",
    "Ctrl+Alt+PageUp",
    "Ctrl+Alt+PageDown",
    "Ctrl+Alt+1",
    "Ctrl+Alt+2",
    "Ctrl+Alt+3",
    "Ctrl+Alt+4",
    "Ctrl+Alt+5",
    "Ctrl+Alt+6",
    "Ctrl+Alt+7",
    "Ctrl+Alt+8",
    "Ctrl+Alt+9",
];

#[derive(Default)]
pub struct Runtime {
    enabled: AtomicBool,
    error: Mutex<Option<String>>,
    held: Mutex<HashSet<u32>>,
    ids: Mutex<Vec<u32>>,
}

impl Runtime {
    pub fn active(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }
    pub fn error(&self) -> Option<String> {
        self.error.lock().clone()
    }
    fn press(&self, id: u32, state: ShortcutState) -> bool {
        let mut held = self.held.lock();
        match state {
            ShortcutState::Pressed => self.active() && held.insert(id),
            ShortcutState::Released => {
                held.remove(&id);
                false
            }
        }
    }
}

pub fn plugin() -> tauri::plugin::TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, key, event| {
            let runtime = app.state::<Runtime>();
            if !runtime.press(key.id(), event.state()) {
                return;
            }
            let action = runtime.ids.lock().iter().position(|id| *id == key.id());
            let h = app.clone();
            // Serialise shortcuts with tray/window actions on the main loop.
            let _ = app.run_on_main_thread(move || {
                if !h.state::<Runtime>().active() {
                    return;
                }
                let result = match action {
                    Some(0) => {
                        crate::control::toggle(&h);
                        Ok(())
                    }
                    Some(1) => crate::practice::cycle(&h, false),
                    Some(2) => crate::practice::cycle(&h, true),
                    Some(i) => crate::practice::apply_slot(&h, i - 3),
                    None => Ok(()),
                };
                crate::practice::report_error(&h, result);
            });
        })
        .build()
}

/// A failed registration releases the whole set so no invisible partial set
/// remains active. The panel names the conflicting key and offers retry.
pub fn configure(app: &AppHandle, enabled: bool, extra_shift: bool) -> Result<(), String> {
    let runtime = app.state::<Runtime>();
    runtime.enabled.store(false, Ordering::SeqCst);
    runtime.held.lock().clear();
    runtime.ids.lock().clear();
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;
    *runtime.error.lock() = None;
    if !enabled {
        return Ok(());
    }
    for key in KEYS {
        let key = if extra_shift {
            key.replace("Ctrl+Alt+", "Ctrl+Alt+Shift+")
        } else {
            key.to_string()
        };
        let shortcut = key.parse::<Shortcut>().map_err(|e| e.to_string())?;
        if let Err(e) = app.global_shortcut().register(shortcut) {
            let _ = app.global_shortcut().unregister_all();
            let message = format!("Could not register {key}. It may be used by another app. Close that binding and try again. ({e})");
            *runtime.error.lock() = Some(message.clone());
            return Err(message);
        }
        runtime.ids.lock().push(shortcut.id());
    }
    runtime.enabled.store(true, Ordering::SeqCst);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn holding_a_key_triggers_only_once_until_release() {
        let r = Runtime::default();
        assert!(!r.press(1, ShortcutState::Pressed));
        r.enabled.store(true, Ordering::SeqCst);
        assert!(r.press(1, ShortcutState::Pressed));
        assert!(!r.press(1, ShortcutState::Pressed));
        assert!(!r.press(1, ShortcutState::Released));
        assert!(r.press(1, ShortcutState::Pressed));
    }
    #[test]
    fn all_bindings_parse_and_are_distinct() {
        let ids: HashSet<_> = KEYS
            .iter()
            .map(|k| k.parse::<Shortcut>().unwrap().id())
            .collect();
        assert_eq!(ids.len(), KEYS.len());
        let shifted: HashSet<_> = KEYS
            .iter()
            .map(|k| {
                k.replace("Ctrl+Alt+", "Ctrl+Alt+Shift+")
                    .parse::<Shortcut>()
                    .unwrap()
                    .id()
            })
            .collect();
        assert_eq!(shifted.len(), KEYS.len());
        assert!(ids.is_disjoint(&shifted));
    }
}
