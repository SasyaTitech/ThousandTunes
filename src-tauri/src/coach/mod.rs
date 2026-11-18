//! Rhythm practice. Only timestamp publication touches the metronome callback;
//! capture, DSP, judging, serialization and UI updates have their own worker.
mod dsp;
mod input;
mod timing;

use crate::{audio::BeatEvent, settings::MetronomeSettings, state::AppState};
use cpal::traits::StreamTrait;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub input_id: String,
    pub channel: u16,
    pub notes_per_beat: u8,
    pub gate_db: f32,
    pub length: usize,
    pub review_length: usize,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            input_id: String::new(),
            channel: 0,
            notes_per_beat: 1,
            gate_db: -45.,
            length: 32,
            review_length: 32,
        }
    }
}
impl Config {
    fn validate(&self) -> Result<(), String> {
        if self.input_id.is_empty() {
            return Err("请先选择吉他输入。".into());
        }
        if ![1, 2].contains(&self.notes_per_beat)
            || ![0, 32, 64, 128].contains(&self.length)
            || ![16, 32, 64, 128].contains(&self.review_length)
            || !self.gate_db.is_finite()
            || !(-70.0..=-12.0).contains(&self.gate_db)
        {
            return Err("练习参数无效。".into());
        }
        Ok(())
    }
}

#[derive(Clone, Serialize)]
pub struct Snapshot {
    pub active: bool,
    pub mode: String,
    pub message: String,
    pub level_db: f32,
    pub clipped: bool,
    pub attacks: usize,
    pub clock_ms: f64,
    pub start_ms: Option<f64>,
    pub interval_ms: f64,
    pub length: usize,
    pub calibrated: bool,
    pub offset_ms: f64,
    pub calibration_jitter_ms: f64,
    pub results: Vec<timing::ResultNote>,
    pub recent_extras: Vec<timing::ExtraCount>,
    pub summary: timing::Summary,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            active: false,
            mode: "idle".into(),
            message: "选择吉他输入，先检查拨弦能否被识别。".into(),
            level_db: -90.,
            clipped: false,
            attacks: 0,
            clock_ms: 0.,
            start_ms: None,
            interval_ms: 500.,
            length: 32,
            calibrated: false,
            offset_ms: 0.,
            calibration_jitter_ms: 0.,
            results: Vec::new(),
            recent_extras: Vec::new(),
            summary: timing::Summary::default(),
        }
    }
}

#[derive(Clone)]
struct Calibration {
    input: String,
    channel: u16,
    rate: u32,
    output: String,
    output_rate: u32,
    offset: f64,
    jitter: f64,
    gate: f32,
}
#[derive(Default)]
struct Inner {
    snapshot: Mutex<Snapshot>,
    beats: Mutex<VecDeque<BeatEvent>>,
    calibration: Mutex<Option<Calibration>>,
    active: AtomicBool,
}
struct Session {
    stop: Arc<AtomicBool>,
    thread: std::thread::JoinHandle<()>,
}
#[derive(Default)]
pub struct Runtime {
    inner: Arc<Inner>,
    session: Mutex<Option<Session>>,
}

