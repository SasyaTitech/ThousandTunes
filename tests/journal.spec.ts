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
  // The window opens on the home page; most of these tests are about practising.
  await expect(page.getByRole("region", { name: "主页" })).toBeVisible();
  await page.getByRole("tab", { name: "练习", exact: true }).click();
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

test("running the metronome times the selected exercise, and the speed is only what the player records", async ({ page }) => {
  test.setTimeout(90_000); // a minute of metronome time is stepped through tick by tick
  await open(page, td => { td.journal.practising = ["W1-EX5", "W1-EX6"].map(exercise => ({ book: "shuaishuai-7w-1", exercise })); });
  // From here time moves only when the test moves it, so the counts are exact.
  await page.clock.pauseAt(new Date(NOW.getTime() + 60_000));
  await page.getByRole("button", { name: "W1-EX5 1&2指全指板爬格子" }).click();
  await page.getByRole("button", { name: "目标 100" }).click();
  await expect(page.getByLabel("速度 BPM")).toHaveValue("100");
  await page.clock.runFor(3_000);
  expect(await times(page)).toEqual([]); // nothing counts while the metronome is stopped

  await play(page).click();
  await page.clock.runFor(40_000);
  await expect(page.getByLabel("本次计时")).toHaveText("0:40");
  await expect(page.getByLabel("今日计时")).toHaveText("0:40 / 10:00");
  // Forty seconds of struggling at 100 is not a result until the player says so.
  await expect(page.getByLabel("今日成绩")).toHaveText("—");
  await page.getByRole("button", { name: "减 5" }).click();
  await page.getByRole("button", { name: "减 5" }).click();
  await page.clock.runFor(7_000);
  await stop(page).click();
  await expect(page.getByLabel("今日计时")).toHaveText("0:47 / 10:00");
  await expect(page.getByLabel("今日成绩")).toHaveText("—");
  const written = await times(page);
  expect(written.every(a => a.book === BOOK && a.exercise === "W1-EX5" && a.date === "2026-11-18" && a.speed === null)).toBe(true);
  expect(written.reduce((n, a) => n + a.seconds, 0)).toBe(47);

  await page.getByRole("button", { name: "记下当前速度 90" }).click();
  expect((await calls(page, "set_journal_result")).at(-1)?.args).toEqual({ ...item("W1-EX5"), date: "2026-11-18", speed: 90, note: "" });
  await expect(page.getByLabel("今日成绩")).toHaveText("90 BPM");
  await expect(page.getByRole("button", { name: "已记下当前速度" })).toBeDisabled();
  // Recording again replaces the result, down as well as up.
  await page.getByRole("button", { name: "减 5" }).click();
  await page.getByRole("button", { name: "记下当前速度 85" }).click();
  await expect(page.getByLabel("今日成绩")).toHaveText("85 BPM");
  await expect(page.getByLabel("今日计时")).toHaveText("0:47 / 10:00");

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
  await expect(page.getByText("今日累计 · 已练够")).toBeVisible();
  await expect(page.getByText("✓ 今日已打卡")).toBeVisible();
  await page.getByText("今日记录与备注").click();
  await page.getByLabel("速度", { exact: true }).fill("abc");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".fx-record [role=status]")).toContainText("1 到 400");
  await page.getByLabel("速度", { exact: true }).fill("80");
  await page.getByLabel("备注").fill("节拍器忘了调回来");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  expect((await calls(page, "set_journal_result"))[0].args).toEqual({ ...item("W1-EX5"), date: "2026-11-18", speed: 80, note: "节拍器忘了调回来" });
  await expect(page.getByLabel("今日成绩")).toHaveText("80 BPM");
  await expect(page.getByLabel("今日计时")).toHaveText("10:10 / 10:00");
});

