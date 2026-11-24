import { formatClock, type Entry, type Exercise } from "@/lib/journal";

interface Props {
  exercise: Exercise;
  /** Today's record of it, if there is one. */
  entry: Entry | null;
  /** Seconds practised today, counting what is not yet written. */
  seconds: number;
  drop: (clear: boolean) => void;
  cancel: () => void;
}

/**
 * Asked before an exercise leaves today's list, wherever the list is shown.
 * Earlier records always stay; clearing today's is offered only when there is one.
 */
export default function DropAsk({ exercise, entry, seconds, drop, cancel }: Props) {
  const has = seconds > 0 || !!entry && (entry.speed !== null || entry.passed || entry.note !== "");
  return <div className="td-ask" role="group" aria-label={`确认移出 ${exercise.id}`} onKeyDown={e => { if (e.key === "Escape") cancel(); }}>
    <p>把“{exercise.title}”移出今日清单？</p>
    <small>{has ? `今天已有记录：练了 ${formatClock(seconds)}${entry?.speed != null ? `，成绩 ${entry.speed}` : ""}。可以保留，也可以一并清除。以前的记录不受影响。` : "以前的记录都会保留，之后可以从教材库再加回来。"}</small>
    <div>
      <button type="button" autoFocus onClick={() => drop(false)}>{has ? "只移出，保留今日记录" : "移出"}</button>
      {has && <button type="button" className="td-danger" onClick={() => drop(true)}>移出并清除今日记录</button>}
      <button type="button" onClick={cancel}>取消</button>
    </div>
  </div>;
}
