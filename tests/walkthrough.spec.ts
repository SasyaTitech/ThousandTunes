import { test, expect, type Page } from "@playwright/test";

import {
  beat,
  boot,
  bootPicker,
  calls,
  clearCalls,
  opaqueSurface,
  requestedHeight,
  setAppearance,
  setTransport,
  settle,
  type Json,
} from "./harness";

/**
 * Every control the widget has, used in order, with a picture of each step.
 *
 *   npm run walkthrough
 *
 * The functional runs in the virtual machine prove the app behaves on a Linux
 * desktop: that it lands in the right place, makes the right sound, hides for
 * a game, and does what its menu says. They cannot say what any of it looks
 * like. This does: it drives the real interface and photographs the result of
 * each step, so a layout that broke on a desktop with different fonts is seen
 * rather than guessed at.
 *
 * Each step asserts as well as photographs. A picture nobody checked is not a
 * test, and an assertion with no picture is what this run exists to add to.
 */

const OUT = "test-results/walkthrough";

/** Animation off, so a lit dot is caught at full strength and not mid fade. */
const STILL = { animations: false, motion_allowed: false } as const;

const PLAYING = {
  running: true,
  bpm: 120,
  beats_per_bar: 4,
  beat_unit: 4,
  subdivision: 1,
  active_device: "Speakers (USB Audio Interface)",
  output_device: "Speakers (USB Audio Interface)",
};

let step = 0;

/**
 * Photographs the widget at its own size.
 *
 * The height comes from the interface itself rather than from what it last
 * asked the backend for: a step that cleared the recorded commands to watch
 * for new ones would otherwise be photographed in a window four times too
 * tall, with the widget sitting at the bottom of an empty box.
 */
async function shot(page: Page, name: string) {
  step += 1;
  const number = String(step).padStart(2, "0");
  await opaqueSurface(page);
  await settle(page);
  const height = await page.evaluate(() => {
    // The same arithmetic the interface does before telling the backend how
    // tall to make the window: the content, plus the frame around it.
    const content = document.querySelector(".td-content") as HTMLElement;
    const rows = content.parentElement as HTMLElement;
    const shell = document.querySelector(".td-shell") as HTMLElement;
    const rowsStyle = getComputedStyle(rows);
    const shellStyle = getComputedStyle(shell);
    const frame =
      parseFloat(rowsStyle.paddingTop) +
      parseFloat(rowsStyle.paddingBottom) +
      parseFloat(shellStyle.borderTopWidth) +
      parseFloat(shellStyle.borderBottomWidth);
    return Math.ceil(content.getBoundingClientRect().height + frame);
  });
  expect(height, "the widget has no height").toBeGreaterThan(0);
  await page.setViewportSize({ width: page.viewportSize()!.width, height });
  await settle(page);
  await page.screenshot({ path: `${OUT}/${number}-${name}.png`, omitBackground: true });
}

/** The floating widget, at the width the real window has. */
async function floating(page: Page, transport: Json = {}, appearance: Json = {}) {
  await page.setViewportSize({ width: 300, height: 400 });
  await boot(page, { ...PLAYING, ...transport }, { ...STILL, ...appearance });
  await settle(page);
}

test.describe.configure({ mode: "serial" });

test("it starts stopped, with the tempo and the meter in view", async ({ page }) => {
  await floating(page, { running: false });
  await expect(page.locator(".td-bpm")).toHaveText("120");
  await expect(page.locator('[data-pill="meter"]')).toHaveText("4/4");
  await expect(page.locator(".td-play")).toHaveAttribute("title", "Play");
  await expect(page.locator(".td-play")).toHaveAttribute("data-running", "false");
  await expect(page.locator(".td-dot")).toHaveCount(4);
  await shot(page, "at-rest");
});

test("the play button starts it and says so", async ({ page }) => {
  await floating(page, { running: false });
  await clearCalls(page);
  await page.locator(".td-play").click();
  expect(await calls(page, "toggle_play")).toHaveLength(1);
  await expect(page.locator(".td-play")).toHaveAttribute("title", "Stop");
  await expect(page.locator(".td-play")).toHaveAttribute("data-running", "true");
  await shot(page, "playing");
});

