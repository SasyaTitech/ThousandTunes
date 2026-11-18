import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { applyAccent } from "@/lib/accent";
import type { AppearanceConfig, Transport } from "@/lib/types";

export interface Preset {
  id: number;
  name: string;
  bpm: number;
  beats_per_bar: number;
  beat_unit: number;
  subdivision: number;
  accent_first: boolean;
}

export interface PracticeView {
  presets: Preset[];
  selected_id: number | null;
  shortcuts_enabled: boolean;
  shortcut_extra_shift: boolean;
  shortcuts_active: boolean;
  shortcut_error: string | null;
}

const METERS = ["1/4", "2/4", "3/4", "4/4", "5/4", "6/8", "7/8"];
const SUBS = ["None", "2 per beat", "3 per beat (triplets)", "4 per beat"];
const EMPTY: Preset = { id: 0, name: "", bpm: 120, beats_per_bar: 4, beat_unit: 4, subdivision: 1, accent_first: true };

function fromTransport(t: Transport): Preset {
  return { ...EMPTY, bpm: t.bpm, beats_per_bar: t.beats_per_bar, beat_unit: t.beat_unit,
    subdivision: t.subdivision, accent_first: t.accent_first };
}

export default function Practice({ embedded = false }: { embedded?: boolean }) {
  const [view, setView] = React.useState<PracticeView | null>(null);
  const [transport, setTransport] = React.useState<Transport | null>(null);
  const [draft, setDraft] = React.useState<Preset>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [removing, setRemoving] = React.useState<number | null>(null);
  const inFlight = React.useRef(false);

  React.useEffect(() => {
    let disposed = false;
    const cleanup: Array<() => void> = [];
    const subscribe = <T,>(event: string, fn: (value: T) => void) => {
      listen<T>(event, e => { if (!disposed) fn(e.payload); })
        .then(un => disposed ? un() : cleanup.push(un)).catch(e => { if (!disposed) setError(String(e)); });
    };
    const appearance = (a: AppearanceConfig) => {
      const theme = a.resolved_theme === "light" ? "light" : "dark";
      document.documentElement.dataset.theme = theme;
      applyAccent(document.documentElement, a.accent, theme);
    };
    subscribe<PracticeView>("practice", setView);
    subscribe<Transport>("transport", setTransport);
    subscribe<AppearanceConfig>("config", appearance);
    subscribe<string>("practice-error", setError);
    Promise.all([invoke<PracticeView>("get_practice"), invoke<Transport>("get_transport"), invoke<AppearanceConfig>("get_appearance")])
      .then(([p, t, a]) => { if (!disposed) { setView(p); setTransport(t); setDraft(fromTransport(t)); appearance(a); } })
      .catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; cleanup.forEach(un => un()); };
  }, []);

  async function action(fn: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try { await fn(); } catch (e) { setError(String(e)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function newPreset() {
    setDraft(transport ? fromTransport(transport) : EMPTY);
    setRemoving(null); setMessage(""); setError("");
  }

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void action(async () => {
      const next = await invoke<PracticeView>("save_practice_preset", { preset: { ...draft, name: draft.name.trim() } });
      setView(next);
      setDraft(transport ? fromTransport(transport) : EMPTY);
      setMessage("Preset saved. Select Use when you want to play it.");
    });
  };

  return <div className="td-practice">
    <header className="td-practice-header">
      <div><h1>Practice presets</h1><p>Keep your favourite tempos close.</p></div>
      {!embedded && <button type="button" disabled={busy || !transport} onClick={() => void action(async () => {
        await invoke("toggle_play");
        setTransport(await invoke<Transport>("get_transport"));
      })}>{transport?.running ? "Stop" : "Play"}</button>}
    </header>
    <p className="td-practice-note">While playing, a preset takes effect at the next bar. Your output device, sound and volume stay the same.</p>
    {error && <p className="td-practice-error" role="alert">{error}</p>}
    <p className="td-practice-message" role="status">{message}</p>

    <section aria-label="Saved presets">
      <div className="td-practice-heading"><h2>Saved presets <small>{view?.presets.length ?? 0}/9</small></h2>
        <button type="button" disabled={busy || !view || view.presets.length >= 9} onClick={newPreset}>New from current</button>
      </div>
      {!view && <p>Loading presets...</p>}
      {view?.presets.length === 0 && <p className="td-practice-note">No presets yet. Name the current settings below to save your first one.</p>}
      <ol className="td-practice-list">
        {view?.presets.map((p, i) => <li key={p.id} className={view.selected_id === p.id ? "selected" : ""}>
          <span className="td-practice-slot">{i + 1}</span>
          <div className="td-practice-description"><strong title={p.name}>{p.name}</strong>
            <span>{p.bpm} BPM · {p.beats_per_bar}/{p.beat_unit} · {SUBS[p.subdivision - 1]}</span></div>
          <div className="td-practice-actions">
            <button type="button" aria-label={`Use ${p.name}`} disabled={busy} onClick={() => void action(async () => {
              await invoke("apply_practice_preset", { id: p.id });
              setView(await invoke<PracticeView>("get_practice"));
              setMessage(transport?.running ? `${p.name} selected. Changes take effect at the next bar.` : `${p.name} selected. Press Play to start.`);
            })}>Use</button>
            <button type="button" aria-label={`Edit ${p.name}`} disabled={busy} onClick={() => { setDraft({ ...p }); setRemoving(null); setMessage(""); }}>Edit</button>
            <button type="button" aria-label={`Remove ${p.name}`} disabled={busy} onClick={() => {
              if (removing !== p.id) { setRemoving(p.id); return; }
              void action(async () => {
                setView(await invoke<PracticeView>("delete_practice_preset", { id: p.id }));
                if (draft.id === p.id) setDraft(transport ? fromTransport(transport) : EMPTY);
                setRemoving(null); setMessage("Preset removed. The playing rhythm is unchanged.");
              });
            }}>{removing === p.id ? "Confirm?" : "Remove"}</button>
          </div>
        </li>)}
      </ol>
    </section>

    <form onSubmit={save} aria-label="Preset editor">
      <h2>{draft.id ? "Edit preset" : "New preset"}</h2>
      <fieldset disabled={busy || !view}>
        <label>Name<input value={draft.name} required maxLength={40} placeholder="e.g. Slow scales" onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <div className="td-practice-fields">
          <label>BPM<input type="number" min={30} max={300} step={1} required value={Number.isNaN(draft.bpm) ? "" : draft.bpm} onChange={e => setDraft({ ...draft, bpm: e.target.valueAsNumber })} /></label>
          <label>Meter<select aria-label="Meter" value={`${draft.beats_per_bar}/${draft.beat_unit}`} onChange={e => {
            const [beats_per_bar, beat_unit] = e.target.value.split("/").map(Number); setDraft({ ...draft, beats_per_bar, beat_unit });
          }}>{METERS.map(m => <option key={m}>{m}</option>)}</select></label>
          <label>Subdivision<select aria-label="Subdivision" value={draft.subdivision} onChange={e => setDraft({ ...draft, subdivision: Number(e.target.value) })}>
            {SUBS.map((s, i) => <option key={s} value={i + 1}>{s}</option>)}</select></label>
        </div>
        <label className="td-practice-check"><input type="checkbox" checked={draft.accent_first} onChange={e => setDraft({ ...draft, accent_first: e.target.checked })} />Accent the first beat</label>
        <div className="td-practice-form-actions">
          <button type="submit" className="primary" disabled={!draft.name.trim() || (!draft.id && (view?.presets.length ?? 0) >= 9)}>{draft.id ? "Save changes" : "Save preset"}</button>
          <button type="button" onClick={newPreset}>{draft.id ? "Cancel edit" : "Use current settings"}</button>
        </div>
      </fieldset>
    </form>

    <section aria-label="Global shortcuts" className="td-practice-shortcuts">
      <h2>Global shortcuts</h2>
      <label className="td-practice-check"><input type="checkbox" disabled={busy || !view} checked={view?.shortcuts_active ?? false} onChange={e => {
        const enabled = e.target.checked;
        void action(async () => {
          try { setView(await invoke<PracticeView>("set_practice_shortcuts", { enabled, extraShift: view?.shortcut_extra_shift ?? false })); }
          finally { setView(await invoke<PracticeView>("get_practice")); }
        });
      }} />Enable shortcuts in other apps</label>
      <label>Shortcut combination<select aria-label="Shortcut combination" disabled={busy || !view} value={view?.shortcut_extra_shift ? "shift" : "standard"} onChange={e => {
        const extraShift = e.target.value === "shift";
        void action(async () => {
          try { setView(await invoke<PracticeView>("set_practice_shortcuts", { enabled: view?.shortcuts_enabled ?? false, extraShift })); }
          finally { setView(await invoke<PracticeView>("get_practice")); }
        });
      }}><option value="standard">Ctrl + Alt</option><option value="shift">Ctrl + Alt + Shift (alternative)</option></select></label>
      {view?.shortcut_error && <p className="td-practice-error">{view.shortcut_error}</p>}
      <dl><dt>Play / stop</dt><dd><kbd>Ctrl + Alt + {view?.shortcut_extra_shift ? "Shift + " : ""}Space</kbd></dd>
        <dt>Previous / next preset</dt><dd><kbd>Ctrl + Alt + {view?.shortcut_extra_shift ? "Shift + " : ""}Page Up / Down</kbd></dd>
        <dt>Preset slots 1 to 9</dt><dd><kbd>Ctrl + Alt + {view?.shortcut_extra_shift ? "Shift + " : ""}1…9</kbd></dd></dl>
      <p className="td-practice-note">Shortcuts do not take focus. Holding a key triggers once. Empty slots do nothing.</p>
    </section>
  </div>;
}
