import * as React from "react";
import DropAsk from "@/DropAsk";
import type { Transport } from "@/lib/types";
import { FREE, formatClock, progressOf, sameItem, targetOf, tempoText, unitLabel, type Book, type Entry, type Exercise, type Item, type Journal } from "@/lib/journal";

export type Mutate = (cmd: string, args: Record<string, unknown>) => Promise<boolean>;

interface Props {
  journal: Journal;
  book: Book;
  today: string;
  /** The exercise being timed; null is free practice. */
  current: Item | null;
  /** Seconds played but not yet written to the journal. */
  pending: number;
  session: number;
  transport: Transport | null;
  /** The metronome itself, drawn by the window so every page shares one. */
  metronome: React.ReactNode;
  select: (item: Item | null) => void;
  mutate: Mutate;
  /** Takes an exercise off the list, clearing today's record of it when asked to. */
  drop: (id: string, clear: boolean) => void;
  /** Writes pending time first, so an edit never races the clock. */
  flush: () => Promise<void>;
  setBpm: (bpm: number) => void;
  openLibrary: () => void;
}

const clampBpm = (n: number) => Math.max(30, Math.min(300, Math.round(n)));
const todaySeconds = (journal: Journal, item: Item, today: string) => journal.entries.find(e => e.book === item.book && e.exercise === item.exercise && e.date === today)?.seconds ?? 0;

export default function Focus({ journal, book, today, current, pending, session, transport, metronome, select, mutate, drop, flush, setBpm, openLibrary }: Props) {
  const [open, setOpen] = React.useState(() => { try { return localStorage.getItem("td-rail") !== "closed"; } catch { return true; } });
  const toggleRail = () => setOpen(v => { try { localStorage.setItem("td-rail", v ? "closed" : "open"); } catch { /* private mode */ } return !v; });

  const all = book.weeks.flatMap(w => w.exercises);
  const exercise = current?.book === book.id ? all.find(e => e.id === current.exercise) ?? null : null;
  // The list is what was chosen from the book, in the book's order; the current one always shows.
  const listed = all.filter(e => journal.practising.some(i => i.book === book.id && i.exercise === e.id) || e.id === exercise?.id);
  const index = exercise ? listed.findIndex(e => e.id === exercise.id) : -1;
  const live = (item: Item) => todaySeconds(journal, item, today) + (sameItem(item, current ?? FREE) ? pending : 0);
  const item: Item = exercise ? { book: book.id, exercise: exercise.id } : FREE;
  // Taking an exercise off the list is asked about first.
  const [asking, setAsking] = React.useState<string | null>(null);

  return <div className="fx" data-rail={open ? "open" : "closed"}>
    <aside className="fx-rail" aria-label="今日清单">
      <div className="fx-rail-head"><h3>今日清单</h3>
        <button type="button" aria-label={open ? "收起清单" : "展开清单"} aria-expanded={open} onClick={toggleRail}>{open ? "«" : "»"}</button></div>
      <ol>
        {listed.map(e => {
          const seconds = live({ book: book.id, exercise: e.id }), goal = (e.minutes ?? 0) * 60;
          const done = goal > 0 && seconds >= goal;
          if (asking === e.id) return <li key={e.id}><DropAsk exercise={e} seconds={seconds}
            entry={journal.entries.find(x => x.book === book.id && x.exercise === e.id && x.date === today) ?? null}
            drop={clear => { setAsking(null); drop(e.id, clear); }} cancel={() => setAsking(null)} /></li>;
          return <li key={e.id}>
            <button type="button" aria-label={`${e.id} ${e.title}`} aria-current={e.id === exercise?.id} data-done={done} title={e.title} onClick={() => select({ book: book.id, exercise: e.id })}>
              <span className="fx-id num">{e.id.replace(/^W(\d+)-EX/, "$1-")}</span>
              <span className="fx-title">{e.title}</span>
              <span className="fx-time num">{done ? "✓ " : ""}{formatClock(seconds)}{goal ? <small> / {e.minutes}:00</small> : null}</span>
              <i style={{ width: `${goal ? Math.min(100, seconds / goal * 100) : 0}%` }} />
            </button>
            <button type="button" className="td-drop" aria-label={`移出 ${e.id}`} title="移出今日清单" onClick={() => setAsking(e.id)}>×</button>
          </li>;
        })}
      </ol>
      {listed.length === 0 && <p className="fx-rail-empty">清单是空的。到“教材”里挑出你正在练的项目。</p>}
      <button type="button" className="fx-add" aria-label="从教材添加" onClick={openLibrary}><b>＋</b><span>从教材添加</span></button>
      <button type="button" className="fx-free" aria-label="自由练习" aria-current={!exercise} title="不选项目，随便弹弹" onClick={() => select(null)}>
        <span className="fx-id">∞</span><span className="fx-title">自由练习</span><span className="fx-time num">{formatClock(live(FREE))}</span></button>
    </aside>

    <section className="fx-main" aria-label="当前练习">
      {exercise ? <ExerciseHead exercise={exercise} journal={journal} book={book} transport={transport} setBpm={setBpm} />
        : <header className="fx-head"><p className="fx-kicker">没有选中项目</p><h2>自由练习</h2>
          <p className="fx-target">开着节拍器的时间会计入今天的总时长，但不属于任何教材项目。{listed.length > 0 ? "从左边选一条练习开始计时。" : ""}</p></header>}

      {metronome}

      <Timers exercise={exercise} seconds={live(item)} session={session} running={transport?.running ?? false}>
        {exercise && <Result exercise={exercise} entry={journal.entries.find(e => sameItem(e, item) && e.date === today) ?? null} item={item} today={today} bpm={transport?.bpm ?? null} mutate={mutate} flush={flush} />}
      </Timers>

      {exercise && <div className="fx-actions">
        <button type="button" disabled={index <= 0} onClick={() => select({ book: book.id, exercise: listed[index - 1].id })}>← 上一条</button>
        <PassButton journal={journal} book={book} exercise={exercise} today={today} mutate={mutate} flush={flush} />
        <button type="button" disabled={index < 0 || index >= listed.length - 1} onClick={() => select({ book: book.id, exercise: listed[index + 1].id })}>下一条 →</button>
      </div>}

      {exercise && <TodayRecord key={exercise.id} journal={journal} item={item} exercise={exercise} today={today} mutate={mutate} flush={flush} />}
    </section>
  </div>;
}