impl Runtime {
    pub fn shutdown(&self) {
        if let Some(session) = self.session.lock().as_ref() {
            session.stop.store(true, Ordering::Release);
        }
    }
    pub fn beat(&self, beat: &BeatEvent) {
        if !self.inner.active.load(Ordering::Relaxed) || beat.sub != 0 {
            return;
        }
        let mut beats = self.inner.beats.lock();
        if beats.len() < 64 {
            beats.push_back(beat.clone());
        }
    }
    pub fn stop(&self) {
        let mut session = self.session.lock();
        if let Some(s) = session.take() {
            s.stop.store(true, Ordering::Release);
            let _ = s.thread.join();
        }
    }
    fn start(&self, app: AppHandle, config: Config, mode: String) -> Result<(), String> {
        config.validate()?;
        if !cfg!(windows) {
            return Err("此版跟拍判定需要 Windows WASAPI 的公共时钟。".into());
        }
        if !["monitor", "practice", "calibrate"].contains(&mode.as_str()) {
            return Err("未知练习模式。".into());
        }
        let mut session = self.session.lock();
        if let Some(s) = session.take() {
            s.stop.store(true, Ordering::Release);
            let _ = s.thread.join();
        }
        let state = app.state::<Arc<AppState>>().inner().clone();
        state.settings.try_update(|s| {
            s.coach = config.clone();
            Ok(())
        })?;
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let inner = self.inner.clone();
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let thread = std::thread::Builder::new()
            .name("taktdock-coach".into())
            .spawn(move || {
                let ring = input::Ring::new();
                match input::open(&config.input_id, config.channel, ring.clone()) {
                    Ok((stream, rate)) => {
                        if let Err(e) = stream.play() {
                            let _ = tx.send(Err(e.to_string()));
                            return;
                        }
                        let _ = tx.send(Ok(()));
                        run(
                            &app, &state, &inner, &stopping, stream, ring, rate, config, mode,
                        );
                    }
                    Err(e) => {
                        let _ = tx.send(Err(e));
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        *session = Some(Session { stop, thread });
        rx.recv().map_err(|e| e.to_string())?
    }
}

fn same_timing(a: &MetronomeSettings, b: &MetronomeSettings) -> bool {
    a.bpm == b.bpm
        && a.beats_per_bar == b.beats_per_bar
        && a.beat_unit == b.beat_unit
        && a.subdivision == b.subdivision
        && a.output_device == b.output_device
}
fn publish(app: &AppHandle, inner: &Inner, snapshot: &Snapshot) {
    *inner.snapshot.lock() = snapshot.clone();
    let _ = app.emit("coach", snapshot);
}

#[allow(clippy::too_many_arguments)]
fn run(
    app: &AppHandle,
    state: &AppState,
    inner: &Inner,
    stop: &AtomicBool,
    stream: cpal::Stream,
    ring: Arc<input::Ring>,
    rate: u32,
    config: Config,
    mode: String,
) {
    let original = state.settings.get().metronome;
    let calibrating = mode == "calibrate";
    let playing = mode != "monitor";
    let mut snapshot = Snapshot {
        active: true,
        mode: mode.clone(),
        length: if calibrating { 16 } else { config.length },
        message: if playing {
            "等待音频时钟 · 四拍预备"
        } else {
            "拨几下单音，检查电平和识别次数。"
        }
        .into(),
        ..Default::default()
    };
    inner.beats.lock().clear();
    inner.active.store(true, Ordering::Relaxed);
    let previous_generation = state.engine.generation();
    let mut session_generation = None;
    let earliest_beat = stream
        .now()
        .duration_since(cpal::StreamInstant::ZERO)
        .as_secs_f64()
        * 1000.;
    if calibrating {
        *inner.calibration.lock() = None;
    }
    if playing {
        state.engine.stop();
        if calibrating {
            let mut c = original.clone();
            c.bpm = 90;
            c.subdivision = 1;
            c.sound = "click".into();
            c.volume = 25;
            state.engine.apply(&c);
        }
        state.engine.start();
        crate::control::output_changed(app);
    }
    let began = Instant::now();
    let mut detector = dsp::Detector::new(rate, config.gate_db);
    let mut judge: Option<timing::Judge> = None;
    let mut beat_number = 0usize;
    let mut last_beat = 0.;
    let mut last_input = 0.;
    let mut last_data = Instant::now();
    let mut last_publish = Instant::now();
    let mut peak = 0f32;
    let mut clipped_until = 0.;
    let xruns = state.engine.stats().xruns;
    let mut fingerprint: Option<(String, u32)> = None;
    let mut calibration_values = Vec::new();
    let mut completed = false;
    publish(app, inner, &snapshot);
    while !stop.load(Ordering::Acquire) {
        let now = stream
            .now()
            .duration_since(cpal::StreamInstant::ZERO)
            .as_secs_f64()
            * 1000.;
        snapshot.clock_ms = now;
        let status = state.engine.status();
        if playing {
            if !state.engine.is_running() {
                snapshot.message = "节拍已停止，本轮已结束。".into();
                break;
            }
            let current = state.settings.get().metronome;
            if !same_timing(&original, &current)
                || (calibrating
                    && (current.sound != original.sound
                        || current.volume != original.volume
                        || current.accent_first != original.accent_first))
            {
                snapshot.message = "速度、节奏或输出已更改。请重新开始一轮。".into();
                break;
            }
            if status.silent || status.problem.is_some() || state.engine.stats().xruns > xruns {
                snapshot.message = "输出时序出现中断，本轮已停止判定。检查音频设备后重试。".into();
                break;
            }
            if let Some((ref output, output_rate)) = fingerprint {
                if status.active_device.as_ref() != Some(output)
                    || status.sample_rate != Some(output_rate)
                {
                    snapshot.message = "输出设备或采样率已改变，请重新开始并校准。".into();
                    break;
                }
            }
        }
        let beats: Vec<_> = inner.beats.lock().drain(..).collect();
        for beat in beats {
            if !playing {
                continue;
            }
            let period = 60_000. / beat.bpm as f64;
            if judge.is_none() {
                // Delivery may be delayed by the UI/tray: use native sample
                // time and the restart identity, never event-arrival age.
                if beat.audio_ms < earliest_beat || beat.generation == previous_generation {
                    continue;
                }
                let current_output = state.engine.status();
                fingerprint = current_output.active_device.zip(current_output.sample_rate);
                if fingerprint.is_none() {
                    continue;
                }
                let cal = inner.calibration.lock().clone();
                if let Some(c) = cal.filter(|c| {
                    c.input == config.input_id
                        && c.channel == config.channel
                        && c.rate == rate
                        && c.gate == config.gate_db
                        && fingerprint
                            .as_ref()
                            .is_some_and(|(name, sr)| *name == c.output && *sr == c.output_rate)
                }) {
                    snapshot.calibrated = true;
                    snapshot.offset_ms = c.offset;
                    snapshot.calibration_jitter_ms = c.jitter;
                }
                snapshot.interval_ms = period
                    / if calibrating {
                        1.
                    } else {
                        config.notes_per_beat as f64
                    };
                let start = beat.audio_ms + 4. * period;
                snapshot.start_ms = Some(start);
                judge = Some(timing::Judge::new(start, snapshot.interval_ms));
                session_generation = Some(beat.generation);
                last_beat = beat.audio_ms;
                beat_number = 0;
            } else {
                if Some(beat.generation) != session_generation
                    || (beat.audio_ms - last_beat - period).abs() > 15.
                {
                    snapshot.message = "音频时钟有跳变，本轮已停止判定。".into();
                    break;
                }
                beat_number += 1;
                last_beat = beat.audio_ms;
                if let Some(j) = judge.as_mut() {
                    j.start = beat.audio_ms + (4. - beat_number as f64) * period;
                    snapshot.start_ms = Some(j.start);
                }
            }
        }
        if snapshot.message.contains("时钟有跳变") {
            break;
        }
        if playing && judge.is_none() && began.elapsed() > Duration::from_secs(5) {
            snapshot.message = "没有收到可靠的音频节拍，请检查输出。".into();
            break;
        }
        let mut bad_time = false;
        // A bounded batch leaves stop and device checks responsive even if the
        // analysis worker falls behind. Overflow makes the session invalid.
        for _ in 0..16_384 {
            let Some((x, at)) = ring.pop() else {
                break;
            };
            if last_input > 0. && ((at - last_input) - 1000. / rate as f64).abs() > 5. {
                bad_time = true;
                break;
            }
            last_input = at;
            last_data = Instant::now();
            peak = peak.max(x.abs());
            if x.abs() >= 0.98 {
                clipped_until = at + 500.;
            }
            if let Some(onset) = detector.push(x, at) {
                snapshot.attacks += 1;
                if let Some(j) = judge.as_mut() {
                    let corrected = onset - snapshot.offset_ms;
                    let end = j.last_target(snapshot.length).map(|t| t + j.window());
                    if end.is_none_or(|end| corrected <= end) {
                        let before = j.summary.played;
                        j.onset(corrected, at > clipped_until);
                        if calibrating && j.summary.played > before {
                            calibration_values.push(j.results.last().unwrap().delta_ms.unwrap());
                        }
                    }
                }
            }
        }
        if ring.failed.load(Ordering::Relaxed)
            || bad_time
            || last_data.elapsed() > Duration::from_secs(2)
            || (last_input > 0. && now - last_input > 300.)
        {
            snapshot.message = "输入断流或处理来不及，本轮已停止。检查声卡连接和系统负载。".into();
            break;
        }
        snapshot.clipped = now < clipped_until;
        if let Some(j) = judge.as_mut() {
            let watermark = last_input - snapshot.offset_ms;
            let reached_end = j.advance_session(watermark, snapshot.length);
            snapshot.summary = j.summary.clone();
            snapshot.results = j.results.clone();
            snapshot.recent_extras = j.recent_extras();
            if now < j.start {
                snapshot.message = "四拍预备 · 听节拍再开始".into();
            } else {
                snapshot.message = if calibrating {
                    "正在测量回送延迟，请不要弹奏。"
                } else if snapshot.calibrated {
                    "跟着节拍弹奏 · 已应用本次回送校准"
                } else {
                    "参考模式 · 未校准设备延迟，早晚数值仅供参考"
                }
                .into();
            }
            if reached_end {
                completed = true;
                break;
            }
        }
        if last_publish.elapsed() >= Duration::from_millis(50) {
            snapshot.level_db = 20. * peak.max(0.00003).log10();
            peak = 0.;
            publish(app, inner, &snapshot);
            last_publish = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(3));
    }
    drop(stream);
    inner.active.store(false, Ordering::Relaxed);
    if playing {
        state.engine.stop();
    }
    if calibrating {
        // Restore the latest user settings, including edits made mid-calibration.
        state.engine.apply(&state.settings.get().metronome);
        if completed {
            match timing::calibration(
                &calibration_values,
                snapshot.summary.missed + snapshot.summary.uncertain,
                snapshot.summary.extra,
            ) {
                Ok((offset, jitter)) => {
                    if let Some((output, output_rate)) = fingerprint {
                        *inner.calibration.lock() = Some(Calibration {
                            input: config.input_id,
                            channel: config.channel,
                            rate,
                            output,
                            output_rate,
                            offset,
                            jitter,
                            gate: config.gate_db,
                        });
                        snapshot.calibrated = true;
                        snapshot.offset_ms = offset;
                        snapshot.calibration_jitter_ms = jitter;
                        snapshot.message = format!("校准完成：补偿 {offset:+.1} ms，回送波动 {jitter:.1} ms。恢复吉他连线后可开始练习。");
                    }
                }
                Err(e) => snapshot.message = e,
            }
        }
    } else if completed {
        snapshot.message = "本轮完成。看看整体偏早／偏晚，以及每次拨弦的稳定程度。".into();
    }
    if stop.load(Ordering::Acquire) {
        snapshot.message = "已结束。输入已释放；保留最近的练习结果。".into();
    }
    snapshot.active = false;
    snapshot.level_db = -90.;
    publish(app, inner, &snapshot);
    crate::control::output_changed(app);
}

#[derive(Serialize)]
pub struct View {
    config: Config,
    status: Snapshot,
}
#[tauri::command]
pub fn get_coach(app: AppHandle) -> View {
    View {
        config: app.state::<Arc<AppState>>().settings.get().coach,
        status: app.state::<Arc<Runtime>>().inner.snapshot.lock().clone(),
    }
}
#[tauri::command]
pub async fn get_input_devices() -> Result<Vec<input::InputDevice>, String> {
    tauri::async_runtime::spawn_blocking(input::devices)
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn coach_start(app: AppHandle, config: Config, mode: String) -> Result<(), String> {
    let runtime = app.state::<Arc<Runtime>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.start(app, config, mode))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn coach_set_review_length(app: AppHandle, length: usize) -> Result<(), String> {
    if ![16, 32, 64, 128].contains(&length) {
        return Err("回顾范围无效。".into());
    }
    app.state::<Arc<AppState>>()
        .settings
        .try_update(|s| {
            s.coach.review_length = length;
            Ok(())
        })
        .map(|_| ())
}
#[tauri::command]
pub async fn coach_stop(app: AppHandle) -> Result<(), String> {
    let runtime = app.state::<Arc<Runtime>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.stop())
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_configuration_never_reaches_audio() {
        assert!(Config::default().validate().is_err());
        let good = Config {
            input_id: "explicit-device".into(),
            ..Default::default()
        };
        assert!(good.validate().is_ok());
        assert!(Config {
            length: 0,
            ..good.clone()
        }
        .validate()
        .is_ok());
        for bad in [
            Config {
                gate_db: f32::NAN,
                ..good.clone()
            },
            Config {
                notes_per_beat: 3,
                ..good.clone()
            },
            Config {
                length: usize::MAX,
                ..good.clone()
            },
            Config {
                review_length: 0,
                ..good.clone()
            },
        ] {
            assert!(bad.validate().is_err());
        }
    }
    #[test]
    fn old_settings_keep_their_length_and_gain_a_default_review_window() {
        let config: Config = serde_json::from_str(r#"{"input_id":"analog","length":64}"#).unwrap();
        assert_eq!(config.length, 64);
        assert_eq!(config.review_length, 32);
        assert!(config.validate().is_ok());
        let continuous = Config {
            length: 0,
            review_length: 128,
            ..config
        };
        let restored: Config =
            serde_json::from_str(&serde_json::to_string(&continuous).unwrap()).unwrap();
        assert_eq!((restored.length, restored.review_length), (0, 128));
    }
    #[test]
    fn detector_and_judge_keep_timestamps_when_delivery_is_batched() {
        for batch in [64, 480, 4096] {
            let rate = 48_000;
            let mut d = dsp::Detector::new(rate, -45.);
            let mut j = timing::Judge::new(500., 500.);
            let errors = [-40., 10., 55., -10.];
            let signal: Vec<_> = (0..rate * 3)
                .map(|i| {
                    let ms = i as f64 * 1000. / rate as f64;
                    let value = errors
                        .iter()
                        .enumerate()
                        .map(|(n, delta)| {
                            let t = (ms - (500. + 500. * n as f64 + delta)) / 1000.;
                            if !(0.0..0.4).contains(&t) {
                                0.
                            } else {
                                (t * 220. * std::f64::consts::TAU).sin() * (-t * 15.).exp() * 0.3
                            }
                        })
                        .sum::<f64>() as f32;
                    (value, ms)
                })
                .collect();
            for block in signal.chunks(batch) {
                for &(x, at) in block {
                    if let Some(onset) = d.push(x, at) {
                        j.onset(onset, true);
                    }
                }
                j.advance(block.last().unwrap().1.min(2206.));
            }
            assert_eq!(j.summary.played, 4);
            for (note, expected) in j.results.iter().zip(errors) {
                assert!((note.delta_ms.unwrap() - expected).abs() < 8.);
            }
        }
    }
    /// Explicit hardware check: output is silent; synthetic guitar analysis
    /// runs concurrently. Enumerating inputs does not open a microphone.
    #[test]
    #[ignore]
    fn live_output_with_coach_analysis() {
        for d in input::devices().unwrap() {
            println!(
                "input: {} ({} ch, {} Hz)",
                d.name, d.channels, d.sample_rate
            );
        }
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let engine = crate::audio::Engine::new(
            &MetronomeSettings {
                bpm: 240,
                volume: 0,
                ..Default::default()
            },
            false,
            Arc::new(move |n| {
                if let crate::audio::Notice::Beat(b) = n {
                    sink.lock().push(b.audio_ms);
                }
            }),
        );
        engine.start();
        let began = Instant::now();
        let mut frame = 0u64;
        let mut d = dsp::Detector::new(96_000, -45.);
        while began.elapsed() < Duration::from_secs(4) {
            for _ in 0..960 {
                let t = frame as f64 / 96_000.;
                d.push(
                    (t * 220. * std::f64::consts::TAU).sin() as f32 * 0.2,
                    t * 1000.,
                );
                frame += 1;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let stats = engine.stats();
        let status = engine.status();
        println!("output: {status:?}\nstats: {stats:?}");
        engine.stop();
        engine.shutdown();
        assert!(!status.silent && status.active_device.is_some());
        assert_eq!(stats.xruns, 0);
        let beats = seen.lock();
        assert!(beats.len() >= 12);
        let errors: Vec<_> = beats
            .windows(2)
            .skip(1)
            .map(|w| (w[1] - w[0] - 250.).abs())
            .collect();
        println!(
            "maximum host-clock beat spacing error: {} ms",
            errors.iter().copied().fold(0., f64::max)
        );
        assert!(errors.iter().all(|e| *e < 2.));
    }
}
