import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Book, Journal } from "@/lib/journal";
import { shareData, type ShareData, type Shape } from "@/lib/share";
import { cnDate } from "@/lib/verse";

interface Palette { page: string; text: string; muted: string; accent: string; line: string; seal: string; sealInk: string }
function palette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    page: v("--page", "#0f0f0e"), text: v("--text-primary", "#ece7dc"), muted: v("--text-secondary", "#9a958a"),
    accent: v("--takt-from", "#b4493b"), line: v("--border-strong", "#ffffff42"),
    seal: v("--seal", "#c8372a"), sealInk: v("--seal-ink", "#fff3e6"),
  };
}

const W = 1080, PAD = 84;
/** The title runs down the right edge; everything above the list keeps clear of it. */
const COLUMN = 130;
const SONG = `"Source Han Serif SC", "Noto Serif CJK SC", "Noto Serif SC", STZhongsong, "Songti SC", SimSun, serif`;
const KAI = `STKaiti, KaiTi, "楷体", "Kaiti SC", serif`;
const NUM = `Bahnschrift, "DIN Alternate", "Segoe UI", sans-serif`;
const SANS = `"Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif`;

/** Where each band of the card sits, in card pixels. The square card is the portrait one with less air and no week. */
const LAYOUT = {
  portrait: { height: 1440, label: 262, number: 486, numberSize: 236, stats: 640, rule: 760, listHead: 836, row: 912, rowStep: 76, rows: 5, week: 1300, seal: [76, 108] },
  square: { height: 1080, label: 248, number: 442, numberSize: 200, stats: 574, rule: 660, listHead: 728, row: 800, rowStep: 62, rows: 3, week: 0, seal: [56, 80] },
} as const;

