//! The practice journal: which textbook is in use, which of its exercises are
//! being practised, how long each was played on which day and how far it got.
//! Kept in its own `journal.json` beside the settings so a damaged or reset
//! settings file never takes the practice history with it. The textbooks
//! themselves live in the interface; this side only stores and validates.

use crate::settings::{data_dir, strip_bom, write_atomic};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Roughly thirty years of ten exercises a day.
const MAX_ENTRIES: usize = 100_000;
const MAX_PRACTISING: usize = 500;
const MAX_NOTE_CHARS: usize = 300;
const DAY_SECONDS: u32 = 86_400;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Entry {
    pub book: String,
    pub exercise: String,
    /// Local calendar day, `YYYY-MM-DD`.
    pub date: String,
    /// Time played that day with the metronome running.
    #[serde(default)]
    pub seconds: u32,
    /// The best speed reached that day, in the exercise's own unit.
    #[serde(default)]
    pub speed: Option<u32>,
    /// The textbook's requirement was met on this day.
    #[serde(default)]
    pub passed: bool,
    #[serde(default)]
    pub note: String,
    /// Version 1 files counted whole minutes; read once, never written.
    #[serde(default, skip_serializing)]
    minutes: Option<u32>,
}

/// One exercise on the practice list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Item {
    pub book: String,
    pub exercise: String,
}

fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.chars().count() <= 64 && !s.chars().any(char::is_control)
}