test("earlier days can be filled in, edited from the history and removed in the library", async ({ page }) => {
  await open(page, td => {
    td.journal.entries = [60, 70, 80].map((speed, i) => ({ book: "shuaishuai-7w-1", exercise: "W1-EX6", date: `2026-11-1${4 + i}`, speed, seconds: 605, passed: false, note: "" }));
  });
  await page.getByRole("tab", { name: "教材" }).click();
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

  await page.getByRole("tab", { name: "主页" }).click();
  const tiles = page.locator(".st-tiles");
  await expect(tiles).toContainText("3连续打卡");
  await expect(tiles).toContainText("5累计打卡");
  await expect(tiles).toContainText("2.5累计时长（小时）");
  await expect(tiles).toContainText("2/66已达标");
  await expect(page.getByRole("img", { name: "第一周：2 条达标，3 条已开始，共 9 条" })).toBeVisible();
  await expect(page.locator('.st-heat i[data-today="true"]')).toHaveAttribute("data-level", "3");
  await expect(page.locator(".st-recent li")).toHaveCount(5);
  await page.screenshot({ path: test.info().outputPath("stats.png") });
  await page.getByRole("tab", { name: "教材" }).click();
  await page.screenshot({ path: test.info().outputPath("library.png") });
  await page.getByRole("tab", { name: "节拍器" }).click();
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
  await page.getByRole("tab", { name: "教材" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "保存记录" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "保存记录" })).toBeInViewport();
});

test("an exercise can be taken off the list from the list itself", async ({ page }) => {
  await open(page, td => {
    td.journal.practising = ["W1-EX5", "W1-EX6", "W1-EX7"].map(exercise => ({ book: "shuaishuai-7w-1", exercise }));
    td.journal.entries = [["W1-EX5", 180, 80], ["W1-EX6", 60, null]].map(([exercise, seconds, speed]) => ({ book: "shuaishuai-7w-1", exercise, date: "2026-11-18", seconds, speed, passed: false, note: "" }));
  });
  const rail = page.getByRole("complementary", { name: "今日清单" });
  await rail.getByRole("button", { name: "W1-EX6 1&3指全指板爬格子" }).click();

  // The × can be seen without pointing at the row.
  await expect(rail.getByRole("button", { name: "移出 W1-EX7" })).toHaveCSS("opacity", "0.55");
  await rail.getByRole("button", { name: "移出 W1-EX7" }).click();
  // Nothing happens until it is confirmed, and it can be called off.
  const ask = rail.getByRole("group", { name: "确认移出 W1-EX7" });
  await expect(ask).toContainText("以前的记录都会保留");
  await ask.getByRole("button", { name: "取消" }).click();
  await expect(rail.getByRole("listitem")).toHaveCount(3);
  expect(await calls(page, "set_journal_practising")).toEqual([]);
  await rail.getByRole("listitem").nth(2).hover();
  await rail.getByRole("button", { name: "移出 W1-EX7" }).click();
  await ask.getByRole("button", { name: "移出", exact: true }).click();
  expect((await calls(page, "set_journal_practising")).at(-1)?.args).toEqual({ book: BOOK, exercises: ["W1-EX7"], on: false });
  await expect(rail.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "1&3指全指板爬格子" })).toBeVisible();

  // Dropping the one being played moves on to its neighbour, then to free practice.
  await rail.getByRole("button", { name: "移出 W1-EX6" }).click();
  await rail.getByRole("button", { name: "只移出，保留今日记录" }).click();
  await expect(page.getByRole("heading", { name: "1&2指全指板爬格子" })).toBeVisible();
  expect(await calls(page, "delete_journal_entry")).toEqual([]);
  expect(await page.evaluate(() => (window as any).__TD.journal.entries.length)).toBe(2);
  await expect(rail.getByRole("listitem")).toHaveCount(1);
  await rail.getByRole("button", { name: "移出 W1-EX5" }).click();
  await expect(rail.getByRole("group", { name: "确认移出 W1-EX5" })).toContainText("今天已有记录：练了 3:00，成绩 80");
  await rail.getByRole("button", { name: "移出并清除今日记录" }).click();
  await expect(page.getByRole("heading", { name: "自由练习" })).toBeVisible();
  expect((await calls(page, "delete_journal_entry")).map(c => c.args)).toEqual([{ book: BOOK, exercise: "W1-EX5", date: "2026-11-18" }]);
  // Only today's record of that exercise went.
  expect(await page.evaluate(() => (window as any).__TD.journal.entries.map((e: any) => e.exercise + " " + e.date))).toEqual(["W1-EX6 2026-11-18"]);
  await expect(page.getByText("清单是空的")).toBeVisible();
});

