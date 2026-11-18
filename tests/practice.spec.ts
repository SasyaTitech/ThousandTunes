import { test, expect } from "@playwright/test";
import { installTauriMock, calls, setAppearance } from "./harness";

test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
  await page.setViewportSize({ width: 560, height: 670 });
  await page.goto("/?view=practice");
  await expect(page.getByLabel("Name", { exact: true })).toBeEnabled();
});

test("save, edit, recall and remove a complete practice preset", async ({ page }) => {
  await page.getByLabel("Name", { exact: true }).fill("慢练音阶");
  await page.getByLabel("BPM", { exact: true }).fill("97");
  await page.getByLabel("Meter", { exact: true }).selectOption("7/8");
  await page.getByLabel("Subdivision", { exact: true }).selectOption("3");
  await page.getByLabel("Accent the first beat").uncheck();
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await expect(page.getByRole("listitem")).toContainText("97 BPM · 7/8");
  expect((await calls(page, "save_practice_preset"))[0].args.preset).toEqual({ id: 0, name: "慢练音阶", bpm: 97, beats_per_bar: 7, beat_unit: 8, subdivision: 3, accent_first: false });
  await page.getByRole("button", { name: "Edit 慢练音阶" }).click();
  await page.getByLabel("BPM", { exact: true }).fill("101");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("listitem")).toContainText("101 BPM");
  await page.screenshot({ path: test.info().outputPath("practice-preview.png"), fullPage: true });
  await page.getByRole("button", { name: "Use 慢练音阶" }).click();
  expect((await calls(page, "apply_practice_preset"))[0].args.id).toBe(1);
  await page.getByRole("button", { name: "Remove 慢练音阶" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Remove 慢练音阶" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(0);
});

test("save errors retain the draft and shortcuts require an explicit opt in", async ({ page }) => {
  const enabled = page.getByLabel("Enable shortcuts in other apps");
  await expect(enabled).not.toBeChecked();
  await enabled.check(); await expect(enabled).toBeChecked();
  await enabled.uncheck();
  await page.getByLabel("Shortcut combination", { exact: true }).selectOption("shift");
  await expect(page.getByText("Ctrl + Alt + Shift + Space", { exact: true })).toBeVisible();
  await enabled.check();
  expect((await calls(page, "set_practice_shortcuts")).at(-1)?.args).toEqual({ enabled: true, extraShift: true });
  await enabled.uncheck();
  await page.evaluate(() => { (window as any).__TD.failCommand = "save_practice_preset"; });
  await page.getByLabel("Name", { exact: true }).fill("Keep my draft");
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("action could not be completed");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Keep my draft");
  await expect(page.getByRole("listitem")).toHaveCount(0);
});

test("full preset list and long names fit both themes at the minimum window size", async ({ page }) => {
  const name = "A long practice preset for difficult bars";
  await page.evaluate((name) => {
    const td = (window as any).__TD;
    td.practice.presets = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, name, bpm: 97, beats_per_bar: 7, beat_unit: 8, subdivision: 3, accent_first: true }));
    td.emit("practice", td.practice);
  }, name);
  await page.setViewportSize({ width: 450, height: 480 });
  await expect(page.getByRole("button", { name: "New from current" })).toBeDisabled();
  for (const theme of ["light", "dark"]) {
    await setAppearance(page, { resolved_theme: theme });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel("Enable shortcuts in other apps").scrollIntoViewIfNeeded();
    await expect(page.getByLabel("Enable shortcuts in other apps")).toBeInViewport();
  }
});
