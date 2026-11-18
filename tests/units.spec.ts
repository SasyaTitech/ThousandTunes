import { expect, test } from "@playwright/test";

import { TAP_RESET_MS, TapTempo } from "../src/lib/tap";
import { bpmToFill, fillToBpm, subdivisionLabel } from "../src/lib/utils";
import { addDays, dayOf, formatClock, formatDuration, formatMinutes, PracticeClock, progressOf, secondsByDay, streaks, targetOf, tempoText, weekdayOf, type Book, type Exercise } from "../src/lib/journal";
import { shareData } from "../src/lib/share";
import { CLASSICS, QUOTES, lineFor, quoteFor } from "../src/lib/quotes";
import { cnDate } from "../src/lib/verse";
import bookJson from "../src/books/shuaishuai-7w-1.json" with { type: "json" };

const book = bookJson as Book;

test("tap tempo averages the last four intervals", () => {
  const t = new TapTempo();
  expect(t.tap(0)).toBeNull();
  expect(t.tap(500)).toBe(120);
  expect(t.tap(1000)).toBe(120);
  // One late tap moves the reading, but by a share of its error, not all of it.
  expect(t.tap(1700)).toBe(106);
  expect(t.tap(2200)).toBe(109);
  // Four intervals on, the late one has left the window.
  t.tap(2700);
  t.tap(3200);
  t.tap(3700);
  expect(t.tap(4200)).toBe(120);
});

test("a pause of two seconds starts a new tempo", () => {
  const t = new TapTempo();
  t.tap(0);
  t.tap(1000);
  expect(t.tap(1000 + TAP_RESET_MS + 1)).toBeNull();
  expect(t.tap(1000 + TAP_RESET_MS + 1 + 250)).toBe(240);
});

test("the slider maps both ends of the tempo range", () => {
  expect(bpmToFill(30)).toBe(0);
  expect(bpmToFill(300)).toBe(100);
  expect(fillToBpm(0)).toBe(30);
  expect(fillToBpm(1)).toBe(300);
  expect(fillToBpm(-1)).toBe(30);
  expect(fillToBpm(2)).toBe(300);
  for (let bpm = 30; bpm <= 300; bpm++) expect(fillToBpm(bpmToFill(bpm) / 100)).toBe(bpm);
});

test("the grid is named as a note value against the beat unit", () => {
  expect(subdivisionLabel(1, 4)).toBe("1/4");
  expect(subdivisionLabel(2, 4)).toBe("1/8");
  expect(subdivisionLabel(3, 4)).toBe("1/8T");
  expect(subdivisionLabel(4, 4)).toBe("1/16");
  expect(subdivisionLabel(1, 8)).toBe("1/8");
  expect(subdivisionLabel(4, 8)).toBe("1/32");
});

