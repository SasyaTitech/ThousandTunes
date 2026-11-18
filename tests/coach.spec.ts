import { test, expect } from "@playwright/test";
import { installTauriMock, calls } from "./harness";

test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
  await page.setViewportSize({ width: 1120, height: 900 });
  await page.goto("/?view=main");
  await page.getByRole("tab", { name: "跟拍练习", exact: true }).click();
});

test("input must be explicitly chosen and the requested mono channel and grid reach the backend", async ({ page }) => {
  await expect(page.getByRole("button", { name: "开始跟拍", exact: true })).toBeDisabled();
  expect(await calls(page, "coach_start")).toHaveLength(0);
  await page.getByLabel("吉他输入设备").selectOption("gt-dry");
  await page.getByLabel("输入通道", { exact: true }).selectOption("1");
  await page.getByLabel("目标节奏", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "开始跟拍", exact: true }).click();
  expect((await calls(page, "coach_start"))[0].args).toEqual({ config: { input_id: "gt-dry", channel: 1, notes_per_beat: 2, gate_db: -45, length: 32, review_length: 32 }, mode: "practice" });
  await expect(page.getByLabel("吉他输入设备")).toBeDisabled();
  await page.getByRole("button", { name: "结束本轮" }).click();
  await expect(page.getByLabel("吉他输入设备")).toBeEnabled();
});

test("input check does not start the metronome and remains controllable after changing tabs", async ({ page }) => {
  await page.getByLabel("吉他输入设备").selectOption("gt-dry");
  await page.getByRole("button", { name: "检查输入", exact: true }).click();
  expect((await calls(page, "coach_start"))[0].args.mode).toBe("monitor");
  expect(await calls(page, "toggle_play")).toHaveLength(0);
  await page.getByRole("tab", { name: "节拍器与预设" }).click();
  await page.getByRole("tab", { name: "跟拍练习", exact: true }).click();
  await expect(page.getByRole("button", { name: "结束检查" })).toBeVisible();
  await page.getByRole("button", { name: "结束检查" }).click();
  await expect(page.getByRole("status")).toContainText("输入已释放");
});

test("calibration requires a deliberate loopback setup and never uses a playing average", async ({ page }) => {
  await page.getByLabel("吉他输入设备").selectOption("gt-dry");
  await page.getByRole("button", { name: "延迟校准", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始回送校准" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "我已接好同一信号路径的回送，并关闭输入监听" }).check();
  await page.getByRole("button", { name: "开始回送校准" }).click();
  expect((await calls(page, "coach_start"))[0].args.mode).toBe("calibrate");
});

test("early late and uncertain results show their limits and survive session completion", async ({ page }) => {
  await page.evaluate(() => {
    const td = (window as any).__TD;
    td.coach.status = { ...td.coach.status, mode: "practice", active: false, message: "本轮完成", start_ms: 9000,
      summary: { played: 2, on_time: 0, missed: 1, extra: 0, uncertain: 1, mean_ms: 10, spread_ms: 50 },
      results: [{ index: 0, target_ms: 9000, delta_ms: -40, kind: "early" }, { index: 1, target_ms: 9500, delta_ms: 60, kind: "late" }, { index: 2, target_ms: 10000, delta_ms: null, kind: "uncertain" }] };
    td.emit("coach", td.coach.status);
  });
  await expect(page.locator(".rc-feedback strong")).toHaveText("信号不清晰");
  await expect(page.locator(".rc-feedback")).toContainText("此次不计入早晚统计");
  await expect(page.getByRole("heading", { name: "02 最近 32 音回顾" })).toBeVisible();
  await expect(page.locator(".rc-stat-grid")).toContainText("整体早晚（参考）");
  await expect(page.locator(".rc-dot-early")).toHaveCount(1);
  await expect(page.locator(".rc-dot-late")).toHaveCount(1);
});

test("an unavailable input error is visible and permits retry", async ({ page }) => {
  await page.getByLabel("吉他输入设备").selectOption("gt-dry");
  await page.evaluate(() => { (window as any).__TD.failCommand = "coach_start"; });
  await page.getByRole("button", { name: "开始跟拍", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始跟拍", exact: true })).toBeEnabled();
});

test("coach fits the minimum window width", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "开始跟拍", exact: true })).toBeVisible();
});

