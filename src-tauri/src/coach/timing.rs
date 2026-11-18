use serde::Serialize;
use std::collections::{BTreeMap, HashSet};

const HISTORY_LIMIT: usize = 128;

#[derive(Clone, Debug, Serialize)]
pub struct ExtraCount {
    pub index: usize,
    pub count: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct ResultNote {
    pub index: usize,
    pub target_ms: f64,
    pub delta_ms: Option<f64>,
    pub kind: &'static str,
}

#[derive(Clone, Default, Serialize)]
pub struct Summary {
    pub played: usize,
    pub on_time: usize,
    pub missed: usize,
    pub extra: usize,
    pub uncertain: usize,
    pub mean_ms: f64,
    pub spread_ms: f64,
}

pub struct Judge {
    pub start: f64,
    pub interval: f64,
    pub results: Vec<ResultNote>,
    pub summary: Summary,
    used: HashSet<usize>,
    next: usize,
    m2: f64,
    latest_index: Option<usize>,
    extras: BTreeMap<usize, usize>,
}

impl Judge {
    pub fn new(start: f64, interval: f64) -> Self {
        Self {
            start,
            interval,
            results: Vec::new(),
            summary: Summary::default(),
            used: HashSet::new(),
            next: 0,
            m2: 0.,
            latest_index: None,
            extras: BTreeMap::new(),
        }
    }
    pub fn window(&self) -> f64 {
        (self.interval * 0.45).min(180.)
    }
    /// Zero length means continuous practice, with no last target.
    pub fn last_target(&self, length: usize) -> Option<f64> {
        length
            .checked_sub(1)
            .map(|last| self.start + last as f64 * self.interval)
    }
    pub fn advance_session(&mut self, through_ms: f64, length: usize) -> bool {
        let end = self.last_target(length).map(|t| t + self.window() + 26.);
        self.advance(end.map_or(through_ms, |end| through_ms.min(end)));
        end.is_some_and(|end| through_ms > end)
    }
    fn track(&mut self, index: usize) -> usize {
        let latest = self.latest_index.map_or(index, |old| old.max(index));
        self.latest_index = Some(latest);
        let first = latest.saturating_sub(HISTORY_LIMIT - 1);
        self.results.retain(|r| r.index >= first);
        self.extras.retain(|&i, _| i >= first);
        first
    }
    pub fn recent_extras(&self) -> Vec<ExtraCount> {
        self.extras
            .iter()
            .map(|(&index, &count)| ExtraCount { index, count })
            .collect()
    }
    fn record(&mut self, note: ResultNote) {
        if note.index >= self.track(note.index) {
            // Early onsets may arrive before older misses are finalized.
            let at = self.results.partition_point(|r| r.index < note.index);
            self.results.insert(at, note);
        }
    }
    pub fn onset(&mut self, at: f64, reliable: bool) {
        let position = (at - self.start) / self.interval;
        if position < -0.5 {
            return;
        }
        let index = position.round().max(0.) as usize;
        let target = self.start + index as f64 * self.interval;
        let delta = at - target;
        if delta.abs() > self.window() || index < self.next || !self.used.insert(index) {
            self.summary.extra += 1;
            if index >= self.track(index) {
                *self.extras.entry(index).or_default() += 1;
            }
            return;
        }
        let kind = if !reliable {
            self.summary.uncertain += 1;
            "uncertain"
        } else {
            self.summary.played += 1;
            let diff = delta - self.summary.mean_ms;
            self.summary.mean_ms += diff / self.summary.played as f64;
            self.m2 += diff * (delta - self.summary.mean_ms);
            self.summary.spread_ms = (self.m2 / self.summary.played as f64).sqrt();
            if delta.abs() <= 30. {
                self.summary.on_time += 1;
                "good"
            } else if delta < 0. {
                "early"
            } else {
                "late"
            }
        };
        self.record(ResultNote {
            index,
            target_ms: target,
            delta_ms: reliable.then_some(delta),
            kind,
        });
    }
    // Called only with the processed input watermark, never a UI/wall timer.
    pub fn advance(&mut self, through_ms: f64) {
        while self.start + self.next as f64 * self.interval + self.window() + 25. < through_ms {
            if !self.used.remove(&self.next) {
                self.summary.missed += 1;
                self.record(ResultNote {
                    index: self.next,
                    target_ms: self.start + self.next as f64 * self.interval,
                    delta_ms: None,
                    kind: "miss",
                });
            }
            self.next += 1;
        }
    }
}

pub fn calibration(values: &[f64], missed: usize, extra: usize) -> Result<(f64, f64), String> {
    if values.len() < 12 || missed > 4 || extra > 2 {
        return Err("没有收到足够清晰、连续的回送节拍。检查连线和输入音量后重试。".into());
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let median = sorted[sorted.len() / 2];
    let jitter =
        (values.iter().map(|x| (x - median).powi(2)).sum::<f64>() / values.len() as f64).sqrt();
    if !(-150.0..=250.0).contains(&median) || jitter > 5. {
        return Err(
            "回送结果不够稳定，未应用校准。请关闭效果、监听回送和其他输入声音后重试。".into(),
        );
    }
    Ok((median, jitter))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn continuous_practice_keeps_running_and_history_stays_bounded() {
        let mut j = Judge::new(1000., 100.);
        assert_eq!(j.last_target(0), None);
        for i in 0..100_000 {
            let target = 1000. + i as f64 * 100.;
            j.onset(target + 10., true);
            j.onset(target + 20., true);
            assert!(!j.advance_session(target + 80., 0));
            assert!(j.results.len() <= HISTORY_LIMIT);
            assert!(j.extras.len() <= HISTORY_LIMIT);
            assert!(j.used.is_empty());
        }
        assert_eq!(j.summary.played, 100_000);
        assert_eq!(j.summary.extra, 100_000);
        assert_eq!(j.summary.missed, 0);
        assert_eq!(j.results.len(), HISTORY_LIMIT);
        assert_eq!(j.results[0].index, 100_000 - HISTORY_LIMIT);
        assert_eq!(
            j.recent_extras().iter().map(|n| n.count).sum::<usize>(),
            HISTORY_LIMIT
        );
    }
    #[test]
    fn finite_sessions_and_calibration_still_end_at_their_last_target() {
        for length in [16, 32, 64, 128] {
            let mut j = Judge::new(1000., 100.);
            let last = 1000. + (length - 1) as f64 * 100.;
            assert!(!j.advance_session(last + 50., length));
            assert!(j.advance_session(last + 5000., length));
            assert_eq!(j.summary.missed, length);
            assert_eq!(j.results.last().unwrap().index, length - 1);
        }
    }
    #[test]
    fn history_orders_early_hits_after_older_misses() {
        let mut j = Judge::new(1000., 250.);
        j.onset(1220., true);
        j.advance(1200.);
        assert_eq!(
            j.results.iter().map(|n| n.index).collect::<Vec<_>>(),
            vec![0, 1]
        );
        assert_eq!(j.results[0].kind, "miss");
        assert_eq!(j.results[1].kind, "good");
    }
    #[test]
    fn one_attack_never_scores_two_targets_and_early_notes_are_not_misses() {
        let mut j = Judge::new(1000., 250.);
        j.onset(960., true);
        j.onset(1005., true);
        j.onset(1260., true);
        j.advance(1700.);
        assert_eq!(
            (j.summary.played, j.summary.extra, j.summary.missed),
            (2, 1, 1)
        );
        assert_eq!(j.results[0].kind, "early");
        assert_eq!(j.results[1].kind, "good");
        assert_eq!(j.summary.mean_ms, -15.);
        assert_eq!(j.summary.spread_ms, 25.);
    }
    #[test]
    fn unreliable_input_has_no_precision_and_windows_do_not_overlap() {
        let mut j = Judge::new(1000., 100.);
        j.onset(1000., false);
        j.onset(1050., true);
        j.advance(1100.);
        assert_eq!(j.summary.uncertain, 1);
        assert_eq!(j.summary.played, 0);
        assert_eq!(j.summary.extra, 1);
        assert_eq!(j.summary.missed, 0);
        assert_eq!(j.results[0].delta_ms, None);
    }
    #[test]
    fn calibration_requires_consistency_not_a_players_average() {
        assert!(calibration(&[25.; 16], 0, 0).is_ok());
        assert!(calibration(&[25.; 4], 0, 0).is_err());
        assert!(calibration(&[25.; 16], 0, 4).is_err());
        assert!(calibration(
            &[0., 40., 0., 40., 0., 40., 0., 40., 0., 40., 0., 40.],
            0,
            0
        )
        .is_err());
    }
}
