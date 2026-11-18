import { readFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

/**
 * The widget talks to the backend only through window.__TAURI_INTERNALS__, so
 * stubbing that one object is enough to drive the real interface in a browser.
 * `window.__TD` holds what the fake backend answers with and every command it
 * was sent.
 */
export async function installTauriMock(page: Page) {
  await page.addInitScript(() => {
    const callbacks: Record<number, (arg: unknown) => void> = {};
    const listeners: Record<string, number[]> = {};
    let counter = 0;
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener(event: string, id: number) { listeners[event] = (listeners[event] ?? []).filter(v => v !== id); },
    };

    (window as any).__TD = {
      appearance: {
        theme: "system",
        resolved_theme: "dark",
        animations: true,
        compact: false,
        expanded: false,
        placement: "float",
        motion_allowed: true,
        accent: null,
      },
      transport: {
        running: false,
        bpm: 120,
        beats_per_bar: 4,
        beat_unit: 4,
        subdivision: 1,
        accent_first: true,
        sound: "click",
        volume: 75,
        output_device: null,
        active_device: null,
        device_problem: null,
      },
      calls: [] as Array<{ cmd: string; args: unknown }>,
      practice: { presets: [] as any[], selected_id: null, shortcuts_enabled: false, shortcut_extra_shift: false, shortcuts_active: false, shortcut_error: null },
      failCommand: null,
      coach: {
        config: { input_id: "", channel: 0, notes_per_beat: 1, gate_db: -45, length: 32, review_length: 32 },
        status: { active: false, mode: "idle", message: "选择吉他输入，先检查拨弦能否被识别。", level_db: -90, clipped: false, attacks: 0, clock_ms: 10000, start_ms: null, interval_ms: 500, length: 32, calibrated: false, offset_ms: 0, calibration_jitter_ms: 0, results: [], recent_extras: [], summary: { played: 0, on_time: 0, missed: 0, extra: 0, uncertain: 0, mean_ms: 0, spread_ms: 0 } },
      },
      emit(event: string, payload: unknown) {
        for (const id of listeners[event] ?? []) {
          if (callbacks[id]) callbacks[id]({ event, id, payload });
        }
      },
    };

    (window as any).__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "widget" },
        currentWebview: { windowLabel: "widget", label: "widget" },
      },
      transformCallback(cb: (arg: unknown) => void) {
        const id = ++counter;
        callbacks[id] = cb;
        return id;
      },
      invoke(cmd: string, args: any) {
        const td = (window as any).__TD;
        td.calls.push({ cmd, args });
        if (td.failCommand === cmd) return Promise.reject("Test error: action could not be completed.");
        switch (cmd) {
          case "get_practice": return Promise.resolve(structuredClone(td.practice));
          case "save_practice_preset": {
            const p = { ...args.preset };
            if (p.id) td.practice.presets = td.practice.presets.map((old: any) => old.id === p.id ? p : old);
            else { p.id = Math.max(0, ...td.practice.presets.map((old: any) => old.id)) + 1; td.practice.presets.push(p); }
            return Promise.resolve(structuredClone(td.practice));
          }
          case "delete_practice_preset":
            td.practice.presets = td.practice.presets.filter((p: any) => p.id !== args.id);
            return Promise.resolve(structuredClone(td.practice));
          case "apply_practice_preset":
            td.practice.selected_id = args.id;
            {
              const p = td.practice.presets.find((p: any) => p.id === args.id);
              if (p) for (const key of ["bpm", "beats_per_bar", "beat_unit", "subdivision", "accent_first"]) td.transport[key] = p[key];
              td.emit("transport", structuredClone(td.transport));
            }
            return Promise.resolve();
          case "get_output_devices": return Promise.resolve(["GT-1000CORE", "Speakers"]);
          case "get_coach": return Promise.resolve(structuredClone(td.coach));
          case "get_input_devices": return Promise.resolve([{ id: "gt-dry", name: "GT-1000CORE DRY", channels: 2, sample_rate: 48000 }]);
          case "coach_start":
            td.coach.config = args.config;
            td.coach.status = { ...td.coach.status, active: true, mode: args.mode, length: args.mode === "calibrate" ? 16 : args.config.length, results: [], recent_extras: [], message: args.mode === "monitor" ? "拨几下单音，检查电平和识别次数。" : "四拍预备 · 听节拍再开始", start_ms: args.mode === "monitor" ? null : 12000 };
            td.emit("coach", structuredClone(td.coach.status));
            return Promise.resolve();
          case "coach_set_review_length":
            td.coach.config.review_length = args.length;
            return Promise.resolve();
          case "coach_stop":
            td.coach.status.active = false;
            td.coach.status.message = "已结束。输入已释放；保留本轮结果。";
            td.emit("coach", structuredClone(td.coach.status));
            return Promise.resolve();
          case "set_main_controls": {
            const { meter, output_device, ...rest } = args.controls;
            td.transport = { ...td.transport, ...rest };
            if (meter) [td.transport.beats_per_bar, td.transport.beat_unit] = meter;
            if (output_device !== undefined) td.transport.output_device = output_device || null;
            td.emit("transport", structuredClone(td.transport));
            return Promise.resolve(structuredClone(td.transport));
          }
          case "toggle_play":
            td.transport.running = !td.transport.running;
            td.emit("transport", structuredClone(td.transport));
            return Promise.resolve(td.transport.running);
          case "set_practice_shortcuts":
            td.practice.shortcuts_enabled = args.enabled;
            td.practice.shortcut_extra_shift = args.extraShift;
            td.practice.shortcuts_active = args.enabled;
            return Promise.resolve(structuredClone(td.practice));
          case "plugin:event|listen":
            (listeners[args.event] ??= []).push(args.handler);
            return Promise.resolve(args.handler);
          case "plugin:event|unlisten":
            listeners[args.event] = (listeners[args.event] ?? []).filter(id => id !== args.eventId);
            return Promise.resolve();
          case "get_appearance":
            return Promise.resolve(td.appearance);
          case "get_transport":
            return Promise.resolve(td.transport);
          default:
            return Promise.resolve(null);
        }
      },
    };
  });
}

