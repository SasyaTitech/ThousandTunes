/** The line the app is named after: a thousand tunes played before one knows sound. */
export const VERSE_LINES = ["操千曲而后晓声，", "观千剑而后识器。"] as const;
export const VERSE = VERSE_LINES.join("");
export const VERSE_SOURCE = "刘勰《文心雕龙·知音》";

const DIGITS = "〇一二三四五六七八九";
/** 1 to 99 the way a date says it: 十, 十一, 二十, 三十一. */
function count(n: number): string {
  const tens = Math.floor(n / 10), ones = n % 10;
  return `${tens > 1 ? DIGITS[tens] : ""}${tens > 0 ? "十" : ""}${ones > 0 || tens === 0 ? DIGITS[ones] : ""}`;
}
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
export const weekdayName = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00`).getDay()];
/** 2026-11-19 written out: 二〇二六年十一月十九日. */
export function cnDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${[...y].map(c => DIGITS[Number(c)]).join("")}年${count(Number(m))}月${count(Number(d))}日`;
}
