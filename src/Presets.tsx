import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Preset, PracticeView } from "@/Practice";
import type { Transport } from "@/lib/types";

const METERS = ["1/4", "2/4", "3/4", "4/4", "5/4", "6/8", "7/8"];
export const SUBDIVISIONS = ["每拍 1 下", "每拍 2 下", "每拍 3 下（三连音）", "每拍 4 下"];
const EMPTY: Preset = { id: 0, name: "", bpm: 120, beats_per_bar: 4, beat_unit: 4, subdivision: 1, accent_first: true };
const current = (t: Transport | null): Preset => t ? { ...EMPTY, bpm: t.bpm, beats_per_bar: t.beats_per_bar, beat_unit: t.beat_unit, subdivision: t.subdivision, accent_first: t.accent_first } : EMPTY;

/** The main window's presets and global shortcuts. */
export default function Presets({ transport }: { transport: Transport | null }) {
  const [view, setView] = React.useState<PracticeView | null>(null);
  const [draft, setDraft] = React.useState<Preset | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [removing, setRemoving] = React.useState<number | null>(null);
  const inFlight = React.useRef(false);

  React.useEffect(() => {
    let disposed = false;
    const cleanup: Array<() => void> = [];
    const subscribe = <T,>(event: string, fn: (value: T) => void) => {
      listen<T>(event, e => { if (!disposed) fn(e.payload); }).then(un => disposed ? un() : cleanup.push(un)).catch(e => { if (!disposed) setError(String(e)); });
    };
    subscribe<PracticeView>("practice", setView);
    subscribe<string>("practice-error", setError);
    invoke<PracticeView>("get_practice").then(p => { if (!disposed) setView(p); }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; cleanup.forEach(un => un()); };
  }, []);

  async function action(fn: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(String(e)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const full = (view?.presets.length ?? 0) >= 9;
  const shift = view?.shortcut_extra_shift ? "Shift + " : "";
  const shortcuts = (enabled: boolean, extraShift: boolean) => action(async () => {
    try { setView(await invoke<PracticeView>("set_practice_shortcuts", { enabled, extraShift })); }
    finally { setView(await invoke<PracticeView>("get_practice")); }
  });

  return <div className="ps">
    <section aria-label="预设">
      <div className="ps-head"><h3>预设 <small>{view?.presets.length ?? 0}/9</small></h3>
        <button type="button" disabled={busy || !view || full || !!draft} onClick={() => setDraft(current(transport))}>＋ 存为预设</button></div>
      {error && <p className="td-error" role="alert">{error}</p>}
      {view?.presets.length === 0 && !draft && <p className="ps-note">还没有预设。调好上面的速度和拍号，点“存为预设”就能一键切换。</p>}
      <ol className="ps-list">
        {view?.presets.map((p, i) => <li key={p.id} data-selected={view.selected_id === p.id}>
          <button type="button" className="ps-use" aria-label={`使用 ${p.name}`} disabled={busy} onClick={() => void action(async () => {
            await invoke("apply_practice_preset", { id: p.id });
            setView(await invoke<PracticeView>("get_practice"));
          })}>
            <span className="ps-slot num">{i + 1}</span>
            <span className="ps-name"><strong title={p.name}>{p.name}</strong><small>{p.beats_per_bar}/{p.beat_unit} · {SUBDIVISIONS[p.subdivision - 1]}{p.accent_first ? "" : " · 无重音"}</small></span>
            <b className="num">{p.bpm}</b>
          </button>
          <button type="button" aria-label={`编辑 ${p.name}`} disabled={busy} onClick={() => { setDraft({ ...p }); setRemoving(null); }}>编辑</button>
          <button type="button" aria-label={`删除 ${p.name}`} disabled={busy} onClick={() => {
            if (removing !== p.id) return setRemoving(p.id);
            void action(async () => {
              setView(await invoke<PracticeView>("delete_practice_preset", { id: p.id }));
              if (draft?.id === p.id) setDraft(null);
              setRemoving(null);
            });
          }}>{removing === p.id ? "确认？" : "删除"}</button>
        </li>)}
      </ol>

      {draft && <form className="ps-form" aria-label="预设编辑" onSubmit={e => {
        e.preventDefault();
        void action(async () => {
          setView(await invoke<PracticeView>("save_practice_preset", { preset: { ...draft, name: draft.name.trim() } }));
          setDraft(null);
        });
      }}>
        <fieldset disabled={busy}>
          <label>名称<input aria-label="预设名称" value={draft.name} required maxLength={40} autoFocus placeholder="例如：慢练音阶" onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
          <div className="ps-fields">
            <label>速度<input aria-label="预设速度" type="number" min={30} max={300} step={1} required value={Number.isNaN(draft.bpm) ? "" : draft.bpm} onChange={e => setDraft({ ...draft, bpm: e.target.valueAsNumber })} /></label>
            <label>拍号<select aria-label="预设拍号" value={`${draft.beats_per_bar}/${draft.beat_unit}`} onChange={e => {
              const [beats_per_bar, beat_unit] = e.target.value.split("/").map(Number); setDraft({ ...draft, beats_per_bar, beat_unit });
            }}>{METERS.map(m => <option key={m}>{m}</option>)}</select></label>
            <label>细分<select aria-label="预设细分" value={draft.subdivision} onChange={e => setDraft({ ...draft, subdivision: Number(e.target.value) })}>
              {SUBDIVISIONS.map((s, i) => <option key={s} value={i + 1}>{s}</option>)}</select></label>
          </div>
          <label className="td-check"><input type="checkbox" checked={draft.accent_first} onChange={e => setDraft({ ...draft, accent_first: e.target.checked })} />第一拍加重音</label>
          <div className="ps-actions">
            <button type="submit" className="primary" disabled={!draft.name.trim()}>{draft.id ? "保存修改" : "保存预设"}</button>
            <button type="button" onClick={() => setDraft(null)}>取消</button>
          </div>
        </fieldset>
      </form>}
      <p className="ps-note">播放中切换预设会在下一小节生效；音色、音量和输出设备不变。</p>
    </section>

    <section aria-label="全局快捷键" className="ps-shortcuts">
      <h3>全局快捷键</h3>
      <label className="td-check"><input type="checkbox" disabled={busy || !view} checked={view?.shortcuts_active ?? false}
        onChange={e => void shortcuts(e.target.checked, view?.shortcut_extra_shift ?? false)} />在其他程序里也能用快捷键</label>
      <label>组合键<select aria-label="快捷键组合" disabled={busy || !view} value={view?.shortcut_extra_shift ? "shift" : "standard"}
        onChange={e => void shortcuts(view?.shortcuts_enabled ?? false, e.target.value === "shift")}>
        <option value="standard">Ctrl + Alt</option><option value="shift">Ctrl + Alt + Shift（备用）</option></select></label>
      {view?.shortcut_error && <p className="td-error">{view.shortcut_error}</p>}
      <dl><dt>播放 / 停止</dt><dd><kbd>Ctrl + Alt + {shift}Space</kbd></dd>
        <dt>上一个 / 下一个预设</dt><dd><kbd>Ctrl + Alt + {shift}Page Up / Down</kbd></dd>
        <dt>预设 1 到 9</dt><dd><kbd>Ctrl + Alt + {shift}1…9</kbd></dd></dl>
    </section>
  </div>;
}
