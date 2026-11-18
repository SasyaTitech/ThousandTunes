/** A line for the share card or the practice page, with where it is from when it is from somewhere. */
export interface Line { text: string; source: string }

/**
 * Lines from the classics about practice and staying with it. Each is quoted
 * as it stands in its source and credited to it; none is paraphrased. Add
 * only what can be checked against the text, and keep each to about 40
 * characters so it fits two lines of the share card.
 */
export const CLASSICS: readonly Line[] = [
  { text: "操千曲而后晓声，观千剑而后识器。", source: "刘勰《文心雕龙·知音》" },
  { text: "世之奇伟、瑰怪，非常之观，常在于险远，而人之所罕至焉，故非有志者不能至也。", source: "王安石《游褒禅山记》" },
  { text: "尽吾志也而不能至者，可以无悔矣。", source: "王安石《游褒禅山记》" },
  { text: "苟有恒，何必三更眠五更起；最无益，莫过一日曝十日寒。", source: "胡居仁 自勉联" },
  { text: "虽有天下易生之物也，一日暴之，十日寒之，未有能生者也。", source: "《孟子·告子上》" },
  { text: "掘井九轫而不及泉，犹为弃井也。", source: "《孟子·尽心上》" },
  { text: "无他，但手熟尔。", source: "欧阳修《卖油翁》" },
  { text: "不积跬步，无以至千里；不积小流，无以成江海。", source: "《荀子·劝学》" },
  { text: "锲而舍之，朽木不折；锲而不舍，金石可镂。", source: "《荀子·劝学》" },
  { text: "骐骥一跃，不能十步；驽马十驾，功在不舍。", source: "《荀子·劝学》" },
  { text: "吾尝终日而思矣，不如须臾之所学也。", source: "《荀子·劝学》" },
  { text: "道虽迩，不行不至；事虽小，不为不成。", source: "《荀子·修身》" },
  { text: "合抱之木，生于毫末；九层之台，起于累土；千里之行，始于足下。", source: "《老子》第六十四章" },
  { text: "天下难事，必作于易；天下大事，必作于细。", source: "《老子》第六十三章" },
  { text: "譬如为山，未成一篑，止，吾止也；譬如平地，虽覆一篑，进，吾往也。", source: "《论语·子罕》" },
  { text: "知之者不如好之者，好之者不如乐之者。", source: "《论语·雍也》" },
  { text: "学而时习之，不亦说乎？", source: "《论语·学而》" },
  { text: "日知其所亡，月无忘其所能，可谓好学也已矣。", source: "《论语·子张》" },
  { text: "工欲善其事，必先利其器。", source: "《论语·卫灵公》" },
  { text: "人一能之，己百之；人十能之，己千之。", source: "《礼记·中庸》" },
  { text: "苟日新，日日新，又日新。", source: "《礼记·大学》" },
  { text: "不徐不疾，得之于手而应于心。", source: "《庄子·天道》" },
  { text: "臣之所好者道也，进乎技矣。", source: "《庄子·养生主》" },
  { text: "适千里者，三月聚粮。", source: "《庄子·逍遥游》" },
  { text: "天行健，君子以自强不息。", source: "《周易·乾·象》" },
  { text: "为山九仞，功亏一篑。", source: "《尚书·旅獒》" },
  { text: "靡不有初，鲜克有终。", source: "《诗经·大雅·荡》" },
  { text: "行百里者半于九十。", source: "《战国策·秦策五》" },
  { text: "流水不腐，户枢不蝼，动也。", source: "《吕氏春秋·尽数》" },
  { text: "业精于勤，荒于嬉；行成于思，毁于随。", source: "韩愈《进学解》" },
  { text: "博观而约取，厚积而薄发。", source: "苏轼《稼说送张琥》" },
  { text: "古之立大事者，不惟有超世之才，亦必有坚忍不拔之志。", source: "苏轼《晁错论》" },
  { text: "若言琴上有琴声，放在匣中何不鸣？若言声在指头上，何不于君指上听？", source: "苏轼《琴诗》" },
  { text: "天下事有难易乎？为之，则难者亦易矣；不为，则易者亦难矣。", source: "彭端淑《为学一首示子侄》" },
  { text: "千淘万漉虽辛苦，吹尽狂沙始到金。", source: "刘禹锡《浪淘沙》" },
  { text: "十年磨一剑，霜刃未曾试。", source: "贾岛《剑客》" },
  { text: "纸上得来终觉浅，绝知此事要躬行。", source: "陆游《冬夜读书示子聿》" },
  { text: "问渠那得清如许？为有源头活水来。", source: "朱熹《观书有感》" },
  { text: "千磨万击还坚劲，任尔东西南北风。", source: "郑燮《竹石》" },
  { text: "欲穷千里目，更上一层楼。", source: "王之涣《登鹳雀楼》" },
  { text: "长风破浪会有时，直挂云帆济沧海。", source: "李白《行路难》" },
  { text: "路漫漫其修远兮，吾将上下而求索。", source: "屈原《离骚》" },
  { text: "转轴拨弦三两声，未成曲调先有情。", source: "白居易《琵琶行》" },
  { text: "别有幽愁暗恨生，此时无声胜有声。", source: "白居易《琵琶行》" },
  { text: "少壮不努力，老大徒伤悲。", source: "汉乐府《长歌行》" },
];

/**
 * Practice-room jokes, written for this app and deliberately credited to no
 * one: a wrongly attributed "famous quote" on a picture that gets passed
 * around is worse than none.
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

export type LineKind = "classic" | "joke";
const JOKES: readonly Line[] = QUOTES.map(text => ({ text, source: "" }));
export const linesOf = (kind: LineKind) => kind === "classic" ? CLASSICS : JOKES;

/** The same day always starts on the same line; `turn` steps on from it. */
export function lineFor(kind: LineKind, date: string, turn = 0): Line {
  let seed = 0;
  for (const ch of date) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const lines = linesOf(kind);
  return lines[(seed + turn) % lines.length];
}
/** Kept for callers that only want the joke's words. */
export const quoteFor = (date: string, turn = 0) => lineFor("joke", date, turn).text;