test("practice streaks survive an unfinished today and month ends", () => {
  expect(streaks([], "2026-11-18")).toEqual({ current: 0, longest: 0 });
  expect(streaks(["2026-11-16", "2026-11-17"], "2026-11-18")).toEqual({ current: 2, longest: 2 });
  expect(streaks(["2026-11-15", "2026-11-16"], "2026-11-18")).toEqual({ current: 0, longest: 2 });
  expect(streaks(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-18"], "2026-11-18")).toEqual({ current: 1, longest: 3 });
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  expect(weekdayOf("2026-11-18")).toBe(2);
});

test("exercise progress follows the best speed towards the textbook target", () => {
  const climb: Exercise = { id: "a", title: "", tempo: { from: 50, to: 100 } };
  const fixed: Exercise = { id: "b", title: "", tempo: { from: 40, to: 40 } };
  const entry = (exercise: string, date: string, speed: number | null, passed = false, seconds = 600) => ({ book: "k", exercise, date, speed, seconds, passed, note: "" });
  const journal = { version: 2, active_book: "k", practising: [], checkins: ["2026-11-01"], entries: [entry("a", "2026-11-03", 75), entry("a", "2026-11-02", 60), entry("b", "2026-11-03", 40, true), entry("a", "2026-11-04", null), { ...entry("a", "2026-11-03", 75), book: "other" },
    entry("a", "2026-11-06", null, false, 45), entry("a", "2026-11-07", null, false, 40), entry("b", "2026-11-07", null, false, 30), entry("b", "2026-11-08", 50, false, 0)] };
  const a = progressOf(journal, "k", climb);
  expect(a.entries.map(e => e.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-06", "2026-11-07"]);
  expect([a.best, a.ratio, a.passed, a.seconds]).toEqual([75, 0.5, false, 1885]);
  expect(progressOf(journal, "k", fixed)).toMatchObject({ best: 50, ratio: null, passed: true });
  expect([targetOf(climb), targetOf(fixed)]).toEqual([100, null]);
  expect([tempoText(climb), tempoText(fixed), tempoText({ id: "c", title: "", tempo: { from: 40, to: null } }), tempoText({ id: "d", title: "", tempo: { from: 50, to: 100 }, unit: "percent" })])
    .toEqual(["50 → 100 BPM", "固定 40 BPM", "40 BPM → 原速", "50 → 100 %"]);
  // A day needs a check-in, a minute of playing in total, or a result: 45 seconds alone is not a day.
  expect([...secondsByDay(journal)]).toEqual([["2026-11-01", 0], ["2026-11-02", 600], ["2026-11-03", 1800], ["2026-11-04", 600], ["2026-11-07", 70], ["2026-11-08", 0]]);
  expect([formatMinutes(45), formatMinutes(120), formatMinutes(145)]).toEqual(["45 分钟", "2 小时", "2 小时 25 分"]);
  expect([formatDuration(0), formatDuration(40), formatDuration(95), formatClock(5), formatClock(200), formatClock(3725)]).toEqual(["0 分钟", "不到 1 分钟", "2 分钟", "0:05", "3:20", "1:02:05"]);
});

test("the practice clock counts only while the metronome runs", () => {
  const c = new PracticeClock();
  c.advance(0, false);
  c.advance(5_000, false);
  expect(c.pendingSeconds).toBe(0);
  c.advance(5_000, true);
  for (let t = 6_000; t <= 25_500; t += 500) c.advance(t, true);
  expect([c.pendingSeconds, c.sessionSeconds]).toEqual([20, 20]);
  expect(c.take()).toBe(20);
  // The half second left over is not lost.
  c.advance(26_000, true);
  expect(c.take()).toBe(1);
  // Stopping ends the count, and a sleeping computer is not practice.
  c.advance(27_000, false);
  c.advance(90_000, false);
  c.advance(90_000, true);
  c.advance(4_000_000, true);
  expect(c.pendingSeconds).toBe(6);
  const taken = c.take();
  c.restore(taken);
  expect(c.take()).toBe(taken);
  expect(c.sessionSeconds).toBe(27);
  c.startSession();
  expect(c.sessionSeconds).toBe(0);
});

test("the bundled textbook outline is complete and consistent", () => {
  const ids = book.weeks.flatMap(w => w.exercises.map(e => e.id));
  expect(book.weeks.map(w => w.exercises.length)).toEqual([9, 9, 9, 9, 10, 10, 10]);
  expect(new Set(ids).size).toBe(66);
  for (const e of book.weeks.flatMap(w => w.exercises)) {
    expect(e.title.length, e.id).toBeGreaterThan(0);
    expect(e.minutes, e.id).toBeGreaterThan(0);
    if (e.tempo && e.tempo.to !== null) expect(e.tempo.to, e.id).toBeGreaterThanOrEqual(e.tempo.from);
    if (!e.tempo) expect(e.goal, e.id).toBeTruthy();
  }
});

test("the share card says what was practised today, longest first", () => {
  const e = (bookId: string, exercise: string, date: string, seconds: number, speed: number | null, passed = false) => ({ book: bookId, exercise, date, seconds, speed, passed, note: "" });
  const journal = { version: 2, active_book: book.id, practising: [], checkins: [], entries: [
    e(book.id, "W1-EX6", "2026-11-18", 600, 70, true), e(book.id, "W1-EX5", "2026-11-18", 1800, 80), e("_free", "_free", "2026-11-18", 300, null),
    e(book.id, "W1-EX5", "2026-11-17", 1200, 75), e(book.id, "W1-EX7", "2026-11-18", 0, null),
  ] };
  const card = shareData(journal, book, "2026-11-18");
  expect([card.minutes, card.streak, card.days, card.totalMinutes, card.weekday, card.checkedIn]).toEqual([45, 2, 2, 65, "周三", true]);
  expect(card.items).toEqual([
    { title: "1&2指全指板爬格子", time: "30 分钟", speed: "80 BPM", passed: false },
    { title: "1&3指全指板爬格子", time: "10 分钟", speed: "70 BPM", passed: true },
    { title: "自由练习", time: "5 分钟", speed: "", passed: false },
  ]);
  expect(card.week.map(d => d.minutes)).toEqual([0, 0, 0, 0, 0, 20, 45]);
  expect(card.week.map(d => d.label).join("")).toBe("四五六日一二三");
  expect([card.book, card.byline]).toEqual(["帅帅 7 周计划 I", "零基础入门电吉他 · 帅帅 著"]);
  expect(shareData({ ...journal, entries: [] }, book, "2026-11-18")).toMatchObject({ minutes: 0, checkedIn: false, streak: 0, items: [] });
});

test("the card's closing line is fixed for a day, steps on when asked, and fits two lines", () => {
  expect(quoteFor("2026-11-18")).toBe(quoteFor("2026-11-18"));
  expect(QUOTES).toContain(quoteFor("2026-11-18"));
  const round = Array.from({ length: QUOTES.length }, (_, i) => quoteFor("2026-11-18", i));
  expect(new Set(round).size).toBe(QUOTES.length);
  expect(quoteFor("2026-11-18", QUOTES.length)).toBe(round[0]);
  expect(new Set(QUOTES).size).toBe(QUOTES.length);
  for (const q of QUOTES) expect(q.length, q).toBeLessThanOrEqual(40);
});

test("the classical lines each name a source, fit the card, and are dated the old way", () => {
  expect(new Set(CLASSICS.map(l => l.text)).size).toBe(CLASSICS.length);
  for (const l of CLASSICS) { expect(l.source, l.text).not.toBe(""); expect(l.text.length, l.text).toBeLessThanOrEqual(40); }
  expect(CLASSICS).toContainEqual({ text: "苟有恒，何必三更眠五更起；最无益，莫过一日曝十日寒。", source: "胡居仁 自勉联" });
  expect(lineFor("classic", "2026-11-18")).toEqual(lineFor("classic", "2026-11-18"));
  expect(lineFor("joke", "2026-11-18").source).toBe("");
  expect(["2026-11-19", "2026-01-01", "2030-10-20", "1999-12-31", "2026-02-10"].map(cnDate)).toEqual(["二〇二六年十一月十九日", "二〇二六年一月一日", "二〇三〇年十月二十日", "一九九九年十二月三十一日", "二〇二六年二月十日"]);
});