test("the window opens on the home page, which starts practice in one click", async ({ page }) => {
  await installTauriMock(page);
  await page.clock.install({ time: NOW });
  await page.addInitScript(() => {
    const td = (window as any).__TD;
    td.journal.practising = ["W1-EX5", "W1-EX6"].map(exercise => ({ book: "shuaishuai-7w-1", exercise }));
    td.journal.entries = [{ book: "shuaishuai-7w-1", exercise: "W1-EX5", date: "2026-11-18", seconds: 720, speed: 80, passed: false, note: "" }];
  });
  await page.setViewportSize({ width: 1120, height: 780 });
  await page.goto("/?view=main");
  const home = page.getByRole("region", { name: "主页" });
  await expect(page.getByRole("tab", { name: "主页" })).toHaveAttribute("aria-selected", "true");
  await expect(home.getByRole("heading", { name: "今天已练 12 分钟" })).toBeVisible();
  await expect(home.getByRole("img", { name: /最近 26 周共打卡 1 天/ })).toBeVisible();
  await expect(home.getByRole("button", { name: "去练 W1-EX5 1&2指全指板爬格子" })).toContainText("✓ 12:00 / 10:00");

  await home.getByRole("button", { name: "去练 W1-EX6 1&3指全指板爬格子" }).click();
  await expect(page.getByRole("region", { name: "当前练习" }).getByRole("heading", { name: "1&3指全指板爬格子" })).toBeVisible();
  await page.getByRole("tab", { name: "主页" }).click();
  await home.getByRole("button", { name: "开始练习 →" }).click();
  await expect(page.getByRole("region", { name: "当前练习" })).toBeVisible();
});