test("continuous practice keeps drawing beyond 128 notes and stops only on request", async ({ page }) => {
  await page.getByLabel("吉他输入设备").selectOption("gt-dry");
  await page.getByLabel("一轮长度", { exact: true }).selectOption("0");
  await page.getByRole("button", { name: "开始跟拍", exact: true }).click();
  expect((await calls(page, "coach_start"))[0].args.config.length).toBe(0);
  await page.evaluate(() => {
    const td = (window as any).__TD;
    td.coach.status.clock_ms = 90000;
    td.coach.status.results = [{ index: 155, target_ms: 89500, delta_ms: 10, kind: "good" }];
    td.emit("coach", structuredClone(td.coach.status));
  });
  await expect(page.locator(".rc-topline")).toContainText("无限练习");
  await expect(page.locator(".rc-track-top")).toContainText("∞");
  await expect(page.locator(".rc-note").first()).toBeVisible();
  expect(await calls(page, "coach_stop")).toHaveLength(0);
  await page.getByRole("button", { name: "结束练习", exact: true }).click();
  await expect(page.getByRole("button", { name: "再次开始" })).toBeVisible();
  await expect(page.locator(".rc-stat-grid")).toContainText("+10");
});

test("review range changes live without restarting and drops older bias, misses and extras", async ({ page }) => {
  await page.getByLabel("吉他输入设备").selectOption("gt-dry");
  await page.getByLabel("一轮长度", { exact: true }).selectOption("0");
  await page.getByRole("button", { name: "开始跟拍", exact: true }).click();
  await page.evaluate(() => {
    const td = (window as any).__TD;
    td.coach.status.results = Array.from({ length: 32 }, (_, index) => ({ index, target_ms: 12000 + index * 500, delta_ms: index === 0 ? null : index < 16 ? 80 : 10, kind: index === 0 ? "miss" : index < 16 ? "late" : "good" }));
    td.coach.status.recent_extras = [{ index: 0, count: 8 }, { index: 30, count: 1 }];
    td.emit("coach", structuredClone(td.coach.status));
  });
  await expect(page.locator(".rc-counts")).toContainText("额外拨弦 9");
  await page.getByLabel("回顾范围", { exact: true }).selectOption("16");
  await expect(page.getByRole("heading", { name: "02 最近 16 音回顾" })).toBeVisible();
  await expect(page.locator(".rc-stat-grid strong").first()).toHaveText("+10 ms");
  await expect(page.locator(".rc-counts")).toContainText("未检测到 0");
  await expect(page.locator(".rc-counts")).toContainText("额外拨弦 1");
  await expect(page.locator(".rc-history circle")).toHaveCount(16);
  expect(await calls(page, "coach_start")).toHaveLength(1);
  expect(await calls(page, "coach_stop")).toHaveLength(0);
  await page.getByRole("button", { name: "结束练习", exact: true }).click();
  await page.getByLabel("回顾范围", { exact: true }).selectOption("32");
  await expect(page.locator(".rc-counts")).toContainText("未检测到 1");
  await expect(page.locator(".rc-counts")).toContainText("额外拨弦 9");
  expect((await calls(page, "coach_set_review_length")).map(c => c.args.length)).toEqual([16, 32]);
});

test("calibration stays finite even when the practice length is unlimited", async ({ page }) => {
  await page.getByLabel("吉他输入设备").selectOption("gt-dry");
  await page.getByLabel("一轮长度", { exact: true }).selectOption("0");
  await page.getByRole("button", { name: "延迟校准", exact: true }).click();
  await page.getByRole("checkbox", { name: "我已接好同一信号路径的回送，并关闭输入监听" }).check();
  await page.getByRole("button", { name: "开始回送校准" }).click();
  await expect(page.locator(".rc-topline")).toContainText("90 BPM · 回送测试 · 16 拍");
  await expect(page.getByRole("button", { name: "结束校准", exact: true })).toBeEnabled();
});
