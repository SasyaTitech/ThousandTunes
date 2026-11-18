import { test, expect } from "@playwright/test";
import { recentReview, type CoachNote } from "../src/lib/coach-review";

test("recent statistics use target positions, including misses, and exclude old extras", () => {
  const notes: CoachNote[] = [
    { index: 90, target_ms: 0, delta_ms: 100, kind: "late" },
    { index: 91, target_ms: 0, delta_ms: -40, kind: "early" },
    { index: 92, target_ms: 0, delta_ms: null, kind: "miss" },
    { index: 93, target_ms: 0, delta_ms: null, kind: "uncertain" },
    { index: 94, target_ms: 0, delta_ms: 60, kind: "late" },
  ];
  const result = recentReview(notes, [{ index: 90, count: 99 }, { index: 92, count: 2 }], 4);
  expect(result.notes.map(n => n.index)).toEqual([91, 92, 93, 94]);
  expect(result).toMatchObject({ played: 2, missed: 1, uncertain: 1, extra: 2, mean_ms: 10, spread_ms: 50 });
  expect(recentReview([], [], 32)).toMatchObject({ played: 0, mean_ms: 0, spread_ms: 0 });
});

test("a fully missed recent segment does not retain old playing statistics", () => {
  const notes: CoachNote[] = Array.from({ length: 32 }, (_, index) => ({ index, target_ms: index * 500, delta_ms: index < 16 ? 20 : null, kind: index < 16 ? "good" : "miss" }));
  expect(recentReview(notes, [], 16)).toMatchObject({ played: 0, missed: 16, mean_ms: 0, spread_ms: 0 });
});
