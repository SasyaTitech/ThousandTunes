import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Book, Journal } from "@/lib/journal";
import { quoteFor } from "@/lib/quotes";
import { shareData, type ShareData, type Shape } from "@/lib/share";

interface Palette { page: string; panel: string; text: string; muted: string; accent: string; bright: string; ok: string; line: string }
function palette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    page: v("--page", "#121110"), panel: v("--panel", "#1a1917"), text: v("--text-primary", "#f4efe6"), muted: v("--text-secondary", "#aaa397"),
    accent: v("--takt-from", "#f2a33a"), bright: v("--takt-to", "#ffc670"), ok: v("--ok", "#5fd3a8"), line: v("--border-strong", "#ffffff30"),
  };
}

const W = 1080, PAD = 84;
const SANS = `"Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif`;
const NUM = `Bahnschrift, "DIN Alternate", "Segoe UI", sans-serif`;
/** A brush-written face for the book's name and the closing line: the two parts meant to feel like a certificate. */
const KAI = `STKaiti, KaiTi, "楷体", "Kaiti SC", serif`;

/** Where each band of the card sits, in card pixels. The square card is the portrait one with less air and no week. */
const LAYOUT = {
  portrait: { height: 1440, title: 250, titleSize: 76, byline: 302, label: 392, number: 580, numberSize: 200, stats: 700, rule: 790, listHead: 852, row: 926, rowStep: 80, rows: 5, week: 1296, quote: 1372 },
  square: { height: 1080, title: 232, titleSize: 64, byline: 276, label: 344, number: 494, numberSize: 160, stats: 590, rule: 664, listHead: 716, row: 780, rowStep: 70, rows: 3, week: 0, quote: 1006 },
} as const;

