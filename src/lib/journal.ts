// The practice journal's shapes and the arithmetic over them. Pure functions
// only: the interface and the tests share this file.

export interface Exercise {
  id: string;
  title: string;
  /** Printed page in the book. */
  page?: number;
  /** Minutes a day the book asks for. */
  minutes?: number;
  /** Start and target speed. `to: null` means "up to the original tempo". */
  tempo?: { from: number; to: number | null };
  /** "percent" when the book counts in share of the original tempo. */
  unit?: "bpm" | "percent";
  /** A short extra requirement, in the app's own words. */
  goal?: string;
}
export interface Book {
  id: string;
  title: string;
  author?: string;
  weeks: Array<{ title: string; exercises: Exercise[] }>;
}
export interface Entry {
  book: string;
  exercise: string;
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  /** Time played that day with the metronome running. */
  seconds: number;
  speed: number | null;
  passed: boolean;
  note: string;
}
export interface Item { book: string; exercise: string }
export interface Journal {
  version: number;
  active_book: string;
  /** The exercises chosen for practice: a book is rarely played whole. */
  practising: Item[];
  entries: Entry[];
  checkins: string[];
}
export const EMPTY_JOURNAL: Journal = { version: 2, active_book: "", practising: [], entries: [], checkins: [] };
/** Metronome time with no exercise selected is kept under this pair. */
export const FREE: Item = { book: "_free", exercise: "_free" };
export const sameItem = (a: Item | null, b: Item | null) => a?.book === b?.book && a?.exercise === b?.exercise;

const pad = (n: number) => String(n).padStart(2, "0");
/** The local calendar day, never the UTC one: practice after midnight UTC still counts for today. */
export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return dayOf(new Date(y, m - 1, d + n));
}
/** 0 for Monday … 6 for Sunday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

export const unitLabel = (e: Exercise) => e.unit === "percent" ? "%" : "BPM";
/** A real, reachable target: fixed-tempo exercises have nothing to climb to. */
export function targetOf(e: Exercise): number | null {
  return e.tempo && e.tempo.to !== null && e.tempo.to > e.tempo.from ? e.tempo.to : null;
}
export function tempoText(e: Exercise): string {
  if (!e.tempo) return e.goal ?? "按教材要求";
  const u = unitLabel(e);
  if (e.tempo.to === null) return `${e.tempo.from} ${u} → 原速`;
  return e.tempo.to === e.tempo.from ? `固定 ${e.tempo.from} ${u}` : `${e.tempo.from} → ${e.tempo.to} ${u}`;
}

/**
 * Seconds practised per day, across every book. A day counts once it holds a
 * hand check-in, a minute of playing, or a record with a result in it: a few
 * seconds of metronome while tuning is not a day's practice.
 */
export function secondsByDay(j: Journal): Map<string, number> {
  const totals = new Map<string, number>(), counted = new Set(j.checkins);
  for (const e of j.entries) {
    totals.set(e.date, (totals.get(e.date) ?? 0) + e.seconds);
    if (e.speed !== null || e.passed) counted.add(e.date);
  }
  for (const [day, seconds] of totals) if (seconds >= 60) counted.add(day);
  return new Map([...counted].sort().map(day => [day, totals.get(day) ?? 0]));
}

/** The current run may end yesterday: today is not lost until it is over. */
export function streaks(days: Iterable<string>, today: string): { current: number; longest: number } {
  const set = new Set(days);
  let longest = 0;
  for (const d of set) {
    if (set.has(addDays(d, -1))) continue;
    let run = 1;
    while (set.has(addDays(d, run))) run++;
    longest = Math.max(longest, run);
  }
  let current = 0;
  let cursor = set.has(today) ? today : addDays(today, -1);
  while (set.has(cursor)) { current++; cursor = addDays(cursor, -1); }
  return { current, longest };
}

export interface ExerciseProgress {
  /** Oldest first. */
  entries: Entry[];
  best: number | null;
  last: Entry | null;
  passed: boolean;
  seconds: number;
  /** 0…1 along the way from the start speed to the target; null without a target. */
  ratio: number | null;
}
export function progressOf(j: Journal, book: string, e: Exercise): ExerciseProgress {
  const entries = j.entries.filter(x => x.book === book && x.exercise === e.id).sort((a, b) => a.date.localeCompare(b.date));
  const speeds = entries.flatMap(x => x.speed === null ? [] : [x.speed]);
  const best = speeds.length ? Math.max(...speeds) : null;
  const passed = entries.some(x => x.passed);
  const target = targetOf(e);
  const ratio = target === null || !e.tempo ? null
    : passed ? 1 : best === null ? 0 : Math.max(0, Math.min(1, (best - e.tempo.from) / (target - e.tempo.from)));
  return { entries, best, last: entries.at(-1) ?? null, passed, seconds: entries.reduce((n, x) => n + x.seconds, 0), ratio };
}

export function bookTotals(j: Journal, book: Book) {
  const weeks = book.weeks.map(w => {
    const progress = w.exercises.map(e => progressOf(j, book.id, e));
    return { title: w.title, total: w.exercises.length, passed: progress.filter(p => p.passed).length, started: progress.filter(p => p.entries.length > 0).length };
  });
  return { weeks, total: weeks.reduce((n, w) => n + w.total, 0), passed: weeks.reduce((n, w) => n + w.passed, 0), started: weeks.reduce((n, w) => n + w.started, 0) };
}

export function formatMinutes(total: number): string {
  if (total < 60) return `${total} 分钟`;
  const h = Math.floor(total / 60), m = total % 60;
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}
export const formatDuration = (seconds: number) => seconds > 0 && seconds < 60 ? "不到 1 分钟" : formatMinutes(Math.round(seconds / 60));
/** A running clock: 3:07, or 1:03:07 past the hour. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** A longer gap between ticks means the computer slept, not that anyone played. */
const MAX_STEP_MS = 5_000;

/**
 * Turns "the metronome is running" into practice time. Fed the current time
 * and whether the metronome runs, on every tick and change; hands back whole
 * seconds whenever asked. The speed reached is the player's to judge, so it
 * is entered by hand and never read off the metronome.
 */
export class PracticeClock {
  private last: number | null = null;
  private running = false;
  private pendingMs = 0;
  private sessionMs = 0;

  advance(now: number, running: boolean) {
    if (this.running && this.last !== null) {
      const step = Math.min(MAX_STEP_MS, Math.max(0, now - this.last));
      this.pendingMs += step;
      this.sessionMs += step;
    }
    this.running = running;
    this.last = now;
  }
  get pendingSeconds() { return Math.floor(this.pendingMs / 1000); }
  get sessionSeconds() { return Math.floor(this.sessionMs / 1000); }
  /** Whole seconds not yet handed over. */
  take(): number {
    const seconds = this.pendingSeconds;
    this.pendingMs -= seconds * 1000;
    return seconds;
  }
  /** Put back what could not be saved. */
  restore(seconds: number) { this.pendingMs += seconds * 1000; }
  /** A new exercise starts its own session. */
  startSession() { this.sessionMs = 0; }
}