function ExerciseHead({ exercise, journal, book, transport, setBpm }: { exercise: Exercise; journal: Journal; book: Book; transport: Transport | null; setBpm: (bpm: number) => void }) {
  const progress = progressOf(journal, book.id, exercise);
  const target = targetOf(exercise);
  const last = [...progress.entries].reverse().find(e => e.speed !== null)?.speed ?? null;
  const tempos: Array<[string, number]> = [];
  if (exercise.unit !== "percent" && exercise.tempo) {
    tempos.push(["起始", exercise.tempo.from]);
    if (last !== null && last !== exercise.tempo.from) tempos.push(["上次", last]);
    if (last !== null && target !== null && last < target) tempos.push(["上次 +5", Math.min(target, last + 5)]);
    if (target !== null) tempos.push(["目标", target]);
  }
  return <header className="fx-head">
    <p className="fx-kicker">{exercise.id}{exercise.page ? ` · 教材第 ${exercise.page} 页` : ""}{progress.passed ? " · 已达标" : ""}</p>
    <h2>{exercise.title}</h2>
    <p className="fx-target"><b className="num">{tempoText(exercise)}</b>{exercise.minutes ? ` · 每天 ${exercise.minutes} 分钟` : ""}{exercise.goal && exercise.tempo ? ` · ${exercise.goal}` : ""}</p>
    {tempos.length > 0 && <div className="fx-tempos" aria-label="常用速度">
      {tempos.map(([label, bpm]) => <button type="button" key={label} data-on={transport?.bpm === clampBpm(bpm)} disabled={!transport} onClick={() => setBpm(clampBpm(bpm))}>{label}<b className="num">{bpm}</b></button>)}
    </div>}
  </header>;
}

function Timers({ exercise, seconds, session, running, children }: { exercise: Exercise | null; seconds: number; session: number; running: boolean; children?: React.ReactNode }) {
  const goal = (exercise?.minutes ?? 0) * 60;
  return <div className="fx-timers" data-running={running}>
    <div title="从这次按下开始算起，停止后再开始会重新计"><span>本次</span><b className="num" aria-label="本次计时">{formatClock(session)}</b></div>
    <div className="fx-today" title="这条练习今天一共练了多久"><span>今日累计{goal > 0 && seconds >= goal ? " · 已练够" : ""}</span>
      <b className="num" aria-label="今日计时">{formatClock(seconds)}{goal ? <small> / {exercise!.minutes}:00</small> : null}</b>
      {goal > 0 && <i role="progressbar" data-done={seconds >= goal} aria-label="今日进度" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(goal, seconds)}><u style={{ width: `${Math.min(100, seconds / goal * 100)}%` }} /></i>}</div>
    {children}
  </div>;
}

