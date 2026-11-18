import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Focus from "@/Focus";
import Library from "@/Library";
import Presets, { SUBDIVISIONS } from "@/Presets";
import RhythmCoach from "@/RhythmCoach";
import Stats from "@/Stats";
import { BOOKS } from "@/books";
import { dayOf, EMPTY_JOURNAL, FREE, PracticeClock, secondsByDay, streaks, type Item, type Journal } from "@/lib/journal";
import { TapTempo } from "@/lib/tap";
import type { BeatEvent, Transport } from "@/lib/types";

type Controls = Partial<Pick<Transport, "bpm" | "subdivision" | "accent_first" | "sound" | "volume">> & {
  meter?: number[];
  output_device?: string;
};
const METERS = ["1/4", "2/4", "3/4", "4/4", "5/4", "6/8", "7/8"];
const PAGES = [["practice", "练习"], ["library", "教材库"], ["stats", "统计"], ["coach", "跟拍练习"], ["metronome", "节拍器与预设"]] as const;
type Page = typeof PAGES[number][0];
/** Played time is written this often, so closing the window loses little. */
const FLUSH_SECONDS = 10;

function storedItem(): Item | null {
  try { const v = JSON.parse(localStorage.getItem("td-current") ?? "null"); return v && typeof v.book === "string" && typeof v.exercise === "string" ? v : null; } catch { return null; }
}

