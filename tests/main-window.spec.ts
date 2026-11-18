import { test, expect } from "@playwright/test";
import { installTauriMock, calls, setTransport, setAppearance, beat } from "./harness";

test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.goto("/?view=main");
  await expect(page.getByLabel("Tempo BPM")).toBeEnabled();
});

test("main controls play and change the rhythm without saving a preset", async ({ page }) => {
  await page.getByLabel("Tempo BPM").fill("95");
  await page.getByLabel("Tempo BPM").press("Enter");
  await expect.poll(async () => (await calls(page, "set_main_controls")).at(-1)?.args.controls).toEqual({ bpm: 95 });
  await page.getByLabel("Playing meter").selectOption("7/8");
  await page.getByLabel("Playing subdivision").selectOption("3");
  await page.getByRole("region", { name: "Metronome", exact: true }).getByLabel("Accent the first beat").uncheck();
  await page.getByRole("button", { name: "▶ Start" }).click();
  await expect(page.getByRole("button", { name: "■ Stop" })).toBeVisible();
  await expect(page.getByText("Playing", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "■ Stop" }).click();
  await expect(page.getByRole("button", { name: "▶ Start" })).toBeVisible();
  expect(await calls(page, "save_practice_preset")).toHaveLength(0);
  expect((await calls(page, "set_main_controls")).map(c => c.args.controls)).toEqual([
    { bpm: 95 }, { meter: [7, 8] }, { subdivision: 3 }, { accent_first: false },
  ]);
});

test("presets and main controls stay in sync and preserve the output", async ({ page }) => {
  await page.getByLabel("Audio output").selectOption("GT-1000CORE");
  await page.getByLabel("Name", { exact: true }).fill("Triplet practice");
  await page.getByLabel("BPM", { exact: true }).fill("133");
  await page.getByLabel("Meter", { exact: true }).selectOption("3/4");
  await page.getByLabel("Subdivision", { exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await page.getByRole("button", { name: "Use Triplet practice", exact: true }).click();
  await expect(page.getByLabel("Tempo BPM")).toHaveValue("133");
  await expect(page.getByLabel("Playing meter")).toHaveValue("3/4");
  await expect(page.getByLabel("Playing subdivision")).toHaveValue("3");
  await expect(page.getByLabel("Audio output")).toHaveValue("GT-1000CORE");
  await page.getByRole("button", { name: "New from current" }).click();
  await expect(page.getByLabel("BPM", { exact: true })).toHaveValue("133");
});

test("typing a tempo then pressing Start works with one click", async ({ page }) => {
  await page.getByLabel("Tempo BPM").fill("96");
  await page.getByRole("button", { name: "▶ Start" }).click();
  await expect(page.getByRole("button", { name: "■ Stop" })).toBeVisible();
  await expect(page.getByLabel("Tempo BPM")).toHaveValue("96");
});

test("invalid tempo and persistence errors are visible without changing the engine", async ({ page }) => {
  await page.getByLabel("Tempo BPM").fill("999");
  await page.getByLabel("Tempo BPM").press("Enter");
  await expect(page.getByRole("alert")).toContainText("30 and 300");
  expect(await calls(page, "set_main_controls")).toHaveLength(0);
  await page.evaluate(() => { (window as any).__TD.failCommand = "set_main_controls"; });
  await page.getByLabel("Tempo BPM").fill("96");
  await page.getByLabel("Tempo BPM").press("Enter");
  await expect(page.getByRole("alert")).toContainText("could not be completed");
});

test("stopping cancels visual beats that were scheduled ahead of playback", async ({ page }) => {
  await setTransport(page, { running: true, beats_per_bar: 3 });
  await beat(page, { beat: 1, beats_per_bar: 3 }, 180);
  await setTransport(page, { running: false });
  await page.waitForTimeout(220);
  await expect(page.locator('.td-main-beats [data-lit="true"]')).toHaveCount(0);
  await expect(page.locator(".td-main-beats")).toHaveAttribute("aria-label", "3 beats");
});

test("missing devices remain selectable and fallback problems are explained", async ({ page }) => {
  await setTransport(page, { output_device: "Disconnected interface", active_device: "Speakers", device_problem: "Selected interface is unavailable; using the system default." });
  await expect(page.getByLabel("Audio output")).toHaveValue("Disconnected interface");
  await expect(page.getByRole("alert")).toContainText("unavailable");
  await page.getByLabel("Audio output").selectOption("");
  expect((await calls(page, "set_main_controls")).at(-1)?.args.controls).toEqual({ output_device: "" });
});

test("desktop and narrow layouts fit with all controls reachable in both themes", async ({ page }) => {
  for (const width of [1000, 640]) {
    await page.setViewportSize({ width, height: 720 });
    for (const resolved_theme of ["light", "dark"]) {
      await setAppearance(page, { resolved_theme });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole("button", { name: "▶ Start" })).toBeInViewport();
      if (width === 1000) await expect(page.getByLabel("Audio output")).toBeInViewport({ ratio: 1 });
      await page.getByLabel("Enable shortcuts in other apps").scrollIntoViewIfNeeded();
      await expect(page.getByLabel("Enable shortcuts in other apps")).toBeInViewport();
      await page.getByLabel("Tempo BPM").scrollIntoViewIfNeeded();
      if (width === 1000) await page.screenshot({ path: test.info().outputPath(`main-${resolved_theme}.png`) });
    }
  }
});