fn valid_date(s: &str) -> bool {
    s.len() == 10 && chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

fn check_slot(book: &str, exercise: &str, date: &str) -> Result<(), String> {
    if !valid_id(book) || !valid_id(exercise) {
        return Err("记录缺少教材或练习编号。".into());
    }
    if !valid_date(date) {
        return Err("日期格式应为 YYYY-MM-DD。".into());
    }
    Ok(())
}

impl Entry {
    fn blank(book: &str, exercise: &str, date: &str) -> Self {
        Self {
            book: book.into(),
            exercise: exercise.into(),
            date: date.into(),
            ..Default::default()
        }
    }

    pub fn validate(&mut self) -> Result<(), String> {
        check_slot(&self.book, &self.exercise, &self.date)?;
        if let Some(minutes) = self.minutes.take() {
            if self.seconds == 0 {
                self.seconds = minutes.saturating_mul(60);
            }
        }
        if self.seconds > DAY_SECONDS {
            return Err("一天的练习时长不能超过 24 小时。".into());
        }
        if self.speed.is_some_and(|v| !(1..=400).contains(&v)) {
            return Err("速度应在 1 到 400 之间。".into());
        }
        self.note = self.note.trim().to_string();
        if self.note.chars().count() > MAX_NOTE_CHARS {
            return Err("备注最多 300 个字。".into());
        }
        Ok(())
    }

    fn same_slot(&self, book: &str, exercise: &str, date: &str) -> bool {
        self.book == book && self.exercise == exercise && self.date == date
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct Journal {
    pub version: u32,
    /// The textbook currently being followed; empty until one is chosen.
    pub active_book: String,
    /// The exercises chosen for practice; a book is rarely played whole.
    pub practising: Vec<Item>,
    /// One record per exercise per day.
    pub entries: Vec<Entry>,
    /// Days checked in by hand, without (or besides) exercise records.
    pub checkins: Vec<String>,
}

impl Journal {
    pub fn sanitise(&mut self) {
        self.version = 2;
        if !valid_id(&self.active_book) {
            self.active_book.clear();
        }
        let mut seen = std::collections::HashSet::new();
        self.entries.retain_mut(|e| {
            e.validate().is_ok()
                && seen.insert((e.book.clone(), e.exercise.clone(), e.date.clone()))
        });
        self.entries.truncate(MAX_ENTRIES);
        let mut listed = std::collections::HashSet::new();
        self.practising
            .retain(|i| valid_id(&i.book) && valid_id(&i.exercise) && listed.insert(i.clone()));
        self.practising.truncate(MAX_PRACTISING);
        self.checkins.retain(|d| valid_date(d));
        self.checkins.sort();
        self.checkins.dedup();
    }

    fn slot(&mut self, book: &str, exercise: &str, date: &str) -> Result<&mut Entry, String> {
        check_slot(book, exercise, date)?;
        let found = self
            .entries
            .iter()
            .position(|e| e.same_slot(book, exercise, date));
        let i = match found {
            Some(i) => i,
            None if self.entries.len() >= MAX_ENTRIES => return Err("练习记录已满。".into()),
            None => {
                self.entries.push(Entry::blank(book, exercise, date));
                self.entries.len() - 1
            }
        };
        Ok(&mut self.entries[i])
    }

    /// Insert, or replace the record already held for that exercise and day.
    pub fn save(&mut self, mut entry: Entry) -> Result<(), String> {
        entry.validate()?;
        let slot = self.slot(&entry.book, &entry.exercise, &entry.date)?;
        *slot = entry;
        Ok(())
    }

    /// Add played time to a day's record. The speed only ever climbs here: a
    /// slower run later in the day does not undo the day's best.
    pub fn add_time(
        &mut self,
        book: &str,
        exercise: &str,
        date: &str,
        seconds: u32,
        speed: Option<u32>,
    ) -> Result<(), String> {
        if speed.is_some_and(|v| !(1..=400).contains(&v)) {
            return Err("速度应在 1 到 400 之间。".into());
        }
        let entry = self.slot(book, exercise, date)?;
        entry.seconds = entry.seconds.saturating_add(seconds).min(DAY_SECONDS);
        entry.speed = entry.speed.max(speed);
        Ok(())
    }

    /// Correct a day's speed and note by hand, leaving its played time alone.
    pub fn set_result(
        &mut self,
        book: &str,
        exercise: &str,
        date: &str,
        speed: Option<u32>,
        note: &str,
    ) -> Result<(), String> {
        let mut probe = Entry {
            speed,
            note: note.to_string(),
            ..Entry::blank(book, exercise, date)
        };
        probe.validate()?;
        let entry = self.slot(book, exercise, date)?;
        entry.speed = probe.speed;
        entry.note = probe.note;
        Ok(())
    }

    pub fn remove(&mut self, book: &str, exercise: &str, date: &str) {
        self.entries.retain(|e| !e.same_slot(book, exercise, date));
    }

    /// Passing marks the day it happened and takes the exercise off the
    /// practice list; taking it back clears every day's mark.
    pub fn set_passed(
        &mut self,
        book: &str,
        exercise: &str,
        date: &str,
        passed: bool,
    ) -> Result<(), String> {
        if passed {
            self.slot(book, exercise, date)?.passed = true;
            self.practising
                .retain(|i| !(i.book == book && i.exercise == exercise));
        } else {
            for e in &mut self.entries {
                if e.book == book && e.exercise == exercise {
                    e.passed = false;
                }
            }
        }
        Ok(())
    }

    pub fn set_practising(
        &mut self,
        book: &str,
        exercises: &[String],
        on: bool,
    ) -> Result<(), String> {
        if !valid_id(book) || exercises.iter().any(|e| !valid_id(e)) {
            return Err("未知的练习。".into());
        }
        self.practising
            .retain(|i| !(i.book == book && exercises.contains(&i.exercise)));
        if on {
            if self.practising.len() + exercises.len() > MAX_PRACTISING {
                return Err("练习清单已满。".into());
            }
            self.practising.extend(exercises.iter().map(|e| Item {
                book: book.to_string(),
                exercise: e.clone(),
            }));
        }
        Ok(())
    }

    pub fn set_checkin(&mut self, date: &str, on: bool) -> Result<(), String> {
        if !valid_date(date) {
            return Err("日期格式应为 YYYY-MM-DD。".into());
        }
        self.checkins.retain(|d| d != date);
        if on {
            self.checkins.push(date.to_string());
            self.checkins.sort();
        }
        Ok(())
    }
}

pub struct JournalStore {
    inner: RwLock<Journal>,
    path: PathBuf,
}

impl JournalStore {
    pub fn load() -> Self {
        Self::at(data_dir().join("journal.json"))
    }

    fn at(path: PathBuf) -> Self {
        let mut journal = match std::fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<Journal>(strip_bom(&text)) {
                Ok(j) => j,
                Err(e) => {
                    // Never overwrite a history that merely failed to parse.
                    tracing::warn!("journal.json could not be read, keeping a copy: {e}");
                    let _ = std::fs::copy(&path, path.with_extension("unreadable.json"));
                    Journal::default()
                }
            },
            Err(_) => Journal::default(),
        };
        journal.sanitise();
        Self {
            inner: RwLock::new(journal),
            path,
        }
    }

    pub fn get(&self) -> Journal {
        self.inner.read().clone()
    }

    /// The change reaches memory only once it is safely on disk.
    pub fn try_update(
        &self,
        f: impl FnOnce(&mut Journal) -> Result<(), String>,
    ) -> Result<Journal, String> {
        let mut guard = self.inner.write();
        let mut next = guard.clone();
        f(&mut next)?;
        next.version = 2;
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
        write_atomic(&self.path, &json).map_err(|e| e.to_string())?;
        *guard = next.clone();
        Ok(next)
    }
}

type Store<'a> = tauri::State<'a, JournalStore>;

#[tauri::command]
pub fn get_journal(store: Store) -> Journal {
    store.get()
}

#[tauri::command]
pub fn save_journal_entry(store: Store, entry: Entry) -> Result<Journal, String> {
    store.try_update(|j| j.save(entry))
}

#[tauri::command]
pub fn add_journal_time(
    store: Store,
    book: String,
    exercise: String,
    date: String,
    seconds: u32,
    speed: Option<u32>,
) -> Result<Journal, String> {
    store.try_update(|j| j.add_time(&book, &exercise, &date, seconds, speed))
}

#[tauri::command]
pub fn set_journal_result(
    store: Store,
    book: String,
    exercise: String,
    date: String,
    speed: Option<u32>,
    note: String,
) -> Result<Journal, String> {
    store.try_update(|j| j.set_result(&book, &exercise, &date, speed, &note))
}

#[tauri::command]
pub fn delete_journal_entry(
    store: Store,
    book: String,
    exercise: String,
    date: String,
) -> Result<Journal, String> {
    store.try_update(|j| {
        j.remove(&book, &exercise, &date);
        Ok(())
    })
}

#[tauri::command]
pub fn set_journal_passed(
    store: Store,
    book: String,
    exercise: String,
    date: String,
    passed: bool,
) -> Result<Journal, String> {
    store.try_update(|j| j.set_passed(&book, &exercise, &date, passed))
}

#[tauri::command]
pub fn set_journal_practising(
    store: Store,
    book: String,
    exercises: Vec<String>,
    on: bool,
) -> Result<Journal, String> {
    store.try_update(|j| j.set_practising(&book, &exercises, on))
}

#[tauri::command]
pub fn set_journal_checkin(store: Store, date: String, on: bool) -> Result<Journal, String> {
    store.try_update(|j| j.set_checkin(&date, on))
}

#[tauri::command]
pub fn set_journal_book(store: Store, book: String) -> Result<Journal, String> {
    if !valid_id(&book) {
        return Err("未知的教材。".into());
    }
    store.try_update(|j| {
        j.active_book = book;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(exercise: &str, date: &str, speed: u32) -> Entry {
        Entry {
            seconds: 600,
            speed: Some(speed),
            note: "  手腕放松  ".into(),
            ..Entry::blank("book", exercise, date)
        }
    }

    #[test]
    fn one_record_per_exercise_per_day_is_kept_and_replaced() {
        let mut j = Journal::default();
        j.save(entry("W1-EX5", "2026-11-18", 60)).unwrap();
        j.save(entry("W1-EX5", "2026-11-18", 70)).unwrap();
        j.save(entry("W1-EX5", "2026-11-19", 80)).unwrap();
        j.save(entry("W1-EX6", "2026-11-18", 50)).unwrap();
        assert_eq!(j.entries.len(), 3);
        assert_eq!(j.entries[0].speed, Some(70));
        assert_eq!(j.entries[0].note, "手腕放松");
        j.remove("book", "W1-EX5", "2026-11-18");
        assert_eq!(j.entries.len(), 2);
    }

    #[test]
    fn played_time_accumulates_and_the_days_best_speed_only_climbs() {
        let mut j = Journal::default();
        j.add_time("book", "a", "2026-11-18", 10, None).unwrap();
        j.add_time("book", "a", "2026-11-18", 15, Some(80)).unwrap();
        j.add_time("book", "a", "2026-11-18", 5, Some(60)).unwrap();
        j.add_time("book", "a", "2026-11-19", 7, None).unwrap();
        assert_eq!(j.entries.len(), 2);
        assert_eq!((j.entries[0].seconds, j.entries[0].speed), (30, Some(80)));
        j.add_time("book", "a", "2026-11-18", u32::MAX, None)
            .unwrap();
        assert_eq!(j.entries[0].seconds, DAY_SECONDS);
        assert!(j.add_time("book", "a", "2026-11-18", 1, Some(0)).is_err());
        assert!(j.add_time("book", "", "2026-11-18", 1, None).is_err());
        assert!(j.add_time("book", "a", "today", 1, None).is_err());
    }

    #[test]
    fn a_hand_correction_changes_speed_and_note_but_not_the_played_time() {
        let mut j = Journal::default();
        j.add_time("book", "a", "2026-11-18", 90, Some(120))
            .unwrap();
        j.set_result("book", "a", "2026-11-18", Some(80), " 记多了 ")
            .unwrap();
        assert_eq!(
            (
                j.entries[0].seconds,
                j.entries[0].speed,
                &*j.entries[0].note
            ),
            (90, Some(80), "记多了")
        );
        j.set_result("book", "a", "2026-11-18", None, "").unwrap();
        assert_eq!(j.entries[0].speed, None);
        assert!(j
            .set_result("book", "a", "2026-11-18", Some(999), "")
            .is_err());
    }

    #[test]
    fn the_practice_list_is_chosen_by_hand_and_passing_leaves_it() {
        let mut j = Journal::default();
        let week: Vec<String> = ["a", "b", "c"].map(String::from).to_vec();
        j.set_practising("book", &week, true).unwrap();
        j.set_practising("book", &week[..1], true).unwrap();
        assert_eq!(j.practising.len(), 3);
        j.set_practising("book", &week[2..], false).unwrap();
        assert_eq!(j.practising.len(), 2);

        j.set_passed("book", "b", "2026-11-18", true).unwrap();
        assert_eq!(j.practising.len(), 1);
        assert!(j.entries[0].passed && j.entries[0].date == "2026-11-18");
        j.add_time("book", "b", "2026-11-17", 60, None).unwrap();
        j.entries[1].passed = true;
        j.set_passed("book", "b", "2026-11-18", false).unwrap();
        assert!(j.entries.iter().all(|e| !e.passed));
        assert_eq!(j.entries.len(), 2);
    }

    #[test]
    fn impossible_records_are_rejected() {
        let mut j = Journal::default();
        assert!(j.save(entry("W1-EX5", "2026-02-30", 60)).is_err());
        assert!(j.save(entry("W1-EX5", "18/11/2026", 60)).is_err());
        assert!(j.save(entry("W1-EX5", "2026-11-18", 0)).is_err());
        assert!(j.save(entry("", "2026-11-18", 60)).is_err());
        let mut long = entry("W1-EX5", "2026-11-18", 60);
        long.note = "长".repeat(301);
        assert!(j.save(long).is_err());
        let mut day = entry("W1-EX5", "2026-11-18", 60);
        day.seconds = DAY_SECONDS + 1;
        assert!(j.save(day).is_err());
        assert!(j.save(Entry::blank("book", "W5-EX9", "2026-11-18")).is_ok());
        assert_eq!(j.entries.len(), 1);
    }

    #[test]
    fn checkins_toggle_and_stay_unique() {
        let mut j = Journal::default();
        j.set_checkin("2026-11-18", true).unwrap();
        j.set_checkin("2026-11-17", true).unwrap();
        j.set_checkin("2026-11-18", true).unwrap();
        assert_eq!(j.checkins, ["2026-11-17", "2026-11-18"]);
        j.set_checkin("2026-11-17", false).unwrap();
        assert_eq!(j.checkins, ["2026-11-18"]);
        assert!(j.set_checkin("yesterday", true).is_err());
    }

    #[test]
    fn a_hand_edited_or_older_file_is_tidied_and_an_unreadable_one_is_kept() {
        let dir = std::env::temp_dir().join(format!("taktdock-journal-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("journal.json");
        std::fs::write(
            &path,
            "\u{feff}{\"version\":1,\"active_book\":\"book\",\"checkins\":[\"2026-11-18\",\"2026-11-18\",\"x\"],\
             \"practising\":[{\"book\":\"book\",\"exercise\":\"a\"},{\"book\":\"book\",\"exercise\":\"a\"}],\"entries\":[\
             {\"book\":\"book\",\"exercise\":\"a\",\"date\":\"2026-11-18\",\"speed\":90,\"minutes\":10},\
             {\"book\":\"book\",\"exercise\":\"a\",\"date\":\"2026-11-18\",\"speed\":95},\
             {\"book\":\"book\",\"exercise\":\"a\",\"date\":\"2026-11-19\",\"speed\":9000}]}",
        )
        .unwrap();
        let store = JournalStore::at(path.clone());
        let j = store.get();
        assert_eq!(j.entries.len(), 1);
        // Version 1 minutes become seconds.
        assert_eq!((j.entries[0].speed, j.entries[0].seconds), (Some(90), 600));
        assert_eq!(j.checkins, ["2026-11-18"]);
        assert_eq!(j.practising.len(), 1);

        let saved = store
            .try_update(|j| j.save(entry("b", "2026-11-20", 100)))
            .unwrap();
        assert_eq!(saved.version, 2);
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("minutes"));
        let reloaded = JournalStore::at(path.clone()).get();
        assert_eq!(reloaded, saved);
        assert!(!path.with_extension("tmp").exists());

        std::fs::write(&path, "{ not json").unwrap();
        assert!(JournalStore::at(path.clone()).get().entries.is_empty());
        assert!(path.with_extension("unreadable.json").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
