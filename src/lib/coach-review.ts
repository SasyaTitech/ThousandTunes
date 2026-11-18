export type CoachNote = { index: number; target_ms: number; delta_ms: number | null; kind: string };
export type ExtraCount = { index: number; count: number };

// A window of target positions: misses and unclear attacks occupy a position,
// while duplicate/unmatched attacks belong to their nearest target position.
export function recentReview(results: CoachNote[], extras: ExtraCount[], length: number) {
  const last = Math.max(results.at(-1)?.index ?? -1, extras.at(-1)?.index ?? -1);
  const first = Math.max(0, last - length + 1);
  const notes = results.filter(n => n.index >= first);
  const deltas = notes.flatMap(n => n.delta_ms === null ? [] : [n.delta_ms]);
  const mean = deltas.length ? deltas.reduce((sum, x) => sum + x, 0) / deltas.length : 0;
  return {
    notes,
    played: deltas.length,
    missed: notes.filter(n => n.kind === "miss").length,
    uncertain: notes.filter(n => n.kind === "uncertain").length,
    extra: extras.filter(n => n.index >= first).reduce((sum, n) => sum + n.count, 0),
    mean_ms: mean,
    spread_ms: deltas.length ? Math.sqrt(deltas.reduce((sum, x) => sum + (x - mean) ** 2, 0) / deltas.length) : 0,
  };
}
