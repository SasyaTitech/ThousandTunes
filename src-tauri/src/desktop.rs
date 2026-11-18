//! The practice edition's ordinary desktop window and direct controls.

use crate::{
    settings::{self, MetronomeSettings},
    state::{AppState, Transport},
};
use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

pub const LABEL: &str = "main";

pub fn open(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(LABEL) {
        win.unminimize().map_err(|e| e.to_string())?;
        win.show().map_err(|e| e.to_string())?;
        return win.set_focus().map_err(|e| e.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        app,
        LABEL,
        tauri::WebviewUrl::App("index.html?view=main".into()),
    )
    .title("TaktDock — Practice")
    .inner_size(1000.0, 720.0)
    .min_inner_size(640.0, 540.0)
    .decorations(true)
    .resizable(true)
    .skip_taskbar(false)
    .always_on_top(false)
    .center()
    .focused(true)
    .build()
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[derive(Default, Deserialize)]
pub struct Controls {
    bpm: Option<u32>,
    meter: Option<(u8, u8)>,
    subdivision: Option<u8>,
    accent_first: Option<bool>,
    sound: Option<String>,
    volume: Option<u8>,
    /// An empty string follows the system default; omission leaves it alone.
    output_device: Option<String>,
}

impl Controls {
    fn apply(self, current: &MetronomeSettings) -> Result<MetronomeSettings, String> {
        let mut next = current.clone();
        if let Some(bpm) = self.bpm {
            if !(settings::MIN_BPM..=settings::MAX_BPM).contains(&bpm) {
                return Err("Tempo must be between 30 and 300 BPM.".into());
            }
            next.bpm = bpm;
        }
        if let Some(meter) = self.meter {
            if !settings::METERS.contains(&meter) {
                return Err("Unsupported meter.".into());
            }
            (next.beats_per_bar, next.beat_unit) = meter;
        }
        if let Some(n) = self.subdivision {
            if !settings::SUBDIVISIONS.contains(&n) {
                return Err("Unsupported subdivision.".into());
            }
            next.subdivision = n;
        }
        if let Some(value) = self.accent_first {
            next.accent_first = value;
        }
        if let Some(sound) = self.sound {
            if !settings::SOUNDS.contains(&sound.as_str()) {
                return Err("Unsupported sound.".into());
            }
            next.sound = sound;
        }
        if let Some(volume) = self.volume {
            if volume > 100 {
                return Err("Volume must be between 0 and 100.".into());
            }
            next.volume = volume;
        }
        if let Some(device) = self.output_device {
            next.output_device = if device.is_empty() {
                None
            } else {
                Some(device)
            };
        }
        Ok(next)
    }
}

#[tauri::command]
pub fn set_main_controls(app: AppHandle, controls: Controls) -> Result<Transport, String> {
    let state = app.state::<Arc<AppState>>();
    let snapshot = state.settings.try_update(|s| {
        s.metronome = controls.apply(&s.metronome)?;
        if let Some(preset) = s
            .practice
            .presets
            .iter()
            .find(|p| Some(p.id) == s.practice.selected_id)
        {
            if !preset.matches(&s.metronome) {
                s.practice.selected_id = None;
            }
        }
        Ok(())
    })?;
    state.engine.apply(&snapshot.metronome);
    crate::practice::announce(&app);
    Ok(state.transport())
}

#[tauri::command]
pub fn get_output_devices(state: tauri::State<'_, Arc<AppState>>) -> Vec<String> {
    state.engine.status().devices
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_controls_preserve_output_and_reject_invalid_input() {
        let original = MetronomeSettings {
            output_device: Some("GT-1000CORE".into()),
            volume: 42,
            ..Default::default()
        };
        let updated = Controls {
            bpm: Some(95),
            meter: Some((7, 8)),
            subdivision: Some(3),
            ..Default::default()
        }
        .apply(&original)
        .unwrap();
        assert_eq!(
            (
                updated.bpm,
                updated.beats_per_bar,
                updated.beat_unit,
                updated.subdivision
            ),
            (95, 7, 8, 3)
        );
        assert_eq!(updated.output_device, original.output_device);
        assert_eq!(updated.volume, 42);
        for bad in [
            Controls {
                bpm: Some(0),
                ..Default::default()
            },
            Controls {
                meter: Some((9, 16)),
                ..Default::default()
            },
            Controls {
                subdivision: Some(5),
                ..Default::default()
            },
            Controls {
                volume: Some(101),
                ..Default::default()
            },
            Controls {
                sound: Some("unknown".into()),
                ..Default::default()
            },
        ] {
            assert!(bad.apply(&original).is_err());
        }
        let default_device = Controls {
            output_device: Some(String::new()),
            ..Default::default()
        }
        .apply(&original)
        .unwrap();
        assert!(default_device.output_device.is_none());
    }
}