test("a click lands on the beat it belongs to", async ({ page }) => {
  await floating(page);
  await beat(page, { beat: 0, kind: "accent" });
  await settle(page);
  await expect(page.locator('.td-dot[data-beat="0"] .td-dot-lit')).toHaveCount(1);
  await expect(page.locator(".td-dot-lit")).toHaveAttribute("data-kind", "accent");
  await shot(page, "first-beat-accented");

  await beat(page, { beat: 2, kind: "beat" });
  await settle(page);
  // The lit mark lives inside the dot it belongs to.
  await expect(page.locator('.td-dot[data-beat="2"] .td-dot-lit')).toHaveCount(1);
  await expect(page.locator(".td-dot-lit")).toHaveAttribute("data-kind", "beat");
  await shot(page, "third-beat");
});

test("the slider sets the tempo across its whole range", async ({ page }) => {
  await floating(page);
  const slider = page.locator(".td-slider");
  await clearCalls(page);

  await slider.click({ position: { x: 1, y: 4 } });
  await slider.click({ position: { x: (await slider.boundingBox())!.width - 1, y: 4 } });
  const asked = (await calls(page, "set_tempo")).map((c) => c.args.bpm);
  expect(asked[0]).toBeLessThanOrEqual(40);
  expect(asked[asked.length - 1]).toBeGreaterThanOrEqual(240);

  await setTransport(page, { bpm: 240 });
  await expect(page.locator(".td-bpm")).toHaveText("240");
  await shot(page, "tempo-at-the-top");

  await setTransport(page, { bpm: 40 });
  await expect(page.locator(".td-bpm")).toHaveText("40");
  await shot(page, "tempo-at-the-bottom");
});

test("the wheel nudges the tempo in both directions", async ({ page }) => {
  await floating(page);
  await clearCalls(page);
  await page.locator(".td-bpm").hover();
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(150);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(150);
  const deltas = (await calls(page, "nudge_tempo")).map((c) => c.args.delta);
  expect(deltas).toHaveLength(2);
  expect(deltas[0]).toBeGreaterThan(0);
  expect(deltas[1]).toBeLessThan(0);
  await shot(page, "wheel-over-the-tempo");
});

test("four taps set the tempo", async ({ page }) => {
  await floating(page);
  await clearCalls(page);
  const tap = page.locator(".td-link", { hasText: "tap" });
  for (let i = 0; i < 4; i += 1) {
    await tap.click();
    await page.waitForTimeout(250);
  }
  const tapped = await calls(page, "set_tempo");
  expect(tapped.length).toBeGreaterThan(0);
  expect(tapped[tapped.length - 1].args.bpm).toBeGreaterThan(200);
  await shot(page, "tapped-tempo");
});

test("the meter pill steps through the meters", async ({ page }) => {
  await floating(page);
  await clearCalls(page);
  await page.locator('[data-pill="meter"]').click();
  expect(await calls(page, "cycle_meter")).toHaveLength(1);

  await setTransport(page, { beats_per_bar: 7, beat_unit: 8 });
  await expect(page.locator('[data-pill="meter"]')).toHaveText("7/8");
  await expect(page.locator(".td-dot")).toHaveCount(7);
  await shot(page, "seven-eight");
});

test("the subdivision pill steps through the grids", async ({ page }) => {
  await floating(page);
  await clearCalls(page);
  await page.locator('[data-pill="subdivision"]').click();
  expect(await calls(page, "cycle_subdivision")).toHaveLength(1);

  await setTransport(page, { subdivision: 3 });
  await expect(page.locator('[data-pill="subdivision"]')).toHaveText(/T/);
  await shot(page, "triplets");

  await setTransport(page, { subdivision: 4 });
  await expect(page.locator('[data-pill="subdivision"]')).toHaveText("1/16");
  await shot(page, "sixteenths");
});