/** Draws the card in the colours the window is wearing. Everything is in card pixels, 1080 wide. */
export function drawShare(canvas: HTMLCanvasElement, data: ShareData, shape: Shape) {
  const L = LAYOUT[shape], H = L.height;
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext("2d")!;
  const p = palette();
  const text = (s: string, x: number, y: number, font: string, colour: string, align: CanvasTextAlign = "left") => {
    c.font = font; c.fillStyle = colour; c.textAlign = align; c.fillText(s, x, y);
    return c.measureText(s).width;
  };
  const fit = (s: string, font: string, width: number) => {
    c.font = font;
    if (c.measureText(s).width <= width) return s;
    let cut = s;
    while (cut.length > 1 && c.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
    return `${cut}…`;
  };
  /** Characters set one under another, each centred on x. */
  const down = (s: string, x: number, top: number, size: number, step: number, weight: number, family: string, colour: string) => {
    [...s].forEach((ch, i) => text(ch, x, top + i * step + size * .86, `${weight} ${size}px ${family}`, colour, "center"));
  };

  // Ground.
  c.textBaseline = "alphabetic";
  c.fillStyle = p.page; c.fillRect(0, 0, W, H);

  // Head: a heavy rule, the name in small capitals, the date written out.
  c.fillStyle = p.text; c.fillRect(PAD, 84, W - PAD * 2, 2);
  c.letterSpacing = "7px";
  text("THOUSAND TUNES", PAD, 132, `600 18px ${SANS}`, p.muted);
  c.letterSpacing = "5px";
  text(`${cnDate(data.date)} · ${data.weekday}`, PAD, 186, `400 30px ${SONG}`, p.text);
  c.letterSpacing = "0px";

  // The book runs down the right edge.
  const room = L.rule - 30 - 150, title = [...data.book.replace(/\s+/g, "")];
  const step = Math.min(88, room / title.length), size = Math.min(76, Math.floor(step * .9));
  down(title.join(""), W - PAD - 40, 150, size, step, 600, SONG, p.text);

  // The day's time, as large as the card allows.
  const left = W - PAD - COLUMN;
  text("今日练习", PAD, L.label, `400 32px ${SONG}`, p.muted);
  const h = Math.floor(data.minutes / 60), m = data.minutes % 60;
  let x = PAD - 6;
  const big = (n: string, unit: string) => {
    x += text(n, x, L.number, `300 condensed ${L.numberSize}px ${NUM}`, p.text) + 14;
    x += text(unit, x, L.number, `400 42px ${SONG}`, p.muted) + 30;
  };
  if (data.minutes === 0) text(data.checkedIn ? "已打卡" : "还没开始", PAD, L.number - 20, `600 ${Math.round(L.numberSize * .6)}px ${SONG}`, p.text);
  else { if (h) big(String(h), "小时"); if (m || !h) big(String(m), "分钟"); }

  // Three numbers that carry over from day to day.
  const hours = data.totalMinutes >= 60;
  const stats: Array<[string, string, string]> = [
    [String(data.streak), "天", "连续打卡"], [String(data.days), "天", "累计打卡"],
    [hours ? (data.totalMinutes / 60).toFixed(1) : String(data.totalMinutes), hours ? "小时" : "分钟", "累计练习"],
  ];
  stats.forEach(([n, unit, label], i) => {
    const sx = PAD + i * ((left - PAD) / 3);
    const w = text(n, sx, L.stats, `300 condensed 78px ${NUM}`, p.text);
    text(unit, sx + w + 10, L.stats, `400 26px ${SONG}`, p.muted);
    text(label, sx, L.stats + 46, `400 26px ${SONG}`, p.muted);
  });
  c.fillStyle = p.line; c.fillRect(PAD, L.rule, W - PAD * 2, 1);

  // What was practised and for how long, longest first.
  const more = data.items.length > L.rows, shown = data.items.slice(0, more ? L.rows - 1 : L.rows);
  text(data.items.length ? `今天练了 ${data.items.length} 项` : "今天还没有练习记录", PAD, L.listHead, `400 28px ${SONG}`, p.muted);
  shown.forEach((item, i) => {
    const y = L.row + i * L.rowStep;
    let right = W - PAD;
    if (item.passed) right -= text("达标", right, y, `400 26px ${SONG}`, p.muted, "right") + 24;
    if (item.speed) right -= text(item.speed, right, y, `400 condensed 34px ${NUM}`, p.text, "right") + 28;
    if (item.time) right -= text(item.time, right, y, `400 28px ${SONG}`, p.muted, "right") + 28;
    text(fit(item.title, `600 36px ${SONG}`, right - PAD), PAD, y, `600 36px ${SONG}`, p.text);
  });
  if (more) text(`还有 ${data.items.length - shown.length} 项`, PAD, L.row + shown.length * L.rowStep, `400 28px ${SONG}`, p.muted);

  // The week behind today as seven dots, inked by how long each day was; only where there is room.
  if (L.week) {
    const gap = (W - PAD * 2 - L.seal[0] - 40) / 7;
    data.week.forEach((d, i) => {
      const cx = PAD + (i + .5) * gap, level = d.minutes === 0 ? 0 : d.minutes < 15 ? .28 : d.minutes < 30 ? .5 : d.minutes < 60 ? .76 : 1;
      c.beginPath(); c.arc(cx, L.week, 15, 0, Math.PI * 2);
      if (level) { c.globalAlpha = level; c.fillStyle = p.text; c.fill(); c.globalAlpha = 1; } else { c.strokeStyle = p.line; c.lineWidth = 1.5; c.stroke(); }
      if (d.today) { c.beginPath(); c.arc(cx, L.week, 23, 0, Math.PI * 2); c.strokeStyle = p.accent; c.lineWidth = 2; c.stroke(); }
      text(d.label, cx, L.week + 54, `400 22px ${SONG}`, p.muted, "center");
    });
  }

  // Sealed in the corner.
  const [sw, sh] = L.seal;
  const sx = W - PAD - sw, sy = H - 70 - sh;
  c.fillStyle = p.seal; c.fillRect(sx, sy, sw, sh);
  c.strokeStyle = p.sealInk; c.lineWidth = 1.5; c.globalAlpha = .7; c.strokeRect(sx + 5, sy + 5, sw - 10, sh - 10); c.globalAlpha = 1;
  down("千曲", sx + sw / 2, sy + sh * .1, Math.round(sw * .58), sh * .4, 400, KAI, p.sealInk);
}

const pngOf = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("图片生成失败")), "image/png"));
/** A preview of today's card, with the two things one does with it: copy it, or keep it as a file. */
export default function ShareDialog({ journal, book, today, close }: { journal: Journal; book: Book; today: string; close: () => void }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [shape, setShape] = React.useState<Shape>("portrait");
  const [note, setNote] = React.useState("");
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const data = React.useMemo(() => shareData(journal, book, today), [journal, book, today]);
  React.useEffect(() => { if (canvas.current) drawShare(canvas.current, data, shape); }, [data, shape]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const run = async (fn: (png: Blob) => Promise<void>) => {
    setBusy(true); setError(""); setNote(""); setSaved(false);
    try { await fn(await pngOf(canvas.current!)); } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  };
  const copy = () => run(async png => {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    setNote("已复制，可以直接粘贴到聊天或朋友圈。");
  });
  const save = () => run(async png => {
    const path = await invoke<string>("save_share_image", { date: today, shape, data: Array.from(new Uint8Array(await png.arrayBuffer())) });
    setNote(`已保存到 ${path}`); setSaved(true);
  });

  return <div className="sh-back" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="sh" role="dialog" aria-modal="true" aria-label="分享今日练习">
      <canvas ref={canvas} className="sh-card" data-shape={shape} role="img" aria-label={`${data.date} 的练习分享图`} />
      <div className="sh-side">
        <h3>分享今日练习</h3>
        <p className="sh-hint">图片跟随当前配色，内容取自今天的记录。</p>
        <div className="sh-pick" role="radiogroup" aria-label="图片比例">
          <button type="button" role="radio" aria-checked={shape === "portrait"} onClick={() => setShape("portrait")}>竖版 3:4</button>
          <button type="button" role="radio" aria-checked={shape === "square"} onClick={() => setShape("square")}>方形 1:1</button>
        </div>
        <button type="button" className="primary" disabled={busy} onClick={() => void copy()}>复制图片</button>
        <button type="button" disabled={busy} onClick={() => void save()}>保存为图片文件</button>
        {note && <p className="sh-note" role="status">{note}</p>}
        {saved && <button type="button" onClick={() => void invoke("open_share_folder").catch(e => setError(String(e)))}>打开所在文件夹</button>}
        {error && <p className="td-error" role="alert">{error}</p>}
        <button type="button" className="sh-close" onClick={close}>关闭</button>
      </div>
    </div>
  </div>;
}