export type Json = Record<string, unknown>;

export async function boot(page: Page, transport: Json = {}, appearance: Json = {}) {
  await installTauriMock(page);
  await page.addInitScript(
    ([t, a]) => {
      const apply = () => {
        const td = (window as any).__TD;
        if (!td) return false;
        td.transport = { ...td.transport, ...(t as object) };
        td.appearance = { ...td.appearance, ...(a as object) };
        return true;
      };
      if (!apply()) queueMicrotask(apply);
    },
    [transport, appearance] as const,
  );
  await page.goto("/");
  await page.waitForSelector(".td-shell");
  await page.waitForSelector(".td-bpm");
}

/** Opens the accent picker page against the same fake backend. */
export async function bootPicker(page: Page, appearance: Json = {}) {
  await installTauriMock(page);
  await page.addInitScript((a) => {
    const apply = () => {
      const td = (window as any).__TD;
      if (!td) return false;
      td.appearance = { ...td.appearance, ...(a as object) };
      return true;
    };
    if (!apply()) queueMicrotask(apply);
  }, appearance);
  await page.goto("/?view=accent");
  await page.waitForSelector(".td-picker");
  await page.waitForFunction(() =>
    (window as any).__TD.calls.some((c: { cmd: string }) => c.cmd === "get_appearance"),
  );
}

export async function setTransport(page: Page, value: Json) {
  await page.evaluate((v) => {
    const td = (window as any).__TD;
    td.transport = { ...td.transport, ...v };
    td.emit("transport", td.transport);
  }, value);
}

export async function setAppearance(page: Page, value: Json) {
  await page.evaluate((v) => {
    const td = (window as any).__TD;
    td.appearance = { ...td.appearance, ...v };
    td.emit("config", td.appearance);
  }, value);
}

/** A click as the audio thread would report it, heard `inMs` from now. */
export async function beat(page: Page, fields: Json = {}, inMs = 0) {
  await page.evaluate(
    ([f, delay]) => {
      const td = (window as any).__TD;
      td.emit("beat", {
        bar: 0,
        beat: 0,
        sub: 0,
        kind: "accent",
        beats_per_bar: td.transport.beats_per_bar,
        subdivision: td.transport.subdivision,
        bpm: td.transport.bpm,
        at_ms: Date.now() + (delay as number),
        ...(f as object),
      });
    },
    [fields, inMs] as const,
  );
}

export async function calls(page: Page, cmd?: string): Promise<Array<{ cmd: string; args: any }>> {
  return page.evaluate((c) => {
    const all = (window as any).__TD.calls as Array<{ cmd: string; args: any }>;
    return c ? all.filter((x) => x.cmd === c) : all.filter((x) => !x.cmd.startsWith("plugin:"));
  }, cmd);
}

export async function clearCalls(page: Page) {
  await page.evaluate(() => {
    (window as any).__TD.calls = [];
  });
}

/**
 * Flattens the widget's own translucency.
 *
 * `--surface` carries an alpha of about 0.92 and is painted twice, once on the
 * shell and again on the rows, so the grip rail and the row area settle at
 * different opacities. On screen that is invisible, because the desktop behind
 * fills both in. In a screenshot with no background it is a visible seam.
 */
export async function opaqueSurface(page: Page) {
  await page.addStyleTag({
    content: `
      html[data-theme="dark"], :root { --surface: #1b1b1b; }
      html[data-theme="light"] { --surface: #f7f7f5; }
    `,
  });
}