test("a right click asks for the menu where the click was", async ({ page }) => {
  await floating(page);
  await clearCalls(page);
  await page.locator(".td-bpm").click({ button: "right" });
  const opened = await calls(page, "show_context_menu");
  expect(opened).toHaveLength(1);
  expect(opened[0].args.x).toBeGreaterThan(0);
  expect(opened[0].args.y).toBeGreaterThan(0);

  await page.locator('[data-pill="meter"]').click({ button: "right" });
  const pill = await calls(page, "show_pill_menu");
  expect(pill[0].args.pill).toBe("meter");
  expect(pill[0].args.x).toBeGreaterThan(0);
  await shot(page, "after-a-right-click");
});

test("the grip is what a floating widget is dragged by", async ({ page }) => {
  await floating(page);
  await expect(page.locator(".td-grip")).toBeVisible();
  await clearCalls(page);
  await page.locator(".td-grip").click();
  expect(await calls(page, "plugin:window|start_dragging")).toHaveLength(1);
  await shot(page, "the-grip");
});

test("the expanded layout shows the bar, the output and the sound", async ({ page }) => {
  await floating(page, {}, { expanded: true });
  await expect(page.locator(".td-device")).toContainText("Speakers");
  await expect(page.locator(".td-label", { hasText: "bar" })).toBeVisible();
  await expect(page.locator(".td-label", { hasText: "out" })).toBeVisible();
  const height = await requestedHeight(page);
  expect(height).toBeGreaterThan(70);
  await shot(page, "expanded");
});

test("the expanded layout changes the sound and the volume", async ({ page }) => {
  await floating(page, {}, { expanded: true });
  await clearCalls(page);

  const sound = page.locator(".td-pill:not([data-pill])");
  await sound.click();
  expect(await calls(page, "cycle_sound")).toHaveLength(1);
  await setTransport(page, { sound: "wood" });
  await expect(sound).toHaveText(/wood/i);
  await shot(page, "wood");

  await setTransport(page, { sound: "hihat" });
  await expect(sound).toHaveText(/hi/i);
  await shot(page, "hi-hat");

  // The volume is the percentage beside the device, and the wheel over it is
  // what changes it.
  const volume = page.locator('[title^="Volume"]');
  await expect(volume).toHaveText("75%");
  await volume.hover();
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(150);
  expect((await calls(page, "nudge_volume"))[0].args.delta).toBeGreaterThan(0);
  await setTransport(page, { volume: 100 });
  await expect(volume).toHaveText("100%");
  await shot(page, "volume-at-full");
});

test("a device that cannot be opened says so in the warning colour", async ({ page }) => {
  await floating(
    page,
    {
      output_device: "Speakers (USB Audio Interface)",
      active_device: "Speakers (Realtek High Definition Audio)",
      device_problem: "Speakers (USB Audio Interface) is not connected, playing on the default",
    },
    { expanded: true },
  );
  await expect(page.locator(".td-device")).toHaveClass(/td-warn/);
  await expect(page.locator(".td-device")).toHaveAttribute("title", /not connected/);
  await shot(page, "device-problem");
});

