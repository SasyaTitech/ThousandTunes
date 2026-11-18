//! Named practice settings and their tray, window and shortcut actions.

use crate::settings::{MetronomeSettings, MAX_BPM, METERS, MIN_BPM, SUBDIVISIONS};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

pub const MAX_PRESETS: usize = 9;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Preset {
    pub id: u32,
    pub name: String,
    pub bpm: u32,
    pub beats_per_bar: u8,
    pub beat_unit: u8,
    pub subdivision: u8,
    pub accent_first: bool,
}

impl Preset {
    pub fn validate(&mut self) -> Result<(), String> {
        self.name = self.name.trim().to_string();
        if self.name.is_empty()
            || self.name.chars().count() > 40
            || self.name.chars().any(char::is_control)
        {
            return Err("Use a name of 1 to 40 characters, without line breaks.".into());
        }
        if !(MIN_BPM..=MAX_BPM).contains(&self.bpm) {
            return Err("Tempo must be between 30 and 300 BPM.".into());
        }
        if !METERS.contains(&(self.beats_per_bar, self.beat_unit))
            || !SUBDIVISIONS.contains(&self.subdivision)
        {
            return Err("Choose a supported meter and subdivision.".into());
        }
        Ok(())
    }

    pub fn matches(&self, m: &MetronomeSettings) -> bool {
        self.bpm == m.bpm
            && self.beats_per_bar == m.beats_per_bar
            && self.beat_unit == m.beat_unit
            && self.subdivision == m.subdivision
            && self.accent_first == m.accent_first
    }