/** Waits for the thing being photographed to have finished arriving. */
export async function settle(page: Page) {
  await page.waitForSelector(".td-dot");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

/**
 * The height the interface asks the backend for, which is what the floating
 * window is sized to. Taking it from the page rather than repeating the
 * arithmetic means a test can never size itself for a layout the app no longer
 * has.
 */
export async function requestedHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const calls = (window as any).__TD.calls as Array<{ cmd: string; args: any }>;
    const heights = calls.filter((c) => c.cmd === "set_content_height").map((c) => c.args.height);
    return heights[heights.length - 1] ?? 0;
  });
}

/** Every element that sticks out of the window, with how far. */
export async function overflowing(page: Page, selector = ".td-row, .td-row > *, .td-dot, .td-pill") {
  return page.evaluate((sel) => {
    const shell = document.querySelector(".td-shell") as HTMLElement;
    const box = shell.getBoundingClientRect();
    return Array.from(document.querySelectorAll(sel))
      .map((el) => {
        const b = el.getBoundingClientRect();
        return {
          what: `${el.className} "${(el.textContent ?? "").trim()}"`,
          right: b.right - (box.right - 1),
          bottom: b.bottom - (box.bottom - 1),
          left: box.left + 1 - b.left,
          top: box.top + 1 - b.top,
        };
      })
      .filter((o) => o.right > 0.5 || o.bottom > 0.5 || o.left > 0.5 || o.top > 0.5);
  }, selector);
}

export interface ShotExpectation {
  width: number;
  height: number;
  /** Corner radius in device pixels. */
  radius: number;
  /**
   * The light surface is itself within a few levels of white, so a pale edge
   * pixel there is the widget and not a halo. Only dark shots are checked.
   */
  light?: boolean;
}

/**
 * Asserts a written PNG is what the README needs: an alpha channel, corners
 * that are actually empty, and no pale fringe where the rounded edge was
 * composited against something.
 */
export async function expectTransparentShot(page: Page, file: string, want: ShotExpectation) {
  const bytes = readFileSync(file);

  // The header is read directly, because the colour type is the one fact a
  // canvas cannot report: it hands back RGBA whatever the file said.
  expect(bytes.subarray(0, 8).toString("hex"), `${file} is not a PNG`).toBe("89504e470d0a1a0a");
  expect(bytes.readUInt32BE(16), `${file} width`).toBe(want.width);
  expect(bytes.readUInt32BE(20), `${file} height`).toBe(want.height);
  expect(bytes[24], `${file} bit depth`).toBe(8);
  expect(bytes[25], `${file} colour type, 6 is RGBA and 2 is RGB`).toBe(6);

  const stats = await page.evaluate(
    async ([b64, radius]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();

      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);

      const at = (x: number, y: number) => {
        const i = (y * width + x) * 4;
        return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
      };

      const corner = Math.max(1, Math.floor(radius * (1 - Math.SQRT1_2)) - 1);
      let opaqueCorners = 0;
      let whiteFringe = 0;
      for (const [ox, oy] of [
        [0, 0],
        [width - radius, 0],
        [0, height - radius],
        [width - radius, height - radius],
      ]) {
        for (let y = 0; y < radius; y++) {
          for (let x = 0; x < radius; x++) {
            const p = at(ox + x, oy + y);
            const outside =
              (ox === 0 ? x < corner : x >= radius - corner) &&
              (oy === 0 ? y < corner : y >= radius - corner);
            if (outside && p.a !== 0) opaqueCorners++;
            if (p.a > 0 && p.r >= 252 && p.g >= 252 && p.b >= 252) whiteFringe++;
          }
        }
      }

      let partial = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0 && data[i] < 255) partial++;
      }

      return {
        opaqueCorners,
        whiteFringe,
        partialShare: partial / (width * height),
        centre: at(Math.floor(width / 2), Math.floor(height / 2)).a,
        leftEdge: at(1, Math.floor(height / 2)).a,
        topEdge: at(Math.floor(width / 2), 1).a,
      };
    },
    [bytes.toString("base64"), want.radius] as const,
  );

  expect(stats.opaqueCorners, `${file} has painted corners`).toBe(0);
  if (!want.light) {
    expect(stats.whiteFringe, `${file} has a white fringe on its rounded edge`).toBe(0);
  }
  expect(stats.centre, `${file} centre is not opaque, so the page did not render`).toBe(255);
  expect(stats.leftEdge, `${file} left edge`).toBe(255);
  expect(stats.topEdge, `${file} top edge`).toBe(255);
  expect(stats.partialShare, `${file} is mostly edge, which means it is blank`).toBeLessThan(0.02);
}