test("both themes are legible", async ({ page }) => {
  await floating(page, {}, { resolved_theme: "dark" });
  await beat(page, { beat: 1, kind: "beat" });
  await shot(page, "dark");

  await setAppearance(page, { resolved_theme: "light" });
  await settle(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await shot(page, "light");
});

test("the accent colour reaches the dots, the bar and the pills", async ({ page }) => {
  for (const accent of ["#f28c38", "#7f5af0", "#2cb67d"]) {
    await floating(page, {}, { accent });
    await beat(page, { beat: 0, kind: "accent" });
    await settle(page);
    const lit = await page
      .locator(".td-dot-lit")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(lit).not.toBe("rgba(0, 0, 0, 0)");
    await shot(page, `accent-${accent.slice(1)}`);
  }
});

test("the pinned layout fits the strip beside a panel", async ({ page }) => {
  await page.setViewportSize({ width: 208, height: 44 });
  await boot(page, PLAYING, { ...STILL, placement: "taskbar" });
  await beat(page, { beat: 0, kind: "accent" });
  await settle(page);
  await expect(page.locator(".td-shell")).toHaveAttribute("data-placement", "taskbar");
  await expect(page.locator(".td-grip")).toHaveCount(0);
  await expect(page.locator(".td-slider")).toBeVisible();
  const overflow = await page.evaluate(() => {
    const shell = document.querySelector(".td-shell") as HTMLElement;
    return [shell.scrollWidth - shell.clientWidth, shell.scrollHeight - shell.clientHeight];
  });
  expect(overflow).toEqual([0, 0]);
  step += 1;
  await page.screenshot({ path: `${OUT}/${String(step).padStart(2, "0")}-pinned.png`, omitBackground: true });
});

test("the compact layout fits a panel with less room", async ({ page }) => {
  await page.setViewportSize({ width: 124, height: 44 });
  await boot(page, PLAYING, { ...STILL, placement: "taskbar", compact: true });
  await beat(page, { beat: 1, kind: "beat" });
  await settle(page);
  await expect(page.locator(".td-shell")).toHaveClass(/td-compact/);
  const overflow = await page.evaluate(() => {
    const shell = document.querySelector(".td-shell") as HTMLElement;
    return [shell.scrollWidth - shell.clientWidth, shell.scrollHeight - shell.clientHeight];
  });
  expect(overflow).toEqual([0, 0]);
  step += 1;
  await page.screenshot({ path: `${OUT}/${String(step).padStart(2, "0")}-pinned-compact.png`, omitBackground: true });
});

test("a pinned widget on Linux is dragged by its background", async ({ page }) => {
  await page.setViewportSize({ width: 208, height: 44 });
  await boot(page, PLAYING, { ...STILL, placement: "taskbar", pinned_draggable: true });
  await settle(page);
  await expect(page.locator(".td-shell")).toHaveAttribute("title", /drag/i);
  await clearCalls(page);

  // On the background, not on a control: a drag must not start from the play
  // button or the slider, which have their own jobs.
  await page.locator(".td-shell").click({ position: { x: 104, y: 4 } });
  expect(await calls(page, "plugin:window|start_dragging")).toHaveLength(1);

  await clearCalls(page);
  await page.locator(".td-play").click();
  expect(await calls(page, "plugin:window|start_dragging")).toHaveLength(0);
  expect(await calls(page, "toggle_play")).toHaveLength(1);

  step += 1;
  await page.screenshot({
    path: `${OUT}/${String(step).padStart(2, "0")}-pinned-draggable.png`,
    omitBackground: true,
  });
});

test("the colour picker offers a colour and gives it back", async ({ page }) => {
  await page.setViewportSize({ width: 296, height: 372 });
  await bootPicker(page, { accent: "#2bb3a3" });
  await settle(page);
  await expect(page.locator(".td-picker")).toBeVisible();
  step += 1;
  await page.screenshot({ path: `${OUT}/${String(step).padStart(2, "0")}-picker.png` });

  await clearCalls(page);
  // A preset is the quickest way through, and it saves as soon as it is picked.
  await page.locator(".td-preset").nth(3).click();
  const applied = await calls(page, "set_accent");
  expect(applied).toHaveLength(1);
  expect(String(applied[0].args.color)).toMatch(/^#[0-9a-f]{6}$/i);
  await settle(page);
  step += 1;
  await page.screenshot({ path: `${OUT}/${String(step).padStart(2, "0")}-picker-preset.png` });

  // And the hue strip, dragged, which is the other way in.
  await clearCalls(page);
  const hue = page.locator(".td-hue");
  const box = (await hue.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  expect((await calls(page, "set_accent")).length).toBeGreaterThan(0);
  await settle(page);
  step += 1;
  await page.screenshot({ path: `${OUT}/${String(step).padStart(2, "0")}-picker-hue.png` });

  // Back to the one the app ships with.
  await page.locator(".td-picker-link", { hasText: "Default" }).click();
  await expect(page.locator(".td-picker-link", { hasText: "Default" })).toBeDisabled();
  step += 1;
  await page.screenshot({ path: `${OUT}/${String(step).padStart(2, "0")}-picker-default.png` });
});
