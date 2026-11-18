/**
 * Lines for the bottom of the share card. They are written for this app, in
 * the voice of practice-room jokes, and deliberately not attributed to anyone:
 * a wrongly credited "famous quote" on a picture that gets passed around is
 * worse than none. Keep each to two short lines on the card (about 40 characters).
 */
export const QUOTES = [
  "节拍器不会骗你，但它会伤害你。",
  "慢练是最快的捷径。",
  "今天的 60，是明天 120 的首付。",
  "不是手指不够快，是节拍器太诚实。",
  "先弹对，再弹快；先弹快，就只剩快了。",
  "计划：调音五分钟，练琴两小时。实际：反过来。",
  "效果器救不了没练的右手。",
  "失真开得再大，节拍器也听得出你弹错了。",
  "错音弹一遍是失误，弹两遍是风格。",
  "买琴不能让我变强，但我还是想买。",
  "吉他只有六根弦，我的问题不止六个。",
  "一万小时定律：还剩九千九百九十九。",
  "邻居已经会唱我的音阶了。",
  "手指上的茧，是今天的收据。",
  "Solo 可以即兴，节奏不能随缘。",
  "今天也是被 F 和弦教育的一天。",
  "拨片不会消失，只会转移到沙发缝里。",
  "天才是 1% 的灵感，加 99% 的爬格子。",
  "别问音色在哪。音色在手上，手在练琴的路上。",
  "谱子看十遍不如弹一遍，弹一遍不如慢弹十遍。",
  "摇滚不死，只是今天手有点酸。",
  "每天十分钟，胜过周末三小时。",
  "就再弹最后一遍。（第七次）",
  "调音器说我准了，耳朵说再想想。",
  "速度是练出来的，不是把节拍器调快调出来的。",
  "今天没有进步，但也没有退步——因为我练了。",
  "左手在努力，右手在摸鱼，节拍器在叹气。",
  "这把琴最大的问题，在琴和椅子之间。",
  "推弦推不准，是弦的问题。（不是）",
  "音箱开到 11 之前，先把这条练到 100。",
  "换弦一时爽，调音火葬场。",
  "我没有弹错，我只是提前进入了下一小节。",
] as const;

/** The same day always starts on the same line; `turn` steps on from it. */
export function quoteFor(date: string, turn = 0): string {
  let seed = 0;
  for (const ch of date) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return QUOTES[(seed + turn) % QUOTES.length];
}