    fn apply(&self, m: &mut MetronomeSettings) {
        m.bpm = self.bpm;
        m.beats_per_bar = self.beats_per_bar;
        m.beat_unit = self.beat_unit;
        m.subdivision = self.subdivision;
        m.accent_first = self.accent_first;
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct PracticeSettings {
    pub presets: Vec<Preset>,
    pub selected_id: Option<u32>,
    pub shortcuts_enabled: bool,
    pub shortcut_extra_shift: bool,
}

impl PracticeSettings {
    pub fn sanitise(&mut self) {
        let mut ids = std::collections::HashSet::new();
        self.presets
            .retain_mut(|p| p.id != 0 && p.validate().is_ok() && ids.insert(p.id));
        self.presets.truncate(MAX_PRESETS);
        if !self.presets.iter().any(|p| Some(p.id) == self.selected_id) {
            self.selected_id = None;
        }
    }

    pub fn save(&mut self, mut preset: Preset) -> Result<(), String> {
        preset.validate()?;
        if preset.id == 0 {
            if self.presets.len() >= MAX_PRESETS {
                return Err("All 9 preset slots are full. Edit or remove one first.".into());
            }
            preset.id = (1..=u32::MAX)
                .find(|id| self.presets.iter().all(|p| p.id != *id))
                .unwrap();
            self.presets.push(preset);
        } else {
            let existing = self
                .presets
                .iter_mut()
                .find(|p| p.id == preset.id)
                .ok_or("This preset no longer exists. Reload the practice window.")?;
            *existing = preset;
        }
        Ok(())
    }

    pub fn remove(&mut self, id: u32) -> Result<(), String> {
        let i = self
            .presets
            .iter()
            .position(|p| p.id == id)
            .ok_or("Preset not found.")?;
        self.presets.remove(i);
        if self.selected_id == Some(id) {
            self.selected_id = None;
        }
        Ok(())
    }

    pub fn adjacent(&self, forward: bool) -> Option<u32> {
        let n = self.presets.len();
        if n == 0 {
            return None;
        }
        let current = self
            .presets
            .iter()
            .position(|p| Some(p.id) == self.selected_id);
        let i = match current {
            Some(i) if forward => (i + 1) % n,
            Some(i) => (i + n - 1) % n,
            None if forward => 0,
            None => n - 1,
        };
        Some(self.presets[i].id)
    }
}

#[derive(Clone, Serialize)]
pub struct PracticeView {
    #[serde(flatten)]
    pub settings: PracticeSettings,
    pub shortcuts_active: bool,
    pub shortcut_error: Option<String>,
}

#[tauri::command]
pub fn get_practice(app: AppHandle) -> PracticeView {
    view(&app)
}

fn view(app: &AppHandle) -> PracticeView {
    let runtime = app.state::<crate::shortcuts::Runtime>();
    PracticeView {
        settings: app.state::<Arc<AppState>>().settings.get().practice,
        shortcuts_active: runtime.active(),
        shortcut_error: runtime.error(),
    }
}

pub fn announce(app: &AppHandle) {
    let _ = app.emit("practice", view(app));
    crate::control::output_changed(app);
}

#[tauri::command]
pub fn save_practice_preset(app: AppHandle, preset: Preset) -> Result<PracticeView, String> {
    app.state::<Arc<AppState>>()
        .settings
        .try_update(|s| s.practice.save(preset))?;
    announce(&app);
    Ok(view(&app))
}

#[tauri::command]
pub fn delete_practice_preset(app: AppHandle, id: u32) -> Result<PracticeView, String> {
    app.state::<Arc<AppState>>()
        .settings
        .try_update(|s| s.practice.remove(id))?;
    announce(&app);
    Ok(view(&app))
}

#[tauri::command]
pub fn apply_practice_preset(app: AppHandle, id: u32) -> Result<(), String> {
    apply(&app, id)
}

pub fn apply(app: &AppHandle, id: u32) -> Result<(), String> {
    let state = app.state::<Arc<AppState>>();
    let snapshot = state.settings.try_update(|s| {
        let p = s
            .practice
            .presets
            .iter()
            .find(|p| p.id == id)
            .ok_or("Preset not found.")?;
        p.apply(&mut s.metronome);
        s.practice.selected_id = Some(id);
        Ok(())
    })?;
    state.engine.apply_preset(&snapshot.metronome);
    announce(app);
    Ok(())
}

pub fn cycle(app: &AppHandle, forward: bool) -> Result<(), String> {
    let id = app
        .state::<Arc<AppState>>()
        .settings
        .get()
        .practice
        .adjacent(forward);
    if let Some(id) = id {
        apply(app, id)?;
    }
    Ok(())
}

pub fn apply_slot(app: &AppHandle, slot: usize) -> Result<(), String> {
    let id = app
        .state::<Arc<AppState>>()
        .settings
        .get()
        .practice
        .presets
        .get(slot)
        .map(|p| p.id);
    if let Some(id) = id {
        apply(app, id)?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_practice_shortcuts(
    app: AppHandle,
    enabled: bool,
    extra_shift: bool,
) -> Result<PracticeView, String> {
    crate::shortcuts::configure(&app, enabled, extra_shift)?;
    if let Err(e) = app.state::<Arc<AppState>>().settings.try_update(|s| {
        s.practice.shortcuts_enabled = enabled;
        s.practice.shortcut_extra_shift = extra_shift;
        Ok(())
    }) {
        let previous = app.state::<Arc<AppState>>().settings.get().practice;
        let _ = crate::shortcuts::configure(
            &app,
            previous.shortcuts_enabled,
            previous.shortcut_extra_shift,
        );
        return Err(e);
    }
    announce(&app);
    Ok(view(&app))
}

pub fn open(app: &AppHandle) -> Result<(), String> {
    if cfg!(feature = "practice-build") {
        return crate::desktop::open(app);
    }
    if let Some(win) = app.get_webview_window("practice") {
        win.unminimize().map_err(|e| e.to_string())?;
        win.show().map_err(|e| e.to_string())?;
        return win.set_focus().map_err(|e| e.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        app,
        "practice",
        tauri::WebviewUrl::App("index.html?view=practice".into()),
    )
    .title("TaktDock practice presets")
    .inner_size(560.0, 670.0)
    .min_inner_size(450.0, 480.0)
    .center()
    .focused(true)
    .build()
    .map(|_| ())
    .map_err(|e| e.to_string())
}

pub fn report_error(app: &AppHandle, result: Result<(), String>) {
    if let Err(e) = result {
        tracing::warn!("practice action failed: {e}");
        if app.get_webview_window("practice").is_some() {
            let _ = app.emit("practice-error", &e);
            let _ = open(app);
        } else {
            crate::diagnostics::message_box("TaktDock practice presets", &e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn preset(id: u32) -> Preset {
        Preset {
            id,
            name: "Guitar warmup".into(),
            bpm: 97,
            beats_per_bar: 3,
            beat_unit: 4,
            subdivision: 3,
            accent_first: false,
        }
    }
    #[test]
    fn save_edit_delete_and_reload_preserve_slot_order() {
        let mut s = PracticeSettings::default();
        s.save(preset(0)).unwrap();
        s.save(preset(0)).unwrap();
        let mut edit = s.presets[0].clone();
        edit.name = "  Slow scales  ".into();
        s.save(edit).unwrap();
        assert_eq!(s.presets[0].name, "Slow scales");
        s.selected_id = Some(s.presets[0].id);
        assert_eq!(s.adjacent(false), Some(s.presets[1].id));
        let json = serde_json::to_string(&s).unwrap();
        let mut loaded: PracticeSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(loaded.presets, s.presets);
        loaded.remove(s.presets[0].id).unwrap();
        assert_eq!(loaded.selected_id, None);
        assert_eq!(loaded.adjacent(true), Some(s.presets[1].id));
    }
    #[test]
    fn invalid_and_overfull_presets_are_rejected() {
        let mut s = PracticeSettings::default();
        let mut p = preset(0);
        p.bpm = 0;
        assert!(s.save(p).is_err());
        let mut p = preset(0);
        p.name = " \n ".into();
        assert!(s.save(p).is_err());
        let mut p = preset(0);
        p.subdivision = 5;
        assert!(s.save(p).is_err());
        for _ in 0..MAX_PRESETS {
            s.save(preset(0)).unwrap();
        }
        assert!(s.save(preset(0)).is_err());
        assert!(s.save(preset(999)).is_err());
        assert_eq!(s.presets.len(), MAX_PRESETS);
    }
    #[test]
    fn loading_legacy_settings_and_invalid_presets_is_safe() {
        let legacy: crate::settings::Settings =
            serde_json::from_str(r#"{"schema_version":1}"#).unwrap();
        assert!(legacy.practice.presets.is_empty());
        assert!(!legacy.practice.shortcuts_enabled);
        let mut s = PracticeSettings {
            presets: vec![preset(1), preset(1), preset(0)],
            selected_id: Some(99),
            ..Default::default()
        };
        s.sanitise();
        assert_eq!(s.presets.len(), 1);
        assert_eq!(s.selected_id, None);
    }
    #[test]
    fn recalling_preserves_the_interface_volume_and_sound() {
        let mut m = MetronomeSettings {
            output_device: Some("GT-1000CORE".into()),
            volume: 23,
            sound: "wood".into(),
            ..Default::default()
        };
        let p = preset(1);
        p.apply(&mut m);
        assert!(p.matches(&m));
        assert_eq!(m.volume, 23);
        assert_eq!(m.sound, "wood");
        assert_eq!(m.output_device.as_deref(), Some("GT-1000CORE"));
    }
}