export default function MainWindow() {
  const [page, setPage] = React.useState<Page>("practice");
  const [transport, setTransport] = React.useState<Transport | null>(null);
  const [journal, setJournal] = React.useState<Journal | null>(null);
  const [current, setCurrent] = React.useState<Item | null>(storedItem);
  const [today, setToday] = React.useState(() => dayOf(new Date()));
  const [devices, setDevices] = React.useState<string[]>([]);
  const [tempo, setTempo] = React.useState("120");
  const [volume, setVolume] = React.useState(75);
  const [beat, setBeat] = React.useState<BeatEvent | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [, setTick] = React.useState(0);
  const tapper = React.useRef(new TapTempo());
  const inFlight = React.useRef(false);
  const running = React.useRef(false);

  // Practice time: the metronome running is the clock, the selected exercise is where it goes.
  const clock = React.useRef(new PracticeClock());
  const transportRef = React.useRef<Transport | null>(null);
  const currentRef = React.useRef(current);
  currentRef.current = current;
  const writes = React.useRef<Promise<void>>(Promise.resolve());
  const tickClock = () => { const t = transportRef.current; clock.current.advance(performance.now(), !!t?.running, t?.bpm ?? 0); };
  const flush = React.useCallback((item: Item | null = currentRef.current) => {
    writes.current = writes.current.then(async () => {
      tickClock();
      const taken = clock.current.take();
      if (taken.seconds === 0) return clock.current.restore(taken);
      const target = item ?? FREE;
      const exercise = BOOKS.find(b => b.id === target.book)?.weeks.flatMap(w => w.exercises).find(e => e.id === target.exercise);
      // Only a BPM exercise takes its result from the metronome.
      const speed = exercise?.tempo && exercise.unit !== "percent" ? taken.speed : null;
      try { setJournal(await invoke<Journal>("add_journal_time", { ...target, date: dayOf(new Date()), seconds: taken.seconds, speed })); }
      catch (e) { clock.current.restore(taken); setError(String(e)); }
    });
    return writes.current;
  }, []);
  function select(item: Item | null) {
    void flush(currentRef.current).then(() => { clock.current.startSession(performance.now()); setTick(n => n + 1); });
    setCurrent(item);
    try { localStorage.setItem("td-current", JSON.stringify(item)); } catch { /* private mode */ }
  }

  React.useEffect(() => {
    let disposed = false;
    const cleanup: Array<() => void> = [];
    const timers = new Set<number>();
    const update = (t: Transport) => {
      const was = running.current;
      tickClock(); transportRef.current = t; tickClock();
      running.current = t.running;
      setTransport(t);
      if (!t.running) {
        timers.forEach(window.clearTimeout); timers.clear(); setBeat(null);
        if (was) void flush();
      }
      invoke<string[]>("get_output_devices").then(d => { if (!disposed) setDevices(d); }).catch(() => {});
    };
    const subscribe = <T,>(event: string, fn: (v: T) => void) => listen<T>(event, e => { if (!disposed) fn(e.payload); })
      .then(un => disposed ? un() : cleanup.push(un)).catch(e => { if (!disposed) setError(String(e)); });
    void subscribe<Transport>("transport", update);
    void subscribe<BeatEvent>("beat", ev => {
      if (ev.kind === "sub" || !running.current) return;
      const show = () => { if (!disposed && running.current) setBeat(ev); };
      const wait = ev.at_ms - Date.now();
      if (wait > 4 && wait < 300) {
        const timer = window.setTimeout(() => { timers.delete(timer); show(); }, wait);
        timers.add(timer);
      } else { show(); }
    });
    invoke<Transport>("get_transport").then(t => { if (!disposed) update(t); }).catch(e => { if (!disposed) setError(String(e)); });
    invoke<Journal | null>("get_journal").then(j => { if (!disposed) setJournal({ ...EMPTY_JOURNAL, ...j }); }).catch(e => { if (!disposed) { setJournal(EMPTY_JOURNAL); setError(String(e)); } });
    const second = window.setInterval(() => {
      if (!running.current) return;
      tickClock(); setTick(n => n + 1);
      if (clock.current.pendingSeconds >= FLUSH_SECONDS) void flush();
    }, 1000);
    // The window often stays open past midnight.
    const minute = window.setInterval(() => setToday(dayOf(new Date())), 30_000);
    return () => { disposed = true; cleanup.forEach(un => un()); timers.forEach(window.clearTimeout); window.clearInterval(second); window.clearInterval(minute); };
  }, [flush]);

  React.useEffect(() => { if (transport) setTempo(String(transport.bpm)); }, [transport?.bpm]);
  React.useEffect(() => { if (transport) setVolume(transport.volume); }, [transport?.volume]);

  async function action(fn: () => Promise<void>) {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setError("");
    try { await fn(); return true; } catch (e) { setError(String(e)); return false; }
    finally { inFlight.current = false; setBusy(false); }
  }
  const change = (controls: Controls) => action(async () => { setTransport(await invoke<Transport>("set_main_controls", { controls })); });
  // Journal writes queue behind the clock's, so each answer is the newest journal.
  const mutate = (cmd: string, args: Record<string, unknown>) => action(async () => { await writes.current; setJournal(await invoke<Journal>(cmd, args)); });
  const toggle = () => action(async () => { await invoke("toggle_play"); setTransport(await invoke<Transport>("get_transport")); });
  function commitTempo(value = tempo) {
    const bpm = Number(value);
    if (!value.trim() || !Number.isInteger(bpm) || bpm < 30 || bpm > 300) {
      setError("速度请填 30 到 300 之间的整数。");
      return;
    }
    if (bpm !== transport?.bpm) void change({ bpm });
  }

  // Space starts and stops from anywhere that is not a control of its own.
  const toggleRef = React.useRef(toggle);
  toggleRef.current = toggle;
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || (e.target as HTMLElement).closest("input, select, textarea, button, summary, [role=tab]")) return;
      e.preventDefault(); void toggleRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectedDevice = transport?.output_device ?? "";
  const listedDevices = selectedDevice && !devices.includes(selectedDevice) ? [selectedDevice, ...devices] : devices;
  const book = BOOKS.find(b => b.id === journal?.active_book) ?? BOOKS[0];
  const days = journal ? secondsByDay(journal) : new Map<string, number>();
  const run = streaks(days.keys(), today);
  const checkedIn = days.has(today);
  const byHand = !!journal?.checkins.includes(today);

  const metronome = (size: "hero" | "bar") => <Metronome size={size} transport={transport} beat={beat} busy={busy} tempo={tempo} setTempo={setTempo} commitTempo={commitTempo}
    nudge={by => { if (transport) void change({ bpm: Math.max(30, Math.min(300, transport.bpm + by)) }); }} toggle={() => void toggle()}
    tap={() => {
      const bpm = tapper.current.tap(performance.now());
      if (bpm !== null) { const bounded = Math.max(30, Math.min(300, bpm)); setTempo(String(bounded)); void change({ bpm: bounded }); }
    }} />;

  return <div className="td-app">
    <header className="td-top">
      <div className="td-brand">TAKTDOCK<small>练习台</small></div>
      <nav className="td-mode-nav" role="tablist" aria-label="页面">
        {PAGES.map(([id, label]) => <button key={id} role="tab" aria-selected={page === id} onClick={() => setPage(id)}>{label}</button>)}
      </nav>
      <div className="td-streak" aria-label="打卡">
        <span title={`最长连续 ${run.longest} 天`}><b className="num">{run.current}</b>天连续</span>
        {checkedIn && !byHand ? <span className="td-checked">✓ 今日已打卡</span>
          : <button type="button" className={checkedIn ? "td-checked" : ""} disabled={!journal || busy} title={checkedIn ? "点击取消今天的打卡" : "练满 1 分钟会自动打卡；没开节拍器练的话可以手动打卡"}
            onClick={() => void mutate("set_journal_checkin", { date: today, on: !checkedIn })}>{checkedIn ? "✓ 今日已打卡" : "今日打卡"}</button>}
      </div>
    </header>
    {page !== "practice" && metronome("bar")}
    {error && <p className="td-error td-banner" role="alert">{error}</p>}
    {transport?.device_problem && <p className="td-error td-banner" role="alert">{transport.device_problem}</p>}

    <main className="td-page" data-page={page}>
      {!journal && (page === "practice" || page === "library" || page === "stats") && <p className="jr-empty">正在读取练习记录…</p>}
      {page === "practice" && journal && <Focus journal={journal} book={book} today={today} current={current} pending={clock.current.pendingSeconds} session={clock.current.sessionSeconds}
        transport={transport} metronome={metronome("hero")} select={select} mutate={mutate} flush={() => flush()} setBpm={bpm => void change({ bpm })} openLibrary={() => setPage("library")} />}
      {page === "library" && journal && <Library journal={journal} books={BOOKS} book={book} today={today} current={current} mutate={mutate} practise={item => { select(item); setPage("practice"); }} />}
      {page === "stats" && journal && <Stats journal={journal} book={book} today={today} />}
      <div hidden={page !== "coach"}><RhythmCoach transport={transport} /></div>
      {page === "metronome" && <div className="td-metro">
        <section className="td-panel" aria-label="节拍设置">
          <h3>节拍设置</h3>
          <fieldset disabled={busy || !transport} className="td-controls">
            <div className="td-pair">
              <label>拍号<select aria-label="拍号" value={`${transport?.beats_per_bar ?? 4}/${transport?.beat_unit ?? 4}`} onChange={e => void change({ meter: e.target.value.split("/").map(Number) })}>
                {METERS.map(m => <option key={m}>{m}</option>)}</select></label>
              <label>细分<select aria-label="细分" value={transport?.subdivision ?? 1} onChange={e => void change({ subdivision: Number(e.target.value) })}>
                {SUBDIVISIONS.map((s, i) => <option key={s} value={i + 1}>{s}</option>)}</select></label>
            </div>
            <label className="td-check"><input type="checkbox" checked={transport?.accent_first ?? true} onChange={e => void change({ accent_first: e.target.checked })} />第一拍加重音</label>
            <div className="td-pair">
              <label>音色<select aria-label="音色" value={transport?.sound ?? "click"} onChange={e => void change({ sound: e.target.value })}>
                <option value="click">电子滴答</option><option value="wood">木鱼</option><option value="hihat">踩镲</option>
              </select></label>
              <label>音量 <span className="td-volume num">{volume}%{volume > 85 ? " · 增强" : ""}</span><input className="td-range" aria-label="音量" type="range" min={0} max={100} value={volume} onChange={e => setVolume(Number(e.target.value))}
                onPointerUp={e => void change({ volume: Number(e.currentTarget.value) })} onKeyUp={e => void change({ volume: Number(e.currentTarget.value) })} /></label>
            </div>
            <label>输出设备<select aria-label="输出设备" value={selectedDevice} onChange={e => void change({ output_device: e.target.value })}>
              <option value="">跟随系统默认</option>{listedDevices.map(d => <option key={d} value={d}>{d}{devices.includes(d) ? "" : "（未连接）"}</option>)}
            </select></label>
          </fieldset>
          <p className="td-footnote">{transport?.active_device ? `正在通过 ${transport.active_device} 播放。` : ""}音量 85% 以上会把声音压得更响、更硬。最小化窗口不会停止节拍；关闭窗口会停止并退出。</p>
        </section>
        <section className="td-panel"><Presets transport={transport} /></section>
      </div>}
    </main>
  </div>;
}

