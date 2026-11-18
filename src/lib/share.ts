import { addDays, formatDuration, secondsByDay, streaks, unitLabel, type Book, type Journal } from "./journal";

/** What one day's card says. Plain data, apart from the drawing, so it can be checked without a canvas. */
export interface ShareData {
  date: string;
  weekday: string;
  book: string;
  minutes: number;
  checkedIn: boolean;
  streak: number;
  days: number;
  totalMinutes: number;
  items: Array<{ title: string; time: string; speed: string; passed: boolean }>;
  /** The seven days ending today, oldest first. */
  week: Array<{ label: string; minutes: number; today: boolean }>;
}
export type Shape = "portrait" | "square";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const weekdayName = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00`).getDay()];

export function shareData(journal: Journal, book: Book, today: string): ShareData {
  const seconds = secondsByDay(journal);
  const minutesOf = (day: string) => Math.round((seconds.get(day) ?? 0) / 60);
  const exercises = new Map(book.weeks.flatMap(w => w.exercises).map(e => [e.id, e]));
  const items = journal.entries
    .filter(e => e.date === today && (e.seconds > 0 || e.speed !== null || e.passed))
    .sort((a, b) => b.seconds - a.seconds)
    .map(e => {
      const ex = e.book === book.id ? exercises.get(e.exercise) : undefined;
      return {
        title: ex?.title ?? (e.book === "_free" ? "自由练习" : e.exercise),
        time: e.seconds > 0 ? formatDuration(e.seconds) : "",
        speed: e.speed !== null ? `${e.speed} ${ex ? unitLabel(ex) : "BPM"}` : "",
        passed: e.passed,
      };
    });
  return {
    date: today, weekday: weekdayName(today), book: book.title,
    minutes: minutesOf(today), checkedIn: seconds.has(today),
    streak: streaks(seconds.keys(), today).current, days: seconds.size,
    totalMinutes: Math.round([...seconds.values()].reduce((a, b) => a + b, 0) / 60),
    items,
    week: Array.from({ length: 7 }, (_, i) => { const d = addDays(today, i - 6); return { label: weekdayName(d).slice(1), minutes: minutesOf(d), today: i === 6 }; }),
  };
}
