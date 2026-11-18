import { addDays, bookTotals, formatDuration, formatMinutes, secondsByDay, streaks, unitLabel, weekdayOf, type Book, type Journal } from "@/lib/journal";

const WEEKS = 26;
const level = (minutes: number | undefined) => minutes === undefined ? 0 : minutes < 30 ? 1 : minutes < 60 ? 2 : minutes < 120 ? 3 : 4;
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export default function Stats({ journal, book, today }: { journal: Journal; book: Book; today: string }) {
  const seconds = secondsByDay(journal);
  // Whole minutes are plenty for a calendar and a bar chart.
  const days = new Map([...seconds].map(([day, s]) => [day, Math.round(s / 60)]));
  const run = streaks(days.keys(), today);
  const totals = bookTotals(journal, book);
  const totalMinutes = [...days.values()].reduce((a, b) => a + b, 0);
  const weekStart = addDays(today, -weekdayOf(today));
  const thisWeek = Array.from({ length: 7 }, (_, i) => days.get(addDays(weekStart, i)) ?? 0).reduce((a, b) => a + b, 0);

  // Monday-first columns, the current week last.
  const first = addDays(weekStart, -7 * (WEEKS - 1));
  const columns = Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)));
  const fortnight = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const peak = Math.max(30, ...fortnight.map(d => days.get(d) ?? 0));

  const titles = new Map(book.weeks.flatMap(w => w.exercises).map(e => [e.id, e]));
  const recent = journal.entries.filter(e => e.book === book.id && (e.seconds >= 60 || e.speed !== null || e.passed)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);

  return <section className="st" aria-label="统计">
    <div className="st-tiles">
      <div data-accent="true"><b className="num">{run.current}</b><span>连续打卡（天）</span></div>
      <div><b className="num">{run.longest}</b><span>最长连续（天）</span></div>
      <div><b className="num">{days.size}</b><span>累计打卡（天）</span></div>
      <div><b className="num">{totalMinutes >= 60 ? (totalMinutes / 60).toFixed(1) : totalMinutes}</b><span>累计时长（{totalMinutes >= 60 ? "小时" : "分钟"}）</span></div>
      <div><b className="num">{totals.passed}<small>/{totals.total}</small></b><span>已达标练习</span></div>
    </div>

    <div className="st-grid">
      <section className="st-panel st-wide" aria-label="打卡日历">
        <h3>打卡日历 <small>最近 {WEEKS} 周 · 本周已练 {formatMinutes(thisWeek)}</small></h3>
        <div className="st-heat" role="img" aria-label={`最近 ${WEEKS} 周共打卡 ${columns.flat().filter(d => days.has(d)).length} 天`}>
          <div className="st-heat-days" aria-hidden="true"><span>一</span><span>三</span><span>五</span><span>日</span></div>
          {columns.map(col => <div key={col[0]} className="st-heat-col">
            {col.map(d => d > today ? <i key={d} data-future="true" /> : <i key={d} data-level={level(days.get(d))} data-today={d === today}
              title={`${d} · ${days.has(d) ? days.get(d) ? formatMinutes(days.get(d)!) : "已打卡" : "未练习"}`} />)}
          </div>)}
        </div>
        <p className="st-legend">少<i data-level="0" /><i data-level="1" /><i data-level="2" /><i data-level="3" /><i data-level="4" />多 <span>按当天练习分钟数</span></p>
      </section>

      <section className="st-panel" aria-label="近 14 天练习时长">
        <h3>近 14 天 <small>每天练习分钟数</small></h3>
        <div className="st-bars">
          {fortnight.map(d => { const m = days.get(d) ?? 0; return <div key={d} title={`${d} · ${m} 分钟`} data-today={d === today}>
            <span className="num">{m || ""}</span><i style={{ height: `${m / peak * 100}%` }} data-empty={m === 0} /><small>{shortDate(d)}</small></div>; })}
        </div>
      </section>

      <section className="st-panel" aria-label="教材进度">
        <h3>教材进度 <small>{book.title}</small></h3>
        <ul className="st-weeks">
          {totals.weeks.map(w => <li key={w.title}>
            <span>{w.title}</span>
            <div className="st-track" role="img" aria-label={`${w.title}：${w.passed} 条达标，${w.started} 条已开始，共 ${w.total} 条`}>
              <i className="st-started" style={{ width: `${w.started / w.total * 100}%` }} /><i className="st-passed" style={{ width: `${w.passed / w.total * 100}%` }} /></div>
            <b className="num">{w.passed}/{w.total}</b>
          </li>)}
        </ul>
        <p className="st-legend"><i className="st-passed" />已达标<i className="st-started" />练习中</p>
      </section>

      <section className="st-panel st-wide" aria-label="最近记录">
        <h3>最近记录</h3>
        {recent.length === 0 ? <p className="st-empty">还没有记录。去“教材打卡”保存第一条练习记录吧。</p> : <ul className="st-recent">
          {recent.map(e => { const ex = titles.get(e.exercise); return <li key={`${e.exercise}-${e.date}`}>
            <span className="num">{e.date}</span><span className="st-recent-title"><small>{e.exercise}</small>{ex?.title ?? "（教材中已无此练习）"}</span>
            <b className="num">{e.speed !== null ? `${e.speed} ${ex ? unitLabel(ex) : ""}` : "—"}</b><span className="num">{e.seconds > 0 ? formatDuration(e.seconds) : ""}</span><span className="jr-ok">{e.passed ? "✓ 达标" : ""}</span>
          </li>; })}
        </ul>}
      </section>
    </div>
  </section>;
}