test("a colour scheme is chosen from the header and kept for next time", async ({ page }) => {
  await installTauriMock(page);
  await page.setViewportSize({ width: 1120, height: 780 });
  await page.goto("/?view=main");
  await expect(page.locator("html")).toHaveAttribute("data-skin", "mo");
  await page.getByText("配色", { exact: true }).click();
  await expect(page.getByRole("radio")).toHaveCount(8);
  // The whole menu is on screen and in front: nothing clips it or lies over it.
  const covered = () => page.getByRole("radio").evaluateAll(els => els.filter(el => {
    const r = el.getBoundingClientRect(), inside = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    return !inside || ![[r.left + 3, r.top + 3], [r.right - 3, r.bottom - 3]].every(([x, y]) => el.contains(document.elementFromPoint(x, y)));
  }).map(el => el.textContent));
  expect(await covered()).toEqual([]);
  await page.setViewportSize({ width: 640, height: 540 });
  expect(await covered()).toEqual([]);
  await page.setViewportSize({ width: 1120, height: 780 });
  await page.getByRole("radio", { name: "黛" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-skin", "dai");
  await expect(page.getByRole("radiogroup", { name: "主题配色" })).toBeHidden();
  const accent = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--takt-from").trim());
  expect(await accent()).toBe("#5f86a3");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-skin", "dai");
  expect(await accent()).toBe("#5f86a3");
});

test("volume is set from a panel at the foot of the spine, which puts itself away", async ({ page }) => {
  await installTauriMock(page);
  await page.setViewportSize({ width: 1120, height: 780 });
  await page.goto("/?view=main");
  const slider = page.getByRole("slider", { name: "音量" });
  await expect(slider).toHaveCount(0);
  await page.getByText("音量", { exact: true }).click();
  await expect(slider).toHaveValue("75");
  // The slider is on screen and in front, at the normal and the minimum window size.
  const covered = () => slider.evaluate(el => {
    const r = el.getBoundingClientRect(), inside = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    return !inside || ![[r.left + 3, r.top + 3], [r.right - 3, r.bottom - 3]].every(([x, y]) => el.contains(document.elementFromPoint(x, y)));
  });
  expect(await covered()).toBe(false);
  await page.setViewportSize({ width: 640, height: 540 });
  expect(await covered()).toBe(false);
  await page.setViewportSize({ width: 1120, height: 780 });

  await slider.fill("40");
  await slider.press("ArrowLeft");
  await expect(page.getByText("39%")).toBeVisible();
  expect((await calls(page, "set_main_controls")).at(-1)?.args).toEqual({ controls: { volume: 39 } });

  // A click elsewhere, Escape, or opening the other panel puts it away.
  await page.getByRole("region", { name: "主页" }).getByRole("heading", { level: 2 }).click();
  await expect(slider).toHaveCount(0);
  await page.getByText("音量", { exact: true }).click();
  await expect(slider).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(slider).toHaveCount(0);
  await page.getByText("音量", { exact: true }).click();
  await page.getByText("配色", { exact: true }).click();
  await expect(slider).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(8);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("radio")).toHaveCount(0);

  // The metronome page's own slider shows the same setting.
  await page.getByRole("tab", { name: "节拍器" }).click();
  await expect(slider).toHaveValue("39");
});

test("a preset can be switched to without leaving the practice page", async ({ page }) => {
  await open(page, td => {
    td.journal.practising = [{ book: "shuaishuai-7w-1", exercise: "W1-EX5" }];
    td.practice.presets = [
      { id: 1, name: "慢练音阶", bpm: 60, beats_per_bar: 4, beat_unit: 4, subdivision: 1, accent_first: true },
      { id: 2, name: "三连音扫弦", bpm: 92, beats_per_bar: 3, beat_unit: 4, subdivision: 3, accent_first: true },
    ];
  });
  const main = page.getByRole("region", { name: "当前练习" });
  const opener = main.getByText("预设", { exact: true });
  const list = main.getByRole("group", { name: "切换预设" });
  await expect(list).toHaveCount(0);
  await opener.click();
  // Every entry is on screen and in front, at the normal and the minimum window size.
  const covered = () => list.getByRole("button").evaluateAll(els => els.filter(el => {
    const r = el.getBoundingClientRect(), inside = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    return !inside || ![[r.left + 3, r.top + 3], [r.right - 3, r.bottom - 3]].every(([x, y]) => el.contains(document.elementFromPoint(x, y)));
  }).map(el => el.textContent));
  expect(await covered()).toEqual([]);
  await page.setViewportSize({ width: 640, height: 540 });
  await opener.scrollIntoViewIfNeeded();
  expect(await covered()).toEqual([]);
  await page.setViewportSize({ width: 1120, height: 780 });

  await list.getByRole("button", { name: "使用 三连音扫弦" }).click();
  expect((await calls(page, "apply_practice_preset")).map(c => c.args)).toEqual([{ id: 2 }]);
  await expect(main.getByRole("spinbutton", { name: "速度 BPM" })).toHaveValue("92");
  await expect(main.getByText("3/4 · 每拍 3 下（三连音）")).toBeVisible();
  // The list puts itself away and the line names what is in use.
  await expect(list).toHaveCount(0);
  await expect(main.locator(".td-recall summary")).toHaveText("预设三连音扫弦");
  // Moving the tempo by hand leaves the preset: nothing is named any more.
  await main.getByRole("button", { name: "加 1" }).click();
  await expect(main.locator(".td-recall summary")).toHaveText("预设");
  await opener.click();
  await expect(list.getByRole("button", { name: "使用 三连音扫弦" })).toHaveAttribute("aria-pressed", "false");
  // Making and editing presets stays on the metronome page, one press away.
  await list.getByRole("button", { name: "管理预设 →" }).click();
  await expect(page.getByRole("tab", { name: "节拍器" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "使用 慢练音阶" })).toBeVisible();
});

test("the home page's list takes an exercise off as well, after asking", async ({ page }) => {
  await installTauriMock(page);
  await page.clock.install({ time: NOW });
  await page.addInitScript(() => {
    const td = (window as any).__TD;
    td.journal.practising = ["W1-EX5", "W1-EX6"].map(exercise => ({ book: "shuaishuai-7w-1", exercise }));
    td.journal.entries = [{ book: "shuaishuai-7w-1", exercise: "W1-EX5", date: "2026-11-18", seconds: 720, speed: 80, passed: false, note: "" }];
    // W1-EX5 is the one last practised, so it is the one the clock would time.
    localStorage.setItem("td-current", JSON.stringify({ book: "shuaishuai-7w-1", exercise: "W1-EX5" }));
  });
  await page.setViewportSize({ width: 1120, height: 780 });
  await page.goto("/?view=main");
  const list = page.getByRole("region", { name: "主页" }).getByRole("region", { name: "今日清单" });
  // The × can be seen without pointing at the row.
  await expect(list.getByRole("button", { name: "移出 W1-EX6" })).toHaveCSS("opacity", "0.55");
  await expect(list.getByRole("button", { name: "去练 W1-EX6 1&3指全指板爬格子" })).toContainText("1&3指全指板爬格子");

  await list.getByRole("button", { name: "移出 W1-EX6" }).click();
  const ask = list.getByRole("group", { name: "确认移出 W1-EX6" });
  await expect(ask).toContainText("以前的记录都会保留");
  await ask.getByRole("button", { name: "取消" }).click();
  expect(await calls(page, "set_journal_practising")).toEqual([]);
  await list.getByRole("button", { name: "移出 W1-EX6" }).click();
  await ask.getByRole("button", { name: "移出", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  expect((await calls(page, "set_journal_practising")).at(-1)?.args).toEqual({ book: BOOK, exercises: ["W1-EX6"], on: false });

  await list.getByRole("button", { name: "移出 W1-EX5" }).click();
  await expect(list.getByRole("group", { name: "确认移出 W1-EX5" })).toContainText("今天已有记录：练了 12:00，成绩 80");
  await list.getByRole("button", { name: "移出并清除今日记录" }).click();
  await expect(list.getByText("还没有挑出正在练的项目")).toBeVisible();
  expect((await calls(page, "delete_journal_entry")).map(c => c.args)).toEqual([{ book: BOOK, exercise: "W1-EX5", date: "2026-11-18" }]);
  // It was the one being timed, so the practice page is left on free practice rather than on it.
  await page.getByRole("tab", { name: "练习", exact: true }).click();
  await expect(page.getByRole("region", { name: "当前练习" }).getByRole("heading", { name: "自由练习" })).toBeVisible();
  await expect(page.getByText("清单是空的")).toBeVisible();
});

test("this run starts again at each press of start while the day's total adds up", async ({ page }) => {
  await open(page, td => { td.journal.practising = [{ book: "shuaishuai-7w-1", exercise: "W1-EX5" }]; });
  await page.clock.pauseAt(new Date(NOW.getTime() + 60_000));
  await page.getByRole("button", { name: "W1-EX5 1&2指全指板爬格子" }).click();
  await play(page).click();
  await page.clock.runFor(40_000);
  await stop(page).click();
  await expect(page.getByLabel("本次计时")).toHaveText("0:40");
  await page.clock.runFor(5_000);
  await play(page).click();
  await page.clock.runFor(7_000);
  await expect(page.getByLabel("本次计时")).toHaveText("0:07");
  await expect(page.getByLabel("今日计时")).toHaveText("0:47 / 10:00");
});

test("today's practice becomes a picture that can be copied or saved", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await installTauriMock(page);
  await page.clock.install({ time: NOW });
  await page.addInitScript(() => {
    const td = (window as any).__TD;
    const e = (book: string, exercise: string, date: string, seconds: number, speed: number | null, passed = false) => ({ book, exercise, date, seconds, speed, passed, note: "" });
    td.journal.entries = [e("shuaishuai-7w-1", "W1-EX5", "2026-11-18", 1800, 80), e("shuaishuai-7w-1", "W1-EX6", "2026-11-18", 600, 70, true), e("_free", "_free", "2026-11-18", 300, null), e("shuaishuai-7w-1", "W1-EX5", "2026-11-17", 1200, 75)];
  });
  await page.setViewportSize({ width: 1120, height: 780 });
  await page.goto("/?view=main");
  await page.getByRole("button", { name: "分享今天" }).click();
  const dialog = page.getByRole("dialog", { name: "分享今日练习" });
  const card = dialog.getByRole("img", { name: "2026-11-18 的练习分享图" });
  await expect(card).toBeVisible();
  const size = () => card.evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
  expect(await size()).toEqual([1080, 1440]);
  // The card is really drawn: it wears the page colour and has many others on it.
  const colours = await card.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data, seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 97) seen.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]);
    return seen.size;
  });
  expect(colours).toBeGreaterThan(50);
  await page.screenshot({ path: test.info().outputPath("share.png") });

  await dialog.getByRole("radio", { name: "方形 1:1" }).click();
  expect(await size()).toEqual([1080, 1080]);
  await page.screenshot({ path: test.info().outputPath("share-square.png") });
  await dialog.getByRole("button", { name: "保存为图片文件" }).click();
  await expect(dialog.getByRole("status")).toContainText("千曲 2026-11-18 方形.png");
  const sent = (await calls(page, "save_share_image"))[0].args;
  expect([sent.date, sent.shape, sent.data.slice(0, 8)]).toEqual(["2026-11-18", "square", [137, 80, 78, 71, 13, 10, 26, 10]]);
  await dialog.getByRole("button", { name: "打开所在文件夹" }).click();
  expect(await calls(page, "open_share_folder")).toHaveLength(1);

  await dialog.getByRole("button", { name: "复制图片" }).click();
  await expect(dialog.getByRole("status")).toContainText("已复制");
  expect(await page.evaluate(async () => (await navigator.clipboard.read())[0].types)).toContain("image/png");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the name and its verse greet the player, then stay on the home page", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/?view=main");
  const card = page.locator(".td-splash");
  await expect(card).toHaveText(/^千曲操千曲而后晓声，观千剑而后识器。刘勰《文心雕龙·知音》THOUSAND TUNES · 1\.0\.0-practice\.\d+$/);
  // It is decoration: it cannot be clicked or read out, and it goes away by itself.
  expect(await card.evaluate(el => [getComputedStyle(el).pointerEvents, el.getAttribute("aria-hidden")])).toEqual(["none", "true"]);
  await page.getByRole("tab", { name: "教材" }).click();
  await page.getByRole("tab", { name: "主页" }).click();
  await expect(card).toBeHidden();
  await expect(page.getByRole("region", { name: "主页" }).locator(".st-verse")).toHaveText("操千曲而后晓声，观千剑而后识器。");
  await expect(page.locator(".td-brand").getByRole("img", { name: "千曲" })).toBeVisible();
});

test("the header dates the day in characters", async ({ page }) => {
  await open(page);
  await expect(page.locator(".td-date")).toHaveText("十一月十八日 · 周三");
});
