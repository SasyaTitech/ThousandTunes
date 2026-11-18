import { test, expect } from "@playwright/test";
import { installTauriMock, calls, setTransport, beat } from "./harness";

test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
  await page.setViewportSize({ width: 1120, height: 780 });
  await page.goto("/?view=main");
  await page.getByRole("tab", { name: "节拍器" }).click();
  await expect(page.getByLabel("速度 BPM")).toBeEnabled();
});

const start = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "开始", exact: true });
const stop = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "停止", exact: true });

test("main controls play and change the rhythm without saving a preset", async ({ page }) => {
  await page.getByLabel("速度 BPM").fill("95");
  await page.getByLabel("速度 BPM").press("Enter");
  await expect.poll(async () => (await calls(page, "set_main_controls")).at(-1)?.args.controls).toEqual({ bpm: 95 });
  await page.getByLabel("拍号", { exact: true }).selectOption("7/8");
  await page.getByLabel("细分", { exact: true }).selectOption("3");
  await page.getByRole("region", { name: "节拍设置" }).getByLabel("第一拍加重音").uncheck();
  await page.getByRole("button", { name: "加 5" }).click();
  await start(page).click();
  await expect(stop(page)).toBeVisible();
  await stop(page).click();
  await expect(start(page)).toBeVisible();
  expect(await calls(page, "save_practice_preset")).toHaveLength(0);
  expect((await calls(page, "set_main_controls")).map(c => c.args.controls)).toEqual([
    { bpm: 95 }, { meter: [7, 8] }, { subdivision: 3 }, { accent_first: false }, { bpm: 100 },
  ]);
});

test("the transport stays in reach on every page and the space bar toggles it", async ({ page }) => {
  for (const name of ["主页", "练习", "教材", "跟拍", "节拍器"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(start(page)).toBeInViewport();
    await expect(page.getByLabel("速度 BPM")).toBeInViewport();
  }
  await page.locator(".td-page").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Space");
  await expect(stop(page)).toBeVisible();
  // Typing a space into a field must not stop the click.
  await page.getByRole("button", { name: "＋ 存为预设" }).click();
  await page.getByLabel("预设名称").pressSequentially("Slow scales");
  await expect(stop(page)).toBeVisible();
  expect(await calls(page, "toggle_play")).toHaveLength(1);
});

test("presets are saved from the current settings, recalled, edited and removed", async ({ page }) => {
  await page.getByLabel("输出设备").selectOption("GT-1000CORE");
  await page.getByLabel("速度 BPM").fill("133");
  await page.getByLabel("速度 BPM").press("Enter");
  await page.getByLabel("拍号", { exact: true }).selectOption("3/4");
  await page.getByRole("button", { name: "＋ 存为预设" }).click();
  await expect(page.getByLabel("预设速度")).toHaveValue("133");
  await expect(page.getByLabel("预设拍号")).toHaveValue("3/4");
  await page.getByLabel("预设名称").fill("三连音练习");
  await page.getByLabel("预设细分").selectOption("3");
  await page.getByRole("button", { name: "保存预设" }).click();
  expect((await calls(page, "save_practice_preset"))[0].args.preset).toEqual({ id: 0, name: "三连音练习", bpm: 133, beats_per_bar: 3, beat_unit: 4, subdivision: 3, accent_first: true });

  await page.getByLabel("速度 BPM").fill("60");
  await page.getByLabel("速度 BPM").press("Enter");
  await page.getByRole("button", { name: "使用 三连音练习" }).click();
  await expect(page.getByLabel("速度 BPM")).toHaveValue("133");
  await expect(page.getByLabel("细分", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("输出设备")).toHaveValue("GT-1000CORE");

  await page.getByRole("button", { name: "编辑 三连音练习" }).click();
  await page.getByLabel("预设速度").fill("140");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("button", { name: "使用 三连音练习" })).toContainText("140");
  await page.getByRole("button", { name: "删除 三连音练习" }).click();
  await expect(page.locator(".ps-list li")).toHaveCount(1);
  await page.getByRole("button", { name: "删除 三连音练习" }).click();
  await expect(page.locator(".ps-list li")).toHaveCount(0);
});

test("shortcuts require an explicit opt in and failed saves keep the draft", async ({ page }) => {
  const enabled = page.getByLabel("在其他程序里也能用快捷键");
  await expect(enabled).not.toBeChecked();
  await page.getByLabel("快捷键组合").selectOption("shift");
  await expect(page.getByText("Ctrl + Alt + Shift + Space", { exact: true })).toBeVisible();
  await enabled.check();
  expect((await calls(page, "set_practice_shortcuts")).at(-1)?.args).toEqual({ enabled: true, extraShift: true });
  await page.evaluate(() => { (window as any).__TD.failCommand = "save_practice_preset"; });
  await page.getByRole("button", { name: "＋ 存为预设" }).click();
  await page.getByLabel("预设名称").fill("保留我的草稿");
  await page.getByRole("button", { name: "保存预设" }).click();
  await expect(page.getByRole("alert")).toContainText("could not be completed");
  await expect(page.getByLabel("预设名称")).toHaveValue("保留我的草稿");
});

test("typing a tempo then pressing start works with one click", async ({ page }) => {
  await page.getByLabel("速度 BPM").fill("96");
  await start(page).click();
  await expect(stop(page)).toBeVisible();
  await expect(page.getByLabel("速度 BPM")).toHaveValue("96");
});

test("invalid tempo and persistence errors are visible without changing the engine", async ({ page }) => {
  await page.getByLabel("速度 BPM").fill("999");
  await page.getByLabel("速度 BPM").press("Enter");
  await expect(page.getByRole("alert")).toContainText("30 到 300");
  expect(await calls(page, "set_main_controls")).toHaveLength(0);
  await page.evaluate(() => { (window as any).__TD.failCommand = "set_main_controls"; });
  await page.getByLabel("速度 BPM").fill("96");
  await page.getByLabel("速度 BPM").press("Enter");
  await expect(page.getByRole("alert")).toContainText("could not be completed");
});

test("stopping cancels visual beats that were scheduled ahead of playback", async ({ page }) => {
  await setTransport(page, { running: true, beats_per_bar: 3 });
  await beat(page, { beat: 1, beats_per_bar: 3 }, 180);
  await setTransport(page, { running: false });
  await page.waitForTimeout(220);
  await expect(page.locator('.td-beats [data-lit="true"]')).toHaveCount(0);
  await expect(page.locator(".td-beats")).toHaveAttribute("aria-label", "3 拍");
});

test("missing devices remain selectable and fallback problems are explained", async ({ page }) => {
  await setTransport(page, { output_device: "Disconnected interface", active_device: "Speakers", device_problem: "Selected interface is unavailable; using the system default." });
  await expect(page.getByLabel("输出设备")).toHaveValue("Disconnected interface");
  await expect(page.getByRole("alert")).toContainText("unavailable");
  await page.getByLabel("输出设备").selectOption("");
  expect((await calls(page, "set_main_controls")).at(-1)?.args.controls).toEqual({ output_device: "" });
});

test("default and minimum window sizes fit with every control reachable", async ({ page }) => {
  for (const [width, height] of [[1120, 780], [640, 540]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(start(page)).toBeInViewport();
    await expect(page.getByLabel("速度 BPM")).toBeInViewport();
    if (width === 1120) await expect(page.getByLabel("输出设备")).toBeInViewport({ ratio: 1 });
    await page.getByLabel("在其他程序里也能用快捷键").scrollIntoViewIfNeeded();
    await expect(page.getByLabel("在其他程序里也能用快捷键")).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath(`main-${width}.png`) });
  }
});
