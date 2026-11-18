import { test, expect, type Page } from "@playwright/test";
import { installTauriMock, calls } from "./harness";

const BOOK = "shuaishuai-7w-1";
const NOW = new Date(2026, 10, 18, 20, 0, 0); // 18 November 2026, local time

async function open(page: Page, seed?: (td: any) => void) {
  await installTauriMock(page);
  await page.clock.install({ time: NOW });
  if (seed) await page.addInitScript(`(${seed.toString()})(window.__TD)`);
  await page.setViewportSize({ width: 1120, height: 780 });
  await page.goto("/?view=main");
  await expect(page.getByRole("region", { name: "当前练习" })).toBeVisible();
}
const item = (exercise: string) => ({ book: "shuaishuai-7w-1", exercise });
const times = async (page: Page) => (await calls(page, "add_journal_time")).map(c => c.args);
const play = (page: Page) => page.getByRole("button", { name: "开始", exact: true });
const stop = (page: Page) => page.getByRole("button", { name: "停止", exact: true });

test("exercises are chosen from the book, and passing one takes it off the list", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("heading", { name: "自由练习" })).toBeVisible();
  await expect(page.getByText("清单是空的")).toBeVisible();
  await page.getByRole("button", { name: "从教材添加" }).click();
  await expect(page.getByLabel("教材", { exact: true })).toHaveValue(BOOK);

  await page.getByRole("button", { name: "把 W1-EX5 加入清单" }).click();
  await page.getByRole("button", { name: "把 W1-EX7 加入清单" }).click();
  expect((await calls(page, "set_journal_practising")).map(c => c.args)).toEqual([{ book: BOOK, exercises: ["W1-EX5"], on: true }, { book: BOOK, exercises: ["W1-EX7"], on: true }]);
  await page.getByRole("button", { name: "把 W1-EX7 移出清单" }).click();
  await page.getByRole("tab", { name: /第二周/ }).click();
  await page.getByRole("button", { name: "把第二周加入清单" }).click();
  expect((await calls(page, "set_journal_practising")).at(-1)?.args.exercises).toHaveLength(9);
  await page.getByRole("button", { name: "把本周移出清单" }).click();

  await page.getByRole("tab", { name: /第一周/ }).click();
  await page.getByRole("button", { name: "W1-EX6 1&3指全指板爬格子" }).click();
  await page.getByRole("button", { name: "去练这条 →" }).click();
  await expect(page.getByRole("heading", { name: "1&3指全指板爬格子" })).toBeVisible();
  // The one being played shows in the list even before it is added to it.
  const rail = page.getByRole("complementary", { name: "今日清单" });
  await expect(rail.getByRole("listitem")).toHaveCount(2);
  await rail.getByRole("button", { name: "W1-EX5 1&2指全指板爬格子" }).click();
  await expect(page.locator(".fx-target")).toContainText("50 → 100 BPM · 每天 10 分钟");

  await page.getByRole("button", { name: "标记达标" }).click();
  expect((await calls(page, "set_journal_passed")).at(-1)?.args).toEqual({ ...item("W1-EX5"), date: "2026-11-18", passed: true });
  await expect(page.getByRole("button", { name: "✓ 已达标 · 撤销" })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__TD.journal.practising)).toEqual([]);
  await page.getByRole("button", { name: "✓ 已达标 · 撤销" }).click();
  await expect(page.getByRole("button", { name: "标记达标" })).toBeVisible();
});

