import * as React from "react";
import type { Mutate } from "@/Focus";
import { formatDuration, progressOf, targetOf, tempoText, unitLabel, type Book, type Entry, type Exercise, type Item, type Journal } from "@/lib/journal";

interface Props {
  journal: Journal;
  books: Book[];
  book: Book;
  today: string;
  current: Item | null;
  mutate: Mutate;
  /** Make this the exercise being timed and go to the practice page. */
  practise: (item: Item) => void;
}

const shortDate = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;

/** The textbook as a catalogue: choose what to practise, and look after the records. */
export default function Library({ journal, books, book, today, current, mutate, practise }: Props) {
  const all = book.weeks.flatMap(w => w.exercises);
  const [selected, setSelected] = React.useState(() => (current?.book === book.id && all.some(e => e.id === current.exercise) ? current.exercise : all[0]?.id) ?? "");
  const [week, setWeek] = React.useState(() => Math.max(0, book.weeks.findIndex(w => w.exercises.some(e => e.id === selected))));
  React.useEffect(() => {
    if (!all.some(e => e.id === selected)) { setSelected(all[0]?.id ?? ""); setWeek(0); }
  }, [book.id]);

  const exercises = book.weeks[week]?.exercises ?? [];
  const exercise = all.find(e => e.id === selected) ?? exercises[0];
  const listed = (id: string) => journal.practising.some(i => i.book === book.id && i.exercise === id);
  if (!exercise) return <p className="jr-empty">这本教材里还没有练习。</p>;
  const open = exercises.filter(e => !progressOf(journal, book.id, e).passed);
  const weekListed = open.length > 0 && open.every(e => listed(e.id));
  const toggle = (ids: string[], on: boolean) => void mutate("set_journal_practising", { book: book.id, exercises: ids, on });

  return <section className="jr" aria-label="教材库">
    <div className="jr-top">
      <label className="jr-book">教材
        <select aria-label="教材" value={book.id} onChange={e => void mutate("set_journal_book", { book: e.target.value })}>
          {books.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
      </label>
      <div className="jr-weeks" role="tablist" aria-label="周">
        {book.weeks.map((w, i) => {
          const done = w.exercises.filter(e => progressOf(journal, book.id, e).passed).length;
          return <button key={w.title} role="tab" aria-selected={i === week} data-complete={done === w.exercises.length}
            onClick={() => { setWeek(i); if (!w.exercises.some(e => e.id === selected)) setSelected(w.exercises[0]?.id ?? ""); }}>
            {w.title}<small>{done}/{w.exercises.length}</small></button>;
        })}
      </div>
    </div>

    <div className="jr-grid">
      <div className="jr-side">
        <button type="button" className="jr-week-add" disabled={open.length === 0} onClick={() => toggle(open.map(e => e.id), !weekListed)}>
          {open.length === 0 ? "本周全部达标" : weekListed ? "把本周移出清单" : `把${book.weeks[week].title}加入清单`}</button>
        <ol className="jr-list" aria-label={`${book.weeks[week].title}的练习`}>
          {exercises.map(e => {
            const p = progressOf(journal, book.id, e), on = listed(e.id);
            return <li key={e.id} data-state={p.passed ? "passed" : on ? "listed" : p.entries.length ? "started" : "new"}>
              <button type="button" className="jr-row" aria-label={`${e.id} ${e.title}`} aria-current={e.id === exercise.id} onClick={() => setSelected(e.id)}>
                <span className="jr-name"><small>{e.id.replace(/^W\d+-/, "")}{p.passed ? " · 已达标" : on ? " · 在练" : ""}</small>{e.title}</span>
                <span className="jr-best num">{p.best}<small>{p.best !== null ? unitLabel(e) : e.tempo ? tempoText(e).replace(/ (BPM|%)/, "") : ""}</small></span>
                {p.ratio !== null && <i className="jr-bar" style={{ width: `${p.ratio * 100}%` }} />}
              </button>
              <button type="button" className="jr-pick" aria-pressed={on} aria-label={on ? `把 ${e.id} 移出清单` : `把 ${e.id} 加入清单`} title={on ? "移出今日清单" : "加入今日清单"} onClick={() => toggle([e.id], !on)}>{on ? "✓" : "＋"}</button>
            </li>;
          })}
        </ol>
      </div>
      <Detail key={exercise.id} journal={journal} book={book} exercise={exercise} today={today} listed={listed(exercise.id)} mutate={mutate} toggle={toggle} practise={practise} />
    </div>
  </section>;
}

type DetailProps = { journal: Journal; book: Book; exercise: Exercise; today: string; listed: boolean; mutate: Mutate; toggle: (ids: string[], on: boolean) => void; practise: (item: Item) => void };

function Detail({ journal, book, exercise, today, listed, mutate, toggle, practise }: DetailProps) {
  const progress = progressOf(journal, book.id, exercise);
  const unit = unitLabel(exercise);
  const [date, setDate] = React.useState(today);
  const existing = progress.entries.find(e => e.date === date) ?? null;
  const shown = (e: Entry | null) => ({ speed: e?.speed?.toString() ?? "", minutes: e && e.seconds > 0 ? String(Math.max(1, Math.round(e.seconds / 60))) : "", note: e?.note ?? "" });
  const [draft, setDraft] = React.useState(() => shown(existing));
  const [message, setMessage] = React.useState("");
  const [removing, setRemoving] = React.useState(false);
  React.useEffect(() => { setDraft(shown(existing)); setRemoving(false); }, [date, JSON.stringify(existing)]);
  React.useEffect(() => { setMessage(""); }, [date]);

  const number = (text: string, max: number, name: string): number | null | string => {
    if (!text.trim()) return null;
    const n = Number(text);
    return Number.isInteger(n) && n >= 1 && n <= max ? n : `${name}请填 1 到 ${max} 之间的整数。`;
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const speed = number(draft.speed, 400, "速度"), minutes = number(draft.minutes, 1440, "时长");
    if (typeof speed === "string") return setMessage(speed);
    if (typeof minutes === "string") return setMessage(minutes);
    // Minutes left as shown keep the exact seconds the clock counted.
    const seconds = draft.minutes === shown(existing).minutes ? existing?.seconds ?? 0 : (minutes ?? 0) * 60;
    const entry: Entry = { book: book.id, exercise: exercise.id, date, seconds, speed, passed: existing?.passed ?? false, note: draft.note.trim() };
    if (await mutate("save_journal_entry", { entry })) setMessage(`已保存 ${shortDate(date)} 的记录。`);
  }

  return <div className="jr-detail">
    <header>
      <p className="jr-kicker">{exercise.id}{exercise.page ? ` · 教材第 ${exercise.page} 页` : ""}{progress.passed ? " · 已达标" : listed ? " · 在练" : ""}</p>
      <h2>{exercise.title}</h2>
      <div className="jr-facts">
        <span><b className="num">{tempoText(exercise)}</b>教材要求</span>
        {exercise.minutes && <span><b className="num">{exercise.minutes} 分钟</b>每天</span>}
        <span><b className="num">{progress.best !== null ? `${progress.best} ${unit}` : "—"}</b>个人最好</span>
        <span><b className="num">{progress.entries.length} 天</b>累计 {formatDuration(progress.seconds)}</span>
      </div>
      {exercise.goal && exercise.tempo && <p className="jr-goal">{exercise.goal}</p>}
      <div className="jr-actions">
        <button type="button" className="primary" onClick={() => practise({ book: book.id, exercise: exercise.id })}>去练这条 →</button>
        {!progress.passed && <button type="button" onClick={() => toggle([exercise.id], !listed)}>{listed ? "移出今日清单" : "加入今日清单"}</button>}
        <button type="button" className={progress.passed ? "jr-passed" : ""} onClick={() => void mutate("set_journal_passed", { book: book.id, exercise: exercise.id, date: today, passed: !progress.passed })}>
          {progress.passed ? "✓ 已达标 · 撤销" : "标记达标"}</button>
      </div>
    </header>

    <form className="jr-form" onSubmit={e => void save(e)} aria-label="练习记录">
      <div className="jr-form-head">
        <h3>{date === today ? "今日记录" : `${shortDate(date)}的记录`}<small>{existing ? "已有记录，可修改" : "计时会自动记录，这里用来补记和更正"}</small></h3>
        <label>记录日期<input type="date" aria-label="记录日期" value={date} max={today} required onChange={e => { if (e.target.value) setDate(e.target.value); }} /></label>
      </div>
      <div className="jr-fields">
        <label>最高速度（{unit}）<input className="num" aria-label="速度" inputMode="numeric" placeholder="—" value={draft.speed} onChange={e => setDraft({ ...draft, speed: e.target.value })} /></label>
        <label>练习时长（分钟）<input className="num" aria-label="练习时长" inputMode="numeric" placeholder="—" value={draft.minutes} onChange={e => setDraft({ ...draft, minutes: e.target.value })} /></label>
        <label className="jr-note-field">备注<input aria-label="备注" maxLength={300} placeholder="今天的感觉、卡住的地方…" value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></label>
      </div>
      <div className="jr-actions">
        <button type="submit" className="primary">{existing ? "更新记录" : "保存记录"}</button>
        {existing && <button type="button" onClick={() => {
          if (!removing) return setRemoving(true);
          void mutate("delete_journal_entry", { book: book.id, exercise: exercise.id, date }).then(ok => { if (ok) setMessage("记录已删除。"); });
        }}>{removing ? "确认删除？" : "删除"}</button>}
        {date !== today && <button type="button" onClick={() => setDate(today)}>回到今天</button>}
        <p role="status">{message}</p>
      </div>
    </form>

    <History exercise={exercise} entries={progress.entries} date={date} onPick={setDate} />
  </div>;
}

function History({ exercise, entries, date, onPick }: { exercise: Exercise; entries: Entry[]; date: string; onPick: (d: string) => void }) {
  const unit = unitLabel(exercise);
  const points = entries.filter(e => e.speed !== null) as Array<Entry & { speed: number }>;
  const target = targetOf(exercise);
  const values = [...points.map(p => p.speed), ...(exercise.tempo ? [exercise.tempo.from] : []), ...(target !== null ? [target] : [])];
  const lo = Math.min(...values), hi = Math.max(...values), span = Math.max(1, hi - lo);
  const W = 520, H = 132, L = 34, R = 14, T = 14, B = 22;
  const x = (i: number) => points.length < 2 ? (L + W - R) / 2 : L + i * (W - L - R) / (points.length - 1);
  const y = (v: number) => T + (1 - (v - lo) / span) * (H - T - B);
  return <section className="jr-history" aria-label="历史记录">
    <h3>进度 <small>{entries.length ? `${entries.length} 天有记录` : "还没有记录"}</small></h3>
    {points.length > 0 && <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`速度变化，从 ${points[0].speed} 到 ${points.at(-1)!.speed} ${unit}`}>
      <text x={L - 6} y={y(lo) + 3} textAnchor="end">{lo}</text>
      {hi !== lo && <text x={L - 6} y={y(hi) + 3} textAnchor="end">{hi}</text>}
      <path d={`M${L} ${y(lo)} H${W - R}`} className="jr-axis" />
      {target !== null && <><path d={`M${L} ${y(target)} H${W - R}`} className="jr-target" /><text x={W - R} y={y(target) - 4} textAnchor="end" className="jr-target-label">目标 {target}</text></>}
      {points.length > 1 && <path d={points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.speed).toFixed(1)}`).join(" ")} className="jr-line" />}
      {points.map((p, i) => <circle key={p.date} cx={x(i)} cy={y(p.speed)} r={p.date === date ? 5 : 3.5} data-passed={p.passed}><title>{p.date} · {p.speed} {unit}</title></circle>)}
      <text x={x(0)} y={H - 5} textAnchor={points.length < 2 ? "middle" : "start"}>{shortDate(points[0].date)}</text>
      {points.length > 1 && <text x={x(points.length - 1)} y={H - 5} textAnchor="end">{shortDate(points.at(-1)!.date)}</text>}
    </svg>}
    {entries.length > 0 && <ul>
      {[...entries].reverse().map(e => <li key={e.date}>
        <button type="button" aria-label={`编辑 ${e.date} 的记录`} aria-current={e.date === date} onClick={() => onPick(e.date)}>
          <span>{shortDate(e.date)}</span>
          <b className="num">{e.speed !== null ? `${e.speed} ${unit}` : "—"}</b>
          <span className="num">{e.seconds > 0 ? formatDuration(e.seconds) : ""}</span>
          <span className="jr-ok">{e.passed ? "✓ 达标" : ""}</span>
          <span className="jr-note" title={e.note}>{e.note}</span>
        </button>
      </li>)}
    </ul>}
  </section>;
}