interface MetronomeProps {
  /** "hero" is the practice page's centrepiece; "bar" rides under the header elsewhere. */
  size: "hero" | "bar";
  transport: Transport | null;
  beat: BeatEvent | null;
  busy: boolean;
  tempo: string;
  setTempo: (v: string) => void;
  commitTempo: (v?: string) => void;
  nudge: (by: number) => void;
  toggle: () => void;
  tap: () => void;
}

function Metronome({ size, transport, beat, busy, tempo, setTempo, commitTempo, nudge, toggle, tap }: MetronomeProps) {
  const count = transport?.running && beat ? beat.beats_per_bar : transport?.beats_per_bar ?? 4;
  const off = !transport || busy;
  return <section className="td-transport" data-size={size} aria-label="节拍器" data-running={transport?.running ?? false}>
    <button type="button" className="td-go" aria-label={transport?.running ? "停止" : "开始"} title="空格键也可以开始 / 停止" disabled={off} onClick={toggle}>
      {transport?.running ? <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l11-6.5a1 1 0 0 0 0-1.8l-11-6.5A1 1 0 0 0 8 5.5z" /></svg>}
    </button>
    <div className="td-tempo">
      <button type="button" aria-label="减 5" disabled={off || (transport?.bpm ?? 0) <= 30} onClick={() => nudge(-5)}>−5</button>
      <button type="button" aria-label="减 1" disabled={off || (transport?.bpm ?? 0) <= 30} onClick={() => nudge(-1)}>−1</button>
      <label className="td-speed"><input className="num" aria-label="速度 BPM" type="number" min={30} max={300} step={1}
        disabled={off} value={tempo} onChange={e => setTempo(e.target.value)}
        onBlur={() => commitTempo()} onKeyDown={e => { if (e.key === "Enter") commitTempo(); }} /><span>BPM</span></label>
      <button type="button" aria-label="加 1" disabled={off || (transport?.bpm ?? 300) >= 300} onClick={() => nudge(1)}>+1</button>
      <button type="button" aria-label="加 5" disabled={off || (transport?.bpm ?? 300) >= 300} onClick={() => nudge(5)}>+5</button>
    </div>
    <div className="td-transport-side">
      <div className="td-beats" role="img" aria-label={beat && transport?.running ? `第 ${beat.beat + 1} 拍，共 ${count} 拍` : `${count} 拍`}>
        {Array.from({ length: count }, (_, i) => <span key={i} data-lit={!!(transport?.running && beat?.beat === i)} data-accent={i === 0 && transport?.accent_first} />)}
        <small className="num">{transport ? `${transport.beats_per_bar}/${transport.beat_unit} · ${SUBDIVISIONS[transport.subdivision - 1]}` : ""}</small>
      </div>
      <input className="td-range" aria-label="速度滑块" type="range" min={30} max={300} step={1} disabled={off}
        value={Number(tempo) || 30} onChange={e => setTempo(e.target.value)}
        onPointerUp={e => commitTempo(e.currentTarget.value)} onKeyUp={e => commitTempo(e.currentTarget.value)} />
    </div>
    <button type="button" className="td-tap" disabled={off} onClick={tap}>TAP<small>敲击测速</small></button>
  </section>;
}