test("running the metronome times the selected exercise and records the tempo that was held", async ({ page }) => {
  test.setTimeout(90_000); // a minute of metronome time is stepped through tick by tick
  await open(page, td => { td.journal.practising = ["W1-EX5", "W1-EX6"].map(exercise => ({ book: "shuaishuai-7w-1", exercise })); });
  // From here time moves only when the test moves it, so the counts are exact.
  await page.clock.pauseAt(new Date(NOW.getTime() + 60_000));
  await page.getByRole("button", { name: "W1-EX5 1&2指全指板爬格子" }).click();
  await page.getByRole("button", { name: "起始 50" }).click();
  await expect(page.getByLabel("速度 BPM")).toHaveValue("50");
  await page.clock.runFor(3_000);
  expect(await times(page)).toEqual([]); // nothing counts while the metronome is stopped

  await play(page).click();
  await page.clock.runFor(25_000);
  await expect(page.getByLabel("本次计时")).toHaveText("0:25");
  await expect(page.getByLabel("今日计时")).toHaveText("0:25 / 10:00");
  await expect(page.getByLabel("今日最高速度")).toHaveText("—");
  await page.clock.runFor(10_000);
  await expect(page.getByLabel("今日最高速度")).toHaveText("50 BPM");

  // A faster tempo counts only once it has been held for thirty seconds.
  await page.getByRole("button", { name: "加 5" }).click();
  await page.clock.runFor(12_000);
  await stop(page).click();
  await expect(page.getByLabel("今日计时")).toHaveText("0:47 / 10:00");
  await expect(page.getByLabel("今日最高速度")).toHaveText("50 BPM");
  const written = await times(page);
  expect(written.every(a => a.book === BOOK && a.exercise === "W1-EX5" && a.date === "2026-11-18")).toBe(true);
  expect(written.reduce((n, a) => n + a.seconds, 0)).toBe(47);
  expect([...new Set(written.map(a => a.speed))].filter(Boolean)).toEqual([50]); // 55 was held for only 12 seconds

  // Switching exercise starts a new session; the first one keeps its time.
  await page.getByRole("button", { name: "下一条 →" }).click();
  await expect(page.getByRole("heading", { name: "1&3指全指板爬格子" })).toBeVisible();
  await expect(page.getByLabel("本次计时")).toHaveText("0:00");
  await play(page).click();
  await page.clock.runFor(5_000);
  await page.getByRole("button", { name: "自由练习" }).click();
  await page.clock.runFor(7_000);
  await stop(page).click();
  const after = (await times(page)).slice(written.length);
  expect(after.map(a => [a.exercise, a.seconds, a.speed])).toEqual([["W1-EX6", 5, null], ["_free", 7, null]]);
  await expect(page.getByRole("complementary", { name: "今日清单" }).getByRole("button", { name: "W1-EX5 1&2指全指板爬格子" })).toContainText("0:47 / 10:00");
  // A recorded result is a day's practice, so the day is checked in without a click.
  await expect(page.getByText("✓ 今日已打卡")).toBeVisible();
});

test("a day's speed and note can be corrected without touching the counted time", async ({ page }) => {
  await open(page, td => {
    td.journal.practising = [{ book: "shuaishuai-7w-1", exercise: "W1-EX5" }];
    td.journal.entries = [{ book: "shuaishuai-7w-1", exercise: "W1-EX5", date: "2026-11-18", seconds: 610, speed: 120, passed: false, note: "" }];
  });
  await page.getByRole("button", { name: "W1-EX5 1&2指全指板爬格子" }).click();
  await expect(page.getByLabel("今日计时")).toHaveText("10:10 / 10:00");
  await expect(page.getByText("今日 · 已练够")).toBeVisible();
  await expect(page.getByText("✓ 今日已打卡")).toBeVisible();
  await page.getByText("今日记录与备注").click();
  await page.getByLabel("速度", { exact: true }).fill("abc");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".fx-record [role=status]")).toContainText("1 到 400");
  await page.getByLabel("速度", { exact: true }).fill("80");
  await page.getByLabel("备注").fill("节拍器忘了调回来");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  expect((await calls(page, "set_journal_result"))[0].args).toEqual({ ...item("W1-EX5"), date: "2026-11-18", speed: 80, note: "节拍器忘了调回来" });
  await expect(page.getByLabel("今日最高速度")).toHaveText("80 BPM");
  await expect(page.getByLabel("今日计时")).toHaveText("10:10 / 10:00");
});

test("earlier days can be filled in, edited from the history and removed in the library", async ({ page }) => {
  await open(page, td => {
    td.journal.entries = [60, 70, 80].map((speed, i) => ({ book: "shuaishuai-7w-1", exercise: "W1-EX6", date: `2026-11-1${4 + i}`, speed, seconds: 605, passed: false, note: "" }));
  });
  await page.getByRole("tab", { name: "教材库" }).click();
  await page.getByRole("button", { name: "W1-EX6 1&3指全指板爬格子" }).click();
  await expect(page.getByRole("img", { name: "速度变化，从 60 到 80 BPM" })).toBeVisible();
  await page.getByRole("button", { name: "编辑 2026-11-15 的记录" }).click();
  await expect(page.getByLabel("速度", { exact: true })).toHaveValue("70");
  await expect(page.getByLabel("练习时长")).toHaveValue("10");
  // Changing only the speed keeps the exact seconds the clock counted.
  await page.getByLabel("速度", { exact: true }).fill("75");
  await page.getByRole("button", { name: "更新记录" }).click();
  expect((await calls(page, "save_journal_entry")).at(-1)?.args.entry).toEqual({ ...item("W1-EX6"), date: "2026-11-15", seconds: 605, speed: 75, passed: false, note: "" });
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确认删除？" }).click();
  expect((await calls(page, "delete_journal_entry"))[0].args).toEqual({ ...item("W1-EX6"), date: "2026-11-15" });

  await page.getByLabel("记录日期").fill("2026-11-13");
  await page.getByLabel("练习时长").fill("abc");
  await page.getByRole("button", { name: "保存记录" }).click();
  await expect(page.locator(".jr-form [role=status]")).toContainText("1 到 1440");
  await page.getByLabel("练习时长").fill("15");
  await page.getByLabel("速度", { exact: true }).fill("55");
  await page.getByRole("button", { name: "保存记录" }).click();
  expect((await calls(page, "save_journal_entry")).at(-1)?.args.entry).toEqual({ ...item("W1-EX6"), date: "2026-11-13", seconds: 900, speed: 55, passed: false, note: "" });
});

