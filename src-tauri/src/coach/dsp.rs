//! A small, allocation-free onset detector. Analysis runs off the audio thread.
//! Spectral flux finds re-articulations; a short energy history backtracks their
//! attack instead of dating them at the end of the FFT's look-ahead window.
const N: usize = 512;
const HOP: usize = 128;

pub struct Detector {
    rate: f64,
    gate: f32,
    samples: [f32; N],
    times: [f64; N],
    previous: [f32; N / 2],
    window: [f32; N],
    count: usize,
    floor: f32,
    last: f64,
    previous_flux: f32,
    decimation: usize,
    phase: usize,
    accumulator: f32,
}

impl Detector {
    pub fn new(rate: u32, gate_db: f32) -> Self {
        Self {
            rate: rate as f64 / (rate as f64 / 48_000.).ceil(),
            gate: 10f32.powf(gate_db / 20.0),
            samples: [0.; N],
            times: [0.; N],
            previous: [0.; N / 2],
            window: std::array::from_fn(|i| {
                0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / (N - 1) as f32).cos()
            }),
            count: 0,
            floor: 0.02,
            last: -1e12,
            previous_flux: 0.,
            decimation: (rate as f64 / 48_000.).ceil() as usize,
            phase: 0,
            accumulator: 0.,
        }
    }

    pub fn push(&mut self, sample: f32, at_ms: f64) -> Option<f64> {
        self.accumulator += sample;
        self.phase += 1;
        if self.phase < self.decimation {
            return None;
        }
        let sample = self.accumulator / self.decimation as f32;
        self.accumulator = 0.;
        self.phase = 0;
        let i = self.count % N;
        self.samples[i] = sample;
        self.times[i] = at_ms;
        self.count += 1;
        if self.count < N || self.count.checked_rem(HOP) != Some(0) {
            return None;
        }
        let mut re = [0.; N];
        let mut im = [0.; N];
        let mut peak = 0f32;
        for (i, r) in re.iter_mut().enumerate() {
            let x = self.samples[(self.count + i) % N];
            peak = peak.max(x.abs());
            *r = x * self.window[i];
        }
        fft(&mut re, &mut im);
        let mut flux = 0.;
        for i in 1..N / 2 {
            let magnitude = (re[i] * re[i] + im[i] * im[i]).sqrt() / N as f32;
            let compressed = (1. + magnitude * 500.).ln();
            flux += (compressed - self.previous[i]).max(0.);
            self.previous[i] = compressed;
        }
        flux /= (N / 2) as f32;
        let triggered = peak > self.gate
            && flux > (self.floor * 2.8).max(0.001)
            && flux > self.previous_flux * 1.15
            && at_ms - self.last > 55.;
        self.floor = self.floor * 0.96 + flux.min(self.floor * 3. + 0.02) * 0.04;
        self.previous_flux = flux;
        if !triggered {
            return None;
        }
        // Compare 1 ms energy slices and choose the steepest positive rise in
        // the window. This also dates a repeated note on top of a ringing tail.
        let block = (self.rate / 1000.).round().max(1.) as usize;
        let mut best = 0.;
        let mut best_index = N - HOP;
        let mut previous_energy = 0.;
        for start in (0..N - block).step_by(block) {
            let energy = (0..block)
                .map(|j| self.samples[(self.count + start + j) % N].powi(2))
                .sum::<f32>()
                / block as f32;
            let rise = energy - previous_energy;
            if start > 0 && rise > best {
                best = rise;
                best_index = start;
            }
            previous_energy = energy;
        }
        let onset = self.times[(self.count + best_index) % N];
        if onset - self.last <= 55. {
            return None;
        }
        self.last = onset;
        Some(onset)
    }
}

