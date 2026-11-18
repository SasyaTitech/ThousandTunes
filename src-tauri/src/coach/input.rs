use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering},
    Arc,
};

const CAPACITY: usize = 65_536;
/// Single producer/single consumer. Publication/reclamation use acquire-release;
/// neither callback allocates, waits, logs, nor calls the UI.
pub struct Ring {
    values: Box<[AtomicU32]>,
    times: Box<[AtomicU64]>,
    head: AtomicUsize,
    tail: AtomicUsize,
    pub failed: AtomicBool,
}
impl Ring {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            values: (0..CAPACITY).map(|_| AtomicU32::new(0)).collect(),
            times: (0..CAPACITY).map(|_| AtomicU64::new(0)).collect(),
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
            failed: AtomicBool::new(false),
        })
    }
    fn push(&self, value: f32, at: f64) {
        let head = self.head.load(Ordering::Relaxed);
        if head.wrapping_sub(self.tail.load(Ordering::Acquire)) >= CAPACITY {
            self.failed.store(true, Ordering::Relaxed);
            return;
        }
        let index = head % CAPACITY;
        self.values[index].store(value.to_bits(), Ordering::Relaxed);
        self.times[index].store(at.to_bits(), Ordering::Relaxed);
        self.head.store(head.wrapping_add(1), Ordering::Release);
    }
    pub fn pop(&self) -> Option<(f32, f64)> {
        let tail = self.tail.load(Ordering::Relaxed);
        if tail == self.head.load(Ordering::Acquire) {
            return None;
        }
        let index = tail % CAPACITY;
        let value = f32::from_bits(self.values[index].load(Ordering::Relaxed));
        let at = f64::from_bits(self.times[index].load(Ordering::Relaxed));
        self.tail.store(tail.wrapping_add(1), Ordering::Release);
        Some((value, at))
    }
}

#[derive(Serialize)]
pub struct InputDevice {
    pub id: String,
    pub name: String,
    pub channels: u16,
    pub sample_rate: u32,
}
pub fn devices() -> Result<Vec<InputDevice>, String> {
    let host = cpal::default_host();
    let mut result = Vec::new();
    for d in host.input_devices().map_err(|e| e.to_string())? {
        if let (Ok(id), Ok(desc), Ok(c)) = (d.id(), d.description(), d.default_input_config()) {
            result.push(InputDevice {
                id: id.to_string(),
                name: desc.name().to_string(),
                channels: c.channels(),
                sample_rate: c.sample_rate(),
            });
        }
    }
    Ok(result)
}

pub fn open(id: &str, channel: u16, ring: Arc<Ring>) -> Result<(cpal::Stream, u32), String> {
    let host = cpal::default_host();
    let device = host
        .input_devices()
        .map_err(|e| e.to_string())?
        .find(|d| d.id().is_ok_and(|v| v.to_string() == id))
        .ok_or("所选输入已断开。请重新选择；不会自动切换到麦克风。")?;
    let c = device.default_input_config().map_err(|e| e.to_string())?;
    if channel >= c.channels() {
        return Err("所选输入通道不存在。".into());
    }
    let rate = c.sample_rate();
    let config = c.config();
    use cpal::SampleFormat as F;
    let stream = match c.sample_format() {
        F::F32 => build::<f32>(&device, config, channel, ring),
        F::F64 => build::<f64>(&device, config, channel, ring),
        F::I16 => build::<i16>(&device, config, channel, ring),
        F::I32 => build::<i32>(&device, config, channel, ring),
        F::U16 => build::<u16>(&device, config, channel, ring),
        other => return Err(format!("暂不支持这种输入格式：{other}")),
    }?;
    Ok((stream, rate))
}

fn build<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channel: u16,
    ring: Arc<Ring>,
) -> Result<cpal::Stream, String>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    let channels = config.channels as usize;
    let step = 1000. / config.sample_rate as f64;
    let errors = ring.clone();
    device
        .build_input_stream::<T, _, _>(
            config,
            move |data, info| {
                let at = info
                    .timestamp()
                    .capture
                    .duration_since(cpal::StreamInstant::ZERO)
                    .as_secs_f64()
                    * 1000.;
                for (i, frame) in data.chunks_exact(channels).enumerate() {
                    let x: f32 = cpal::Sample::from_sample(frame[channel as usize]);
                    if !x.is_finite() {
                        ring.failed.store(true, Ordering::Relaxed);
                        return;
                    }
                    ring.push(x, at + i as f64 * step);
                }
            },
            move |error| {
                if error.kind() != cpal::ErrorKind::RealtimeDenied {
                    errors.failed.store(true, Ordering::Relaxed);
                }
            },
            None,
        )
        .map_err(|e| format!("无法打开输入：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ring_preserves_sample_times_and_reports_overflow() {
        let r = Ring::new();
        for i in 0..CAPACITY {
            r.push(i as f32, i as f64 * 0.25);
        }
        r.push(0., 0.);
        assert!(r.failed.load(Ordering::Relaxed));
        for i in 0..CAPACITY {
            assert_eq!(r.pop(), Some((i as f32, i as f64 * 0.25)));
        }
        assert_eq!(r.pop(), None);
    }
}