/**
 * The speed the player judges they reached today. Never taken from the
 * metronome on its own: a tempo that was fought with for ten minutes and then
 * given up is not a result. One press records the tempo now set.
 */
function Result({ exercise, entry, item, today, bpm, mutate, flush }: { exercise: Exercise; entry: Entry | null; item: Item; today: string; bpm: number | null; mutate: Mutate; flush: () => Promise<void> }) {
  const speed = entry?.speed ?? null;
  const metronome = !!exercise.tempo && exercise.unit !== "percent" && bpm !== null;
  const record = (value: number) => void flush().then(() => mutate("set_journal_result", { book: item.book, exercise: item.exercise, date: today, speed: value, note: entry?.note ?? "" }));
  return <div className="fx-result"><span>今日成绩</span>
    <b className="num" aria-label="今日成绩">{speed ?? "—"}{speed !== null && <small> {unitLabel(exercise)}</small>}</b>
    {metronome ? <button type="button" disabled={speed === bpm} title="把节拍器现在的速度记为今天的成绩；之后可以再改" onClick={() => record(bpm!)}>{speed === bpm ? "已记下当前速度" : `记下当前速度 ${bpm}`}</button>
      : <small>在下面的“今日记录与备注”里填写</small>}
  </div>;
}

function PassButton({ journal, book, exercise, today, mutate, flush }: { journal: Journal; book: Book; exercise: Exercise; today: string; mutate: Mutate; flush: () => Promise<void> }) {
  const passed = progressOf(journal, book.id, exercise).passed;
  const set = (value: boolean) => void flush().then(() => mutate("set_journal_passed", { book: book.id, exercise: exercise.id, date: today, passed: value }));
  return passed ? <button type="button" className="fx-passed" title="撤销后可以重新加入清单" onClick={() => set(false)}>✓ 已达标 · 撤销</button>
    : <button type="button" className="primary" title="达到教材要求后，这条练习会从清单里移出" onClick={() => set(true)}>标记达标</button>;
}

function TodayRecord({ journal, item, exercise, today, mutate, flush }: { journal: Journal; item: Item; exercise: Exercise; today: string; mutate: Mutate; flush: () => Promise<void> }) {
  const entry = journal.entries.find(e => sameItem(e, item) && e.date === today) ?? null;
  const [speed, setSpeed] = React.useState(""), [note, setNote] = React.useState(""), [message, setMessage] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  // The form follows the record while closed; once open, what is typed is the user's.
  React.useEffect(() => { if (!editing) { setSpeed(entry?.speed?.toString() ?? ""); setNote(entry?.note ?? ""); } }, [entry?.speed, entry?.note, editing]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(speed);
    if (speed.trim() && !(Number.isInteger(n) && n >= 1 && n <= 400)) return setMessage("速度请填 1 到 400 之间的整数。");
    await flush();
    if (await mutate("set_journal_result", { book: item.book, exercise: item.exercise, date: today, speed: speed.trim() ? n : null, note: note.trim() })) { setMessage("已保存。"); setEditing(false); }
  }
  return <details className="fx-record" onToggle={e => { setEditing(e.currentTarget.open); setMessage(""); }}>
    <summary>今日记录与备注{entry?.note ? <small>{entry.note}</small> : null}</summary>
    <form onSubmit={e => void save(e)} aria-label="今日记录">
      <label>今日成绩（{unitLabel(exercise)}）<input className="num" aria-label="速度" inputMode="numeric" placeholder="—" value={speed} onChange={e => setSpeed(e.target.value)} /></label>
      <label className="fx-note">备注<input aria-label="备注" maxLength={300} placeholder="今天的感觉、卡住的地方…" value={note} onChange={e => setNote(e.target.value)} /></label>
      <button type="submit" className="primary">保存</button>
      <p role="status">{message}</p>
    </form>
  </details>;
}