fn fft(re: &mut [f32; N], im: &mut [f32; N]) {
    let mut j = 0;
    for i in 1..N {
        let mut bit = N >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= N {
        let angle = -std::f32::consts::TAU / len as f32;
        let (wi, wr) = angle.sin_cos();
        for start in (0..N).step_by(len) {
            let (mut r, mut q) = (1., 0.);
            for k in 0..len / 2 {
                let a = start + k;
                let b = a + len / 2;
                let tr = r * re[b] - q * im[b];
                let ti = r * im[b] + q * re[b];
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                (r, q) = (r * wr - q * wi, r * wi + q * wr);
            }
        }
        len *= 2;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn calibration_clicks_are_detectable_at_the_actual_test_volume() {
        use crate::audio::{
            clock::Kind,
            voice::{gain, Bank, Sound},
        };
        let bank = Bank::render(Sound::Click, 48_000);
        let mut d = Detector::new(48_000, -45.);
        let mut hits = Vec::new();
        for i in 0..48_000 * 14 {
            let tick = i / 32_000;
            let offset = i % 32_000;
            let kind = if tick % 4 == 0 {
                Kind::Accent
            } else {
                Kind::Beat
            };
            let x = bank.get(kind).get(offset).copied().unwrap_or(0.) * gain(25);
            if let Some(at) = d.push(x, i as f64 / 48.) {
                hits.push(at);
            }
        }
        assert!(
            hits.len() >= 19,
            "Only {} calibration clicks detected: {hits:?}",
            hits.len()
        );
        for at in hits {
            let offset = at % (2000. / 3.);
            assert!(offset < 10. || offset > 660., "{offset}");
        }
    }
    #[test]
    fn silence_and_sustained_notes_do_not_repeat() {
        let mut d = Detector::new(48_000, -45.);
        let hits: Vec<_> = (0..96_000)
            .filter_map(|i| {
                let t = i as f32 / 48_000.;
                let x = if t < 0.2 {
                    0.
                } else {
                    (t * 220. * std::f32::consts::TAU).sin() * 0.2
                };
                d.push(x, t as f64 * 1000.)
            })
            .collect();
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert!((hits[0] - 200.).abs() < 8., "{hits:?}");
    }
    #[test]
    fn quiet_plucks_above_gate_work_and_noise_below_gate_is_ignored() {
        let mut d = Detector::new(48_000, -45.);
        let mut hits = Vec::new();
        let mut seed = 17u32;
        for i in 0..48_000 * 4 {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = (seed as f32 / u32::MAX as f32 - 0.5) * 0.002;
            let t = i as f64 / 48_000.;
            let x = (0..6)
                .map(|n| {
                    let age = t - (0.5 + n as f64 * 0.4);
                    if !(0.0..0.3).contains(&age) {
                        0.
                    } else {
                        (age * 220. * std::f64::consts::TAU).sin() * (-age * 20.).exp() * 0.012
                    }
                })
                .sum::<f64>() as f32
                + noise;
            if let Some(at) = d.push(x, t * 1000.) {
                hits.push(at);
            }
        }
        assert_eq!(hits.len(), 6, "{hits:?}");
        for (i, at) in hits.iter().enumerate() {
            assert!((at - (500. + 400. * i as f64)).abs() < 10., "{hits:?}");
        }
    }
    #[test]
    fn repeated_plucks_are_dated_at_attack_across_sample_rates() {
        for rate in [44_100, 48_000, 96_000] {
            for frequency in [82., 220., 660.] {
                let mut d = Detector::new(rate, -45.);
                let mut hits = Vec::new();
                for i in 0..rate * 3 {
                    let t = i as f64 / rate as f64;
                    let x = (0..20)
                        .map(|n| {
                            let age = t - (0.3 + n as f64 * 0.1);
                            if !(0.0..0.6).contains(&age) {
                                return 0.;
                            }
                            (age * frequency * std::f64::consts::TAU).sin()
                                * (-age * 12.).exp()
                                * 0.3
                        })
                        .sum::<f64>() as f32;
                    if let Some(at) = d.push(x, t * 1000.) {
                        hits.push(at);
                    }
                }
                assert_eq!(hits.len(), 20, "rate={rate}, f={frequency}, {hits:?}");
                for (i, at) in hits.iter().enumerate() {
                    assert!(
                        (at - (300. + i as f64 * 100.)).abs() < 10.,
                        "rate={rate}, f={frequency}, {hits:?}"
                    );
                }
            }
        }
    }
}