/** Draws the card in the colours the window is wearing. Everything is in card pixels, 1080 wide. */
export function drawShare(canvas: HTMLCanvasElement, data: ShareData, shape: Shape, quote: string) {
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

  // Ground, a soft light from the top corner, and a frame.
  c.fillStyle = p.page; c.fillRect(0, 0, W, H);
  const glow = c.createRadialGradient(0, 0, 0, 0, 0, 900);
  glow.addColorStop(0, p.accent); glow.addColorStop(1, "transparent");
  c.globalAlpha = .2; c.fillStyle = glow; c.fillRect(0, 0, W, H); c.globalAlpha = 1;
  c.fillStyle = p.panel; c.globalAlpha = .55; c.beginPath(); c.roundRect(36, 36, W - 72, H - 72, 40); c.fill(); c.globalAlpha = 1;
  c.strokeStyle = p.line; c.lineWidth = 2; c.beginPath(); c.roundRect(36, 36, W - 72, H - 72, 40); c.stroke();

  c.textBaseline = "alphabetic";
  c.letterSpacing = "7px";
  text("TAKTDOCK", PAD, 132, `700 28px ${SANS}`, p.muted);
  c.letterSpacing = "0px";
  text(`${data.date.replaceAll("-", ".")}  ${data.weekday}`, W - PAD, 132, `400 28px ${NUM}`, p.muted, "right");

  // The book, named the way a certificate would name it.
  const titleFont = `400 ${L.titleSize}px ${KAI}`;
  text(fit(data.book, titleFont, W - PAD * 2), PAD, L.title, titleFont, p.bright);
  if (data.byline) text(fit(data.byline, `400 28px ${KAI}`, W - PAD * 2), PAD + 4, L.byline, `400 28px ${KAI}`, p.muted);

  // The day's time, as large as the card allows.
  text("今日练习", PAD, L.label, `400 32px ${SANS}`, p.muted);
  const h = Math.floor(data.minutes / 60), m = data.minutes % 60;
  let x = PAD;
  const big = (n: string, unit: string) => {
    x += text(n, x, L.number, `600 ${L.numberSize}px ${NUM}`, p.text) + 14;
    x += text(unit, x, L.number, `400 42px ${SANS}`, p.muted) + 30;
  };
  if (data.minutes === 0) text(data.checkedIn ? "已打卡" : "还没开始", PAD, L.number - 16, `600 ${Math.round(L.numberSize * .68)}px ${SANS}`, p.text);
  else { if (h) big(String(h), "小时"); if (m || !h) big(String(m), "分钟"); }

  // Three numbers that carry over from day to day.
  const hours = data.totalMinutes >= 60;
  const stats: Array<[string, string, string]> = [
    [String(data.streak), "天", "连续打卡"], [String(data.days), "天", "累计打卡"],
    [hours ? (data.totalMinutes / 60).toFixed(1) : String(data.totalMinutes), hours ? "小时" : "分钟", "累计练习"],
  ];
  stats.forEach(([n, unit, label], i) => {
    const sx = PAD + i * ((W - PAD * 2) / 3);
    const w = text(n, sx, L.stats, `600 68px ${NUM}`, i === 0 ? p.bright : p.text);
    text(unit, sx + w + 10, L.stats, `400 28px ${SANS}`, p.muted);
    text(label, sx, L.stats + 44, `400 26px ${SANS}`, p.muted);
  });
  c.fillStyle = p.line; c.fillRect(PAD, L.rule, W - PAD * 2, 2);

  // What was practised and for how long, longest first.
  const more = data.items.length > L.rows, shown = data.items.slice(0, more ? L.rows - 1 : L.rows);
  text(data.items.length ? `今天练了 ${data.items.length} 项` : "今天还没有练习记录", PAD, L.listHead, `400 28px ${SANS}`, p.muted);
  shown.forEach((item, i) => {
    const y = L.row + i * L.rowStep;
    let right = W - PAD;
    if (item.passed) right -= text("✓ 达标", right, y, `600 28px ${SANS}`, p.ok, "right") + 24;
    if (item.speed) right -= text(item.speed, right, y, `600 32px ${NUM}`, p.bright, "right") + 28;
    if (item.time) right -= text(item.time, right, y, `400 28px ${SANS}`, p.muted, "right") + 28;
    text(fit(item.title, `500 36px ${SANS}`, right - PAD), PAD, y, `500 36px ${SANS}`, p.text);
  });
  if (more) text(`还有 ${data.items.length - shown.length} 项`, PAD, L.row + shown.length * L.rowStep, `400 28px ${SANS}`, p.muted);

  // The week behind today, only where there is room for it.
  if (L.week) {
    const peak = Math.max(30, ...data.week.map(d => d.minutes)), tall = 64, step = (W - PAD * 2) / 7, wide = 76;
    data.week.forEach((d, i) => {
      const bx = PAD + i * step + (step - wide) / 2, bh = d.minutes ? Math.max(8, d.minutes / peak * tall) : 4;
      c.fillStyle = d.minutes ? p.accent : p.line; c.globalAlpha = d.today || !d.minutes ? 1 : .5;
      c.beginPath(); c.roundRect(bx, L.week - 34 - bh, wide, bh, 8); c.fill(); c.globalAlpha = 1;
      text(d.label, bx + wide / 2, L.week, `400 24px ${SANS}`, d.today ? p.bright : p.muted, "center");
    });
  }

  // A closing line, broken in two when it is long.
  const quoteFont = `400 34px ${KAI}`, wide = W - PAD * 2 - 40;
  c.font = quoteFont;
  const lines = [`“${quote}”`];
  if (c.measureText(lines[0]).width > wide) {
    const whole = lines[0];
    // Break after punctuation nearest the middle, else in the middle.
    let at = Math.ceil(whole.length / 2), best = Infinity;
    for (let i = 2; i < whole.length - 2; i++) if ("，。；：！？—）".includes(whole[i - 1]) && Math.abs(i - whole.length / 2) < best) { best = Math.abs(i - whole.length / 2); at = i; }
    lines.splice(0, 1, whole.slice(0, at), whole.slice(at));
  }
  lines.forEach((line, i) => text(fit(line, quoteFont, wide), W / 2, L.quote - (lines.length - 1 - i) * 46, quoteFont, p.muted, "center"));
}

const pngOf = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("图片生成失败")), "image/png"));

/** A preview of today's card, with the two things one does with it: copy it, or keep it as a file. */
export default function ShareDialog({ journal, book, today, close }: { journal: Journal; book: Book; today: string; close: () => void }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [shape, setShape] = React.useState<Shape>("portrait");
  const [turn, setTurn] = React.useState(0);
  const quote = quoteFor(today, turn);
  const [note, setNote] = React.useState("");
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const data = React.useMemo(() => shareData(journal, book, today), [journal, book, today]);
  React.useEffect(() => { if (canvas.current) drawShare(canvas.current, data, shape, quote); }, [data, shape, quote]);
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
        <p className="sh-hint">图片跟随当前配色，内容取自今天的记录。想换颜色，先在右上角换配色。</p>
        <p className="sh-quote" aria-label="卡片上的话">{quote}</p>
        <div className="sh-shapes" role="radiogroup" aria-label="图片比例">
          <button type="button" role="radio" aria-checked={shape === "portrait"} onClick={() => setShape("portrait")}>竖版 3:4</button>
          <button type="button" role="radio" aria-checked={shape === "square"} onClick={() => setShape("square")}>方形 1:1</button>
        </div>
        <button type="button" title={quote} onClick={() => setTurn(n => n + 1)}>换一句话</button>
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