test("a bare check-in counts for the streak and can be undone", async ({ page }) => {
  await open(page, td => { td.journal.checkins = ["2026-11-16", "2026-11-17"]; });
  await expect(page.locator(".td-streak b")).toHaveText("2");
  await page.getByRole("button", { name: "今日打卡" }).click();
  expect((await calls(page, "set_journal_checkin"))[0].args).toEqual({ date: "2026-11-18", on: true });
  await expect(page.locator(".td-streak b")).toHaveText("3");
  await page.getByRole("button", { name: "✓ 今日已打卡" }).click();
  await expect(page.locator(".td-streak b")).toHaveText("2");
});

test("statistics summarise days, time and textbook progress", async ({ page }) => {
  await open(page, td => {
    const e = (exercise: string, date: string, speed: number | null, minutes: number, passed = false) => ({ book: exercise === "_free" ? "_free" : "shuaishuai-7w-1", exercise, date, speed, seconds: minutes * 60, passed, note: "" });
    td.journal.entries = [e("W1-EX1", "2026-11-10", 40, 5, true), e("W1-EX5", "2026-11-16", 60, 30), e("W1-EX5", "2026-11-17", 80, 45), e("W1-EX5", "2026-11-18", 100, 50, true), e("W1-EX6", "2026-11-18", 70, 15), e("_free", "2026-11-18", null, 5)];
    td.journal.checkins = ["2026-11-12"];
    td.journal.practising = ["W1-EX6", "W1-EX7", "W1-EX8"].map(exercise => ({ book: "shuaishuai-7w-1", exercise }));
  });
  await page.getByRole("button", { name: "W1-EX6 1&3指全指板爬格子" }).click();
  await page.screenshot({ path: test.info().outputPath("practice.png") });
  await page.getByRole("button", { name: "收起清单" }).click();
  await expect(page.getByRole("button", { name: "展开清单" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("practice-collapsed.png") });

  await page.getByRole("tab", { name: "统计" }).click();
  const tiles = page.locator(".st-tiles");
  await expect(tiles).toContainText("3连续打卡");
  await expect(tiles).toContainText("5累计打卡");
  await expect(tiles).toContainText("2.5累计时长（小时）");
  await expect(tiles).toContainText("2/66已达标");
  await expect(page.getByRole("img", { name: "第一周：2 条达标，3 条已开始，共 9 条" })).toBeVisible();
  await expect(page.locator('.st-heat i[data-today="true"]')).toHaveAttribute("data-level", "3");
  await expect(page.locator(".st-recent li")).toHaveCount(5);
  await page.screenshot({ path: test.info().outputPath("stats.png") });
  await page.getByRole("tab", { name: "教材库" }).click();
  await page.screenshot({ path: test.info().outputPath("library.png") });
  await page.getByRole("tab", { name: "节拍器与预设" }).click();
  await page.screenshot({ path: test.info().outputPath("metronome.png") });
});

test("the practice page and library stay usable at the minimum window size", async ({ page }) => {
  await open(page, td => { td.journal.practising = [{ book: "shuaishuai-7w-1", exercise: "W1-EX5" }]; });
  await page.setViewportSize({ width: 640, height: 540 });
  await page.getByRole("button", { name: "W1-EX5 1&2指全指板爬格子" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(play(page)).toBeInViewport();
  await page.getByRole("button", { name: "标记达标" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "标记达标" })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath("narrow.png") });
  await page.getByRole("tab", { name: "教材库" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "保存记录" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "保存记录" })).toBeInViewport();
});
