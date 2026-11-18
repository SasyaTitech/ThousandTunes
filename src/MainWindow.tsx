import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Practice from "@/Practice";
import RhythmCoach from "@/RhythmCoach";
import { TapTempo } from "@/lib/tap";
import type { BeatEvent, Transport } from "@/lib/types";

type Controls = Partial<Pick<Transport, "bpm" | "subdivision" | "accent_first" | "sound" | "volume">> & {
  meter?: number[];
  output_device?: string;
};
const METERS = ["1/4", "2/4", "3/4", "4/4", "5/4", "6/8", "7/8"];

export default function MainWindow() {
  const [mode, setMode] = React.useState("metronome");
  const [transport, setTransport] = React.useState<Transport | null>(null);
  const [devices, setDevices] = React.useState<string[]>([]);
  const [tempo, setTempo] = React.useState("120");
  const [volume, setVolume] = React.useState(75);
  const [beat, setBeat] = React.useState<BeatEvent | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [taps, setTaps] = React.useState(0);
  const tapper = React.useRef(new TapTempo());
  const inFlight = React.useRef(false);
  const running = React.useRef(false);

  React.useEffect(() => {
    let disposed = false;
    const cleanup: Array<() => void> = [];
    const timers = new Set<number>();
    const update = (t: Transport) => {
      running.current = t.running;
      setTransport(t);
      if (!t.running) {
        timers.forEach(window.clearTimeout); timers.clear(); setBeat(null);
      }
      invoke<string[]>("get_output_devices").then(d => { if (!disposed) setDevices(d); }).catch(() => {});
    };
    const subscribe = <T,>(event: string, fn: (v: T) => void) => listen<T>(event, e => { if (!disposed) fn(e.payload); })
      .then(un => disposed ? un() : cleanup.push(un)).catch(e => { if (!disposed) setError(String(e)); });
    void subscribe<Transport>("transport", update);
    void subscribe<BeatEvent>("beat", ev => {
      if (ev.kind === "sub" || !running.current) return;
      const show = () => { if (!disposed && running.current) setBeat(ev); };
      const wait = ev.at_ms - Date.now();
      if (wait > 4 && wait < 300) {
        const timer = window.setTimeout(() => { timers.delete(timer); show(); }, wait);
        timers.add(timer);
      } else { show(); }
    });
    invoke<Transport>("get_transport").then(t => { if (!disposed) update(t); }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; cleanup.forEach(un => un()); timers.forEach(window.clearTimeout); };
  }, []);

  React.useEffect(() => { if (transport) setTempo(String(transport.bpm)); }, [transport?.bpm]);
  React.useEffect(() => { if (transport) setVolume(transport.volume); }, [transport?.volume]);

  async function action(fn: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(String(e)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function change(controls: Controls) {
    return action(async () => { setTransport(await invoke<Transport>("set_main_controls", { controls })); });
  }
  function commitTempo(value = tempo) {
    const bpm = Number(value);
    if (!value.trim() || !Number.isInteger(bpm) || bpm < 30 || bpm > 300) {
      setError("Tempo must be a whole number between 30 and 300 BPM.");
      return;
    }
    if (bpm !== transport?.bpm) void change({ bpm });
  }
  const count = transport?.running && beat ? beat.beats_per_bar : transport?.beats_per_bar ?? 4;
  const selectedDevice = transport?.output_device ?? "";
  const listedDevices = selectedDevice && !devices.includes(selectedDevice) ? [selectedDevice, ...devices] : devices;

  return <main className="td-main">
    <header className="td-main-header">
      <div><span className="td-main-brand">TAKTDOCK</span><h1>Time to practise.</h1></div>
      <nav className="td-mode-nav" role="tablist" aria-label="练习模式"><button role="tab" aria-selected={mode === "metronome"} onClick={() => setMode("metronome")}>节拍器与预设</button><button role="tab" aria-selected={mode === "coach"} onClick={() => setMode("coach")}>跟拍练习</button></nav>
      <span className="td-main-status" data-running={transport?.running ?? false}>{transport?.running ? "Playing" : "Ready when you are"}</span>
    </header>
    <div hidden={mode !== "coach"}><RhythmCoach transport={transport} /></div>
    <div className="td-main-layout" style={mode === "coach" ? { display: "none" } : undefined}>
      <section className="td-controller" aria-label="Metronome">
        <div className="td-tempo-block">
          <label htmlFor="main-tempo">TEMPO</label>
          <div className="td-main-tempo-row">
            <button type="button" aria-label="Decrease tempo" disabled={!transport || busy || transport.bpm <= 30} onClick={() => void change({ bpm: transport!.bpm - 1 })}>−</button>
            <div><input id="main-tempo" aria-label="Tempo BPM" type="number" min={30} max={300} step={1}
              disabled={!transport || busy} value={tempo} onChange={e => setTempo(e.target.value)}
              onBlur={() => commitTempo()} onKeyDown={e => { if (e.key === "Enter") commitTempo(); }} /><span>BPM</span></div>
            <button type="button" aria-label="Increase tempo" disabled={!transport || busy || transport.bpm >= 300} onClick={() => void change({ bpm: transport!.bpm + 1 })}>+</button>
          </div>
          <input className="td-main-range" aria-label="Tempo slider" type="range" min={30} max={300} step={1} disabled={!transport || busy}
            value={Number(tempo) || 30} onChange={e => setTempo(e.target.value)}
            onPointerUp={e => commitTempo(e.currentTarget.value)} onKeyUp={e => commitTempo(e.currentTarget.value)} />
          <div className="td-tempo-range-labels"><span>30</span><span>300</span></div>
        </div>

        <div className="td-main-beats" role="img" aria-label={beat && transport?.running ? `Beat ${beat.beat + 1} of ${count}` : `${count} beats`}>
          {Array.from({ length: count }, (_, i) => <span key={i} data-lit={!!(transport?.running && beat?.beat === i)} data-accent={i === 0 && transport?.accent_first}>{i + 1}</span>)}
        </div>
        <div className="td-main-play-row">
          <button type="button" className="td-main-play" disabled={busy || !transport} onClick={() => void action(async () => {
            await invoke("toggle_play"); setTransport(await invoke<Transport>("get_transport"));
          })}>{transport?.running ? "■  Stop" : "▶  Start"}</button>
          <button type="button" className="td-main-tap" disabled={busy || !transport} onClick={() => {
            const bpm = tapper.current.tap(performance.now()); setTaps(n => n + 1);
            if (bpm !== null) { const bounded = Math.max(30, Math.min(300, bpm)); setTempo(String(bounded)); void change({ bpm: bounded }); }
          }}>Tap tempo<small>{taps ? "Keep tapping" : "Tap to set the pace"}</small></button>
        </div>
        {error && <p className="td-main-error" role="alert">{error}</p>}
        <fieldset disabled={busy || !transport} className="td-main-controls">
          <div className="td-main-control-pair">
            <label>Meter<select aria-label="Playing meter" value={`${transport?.beats_per_bar ?? 4}/${transport?.beat_unit ?? 4}`} onChange={e => void change({ meter: e.target.value.split("/").map(Number) })}>
              {METERS.map(m => <option key={m}>{m}</option>)}</select></label>
            <label>Subdivision<select aria-label="Playing subdivision" value={transport?.subdivision ?? 1} onChange={e => void change({ subdivision: Number(e.target.value) })}>
              <option value={1}>1 per beat</option><option value={2}>2 per beat</option><option value={3}>3 per beat (triplets)</option><option value={4}>4 per beat</option>
            </select></label>
          </div>
          <label className="td-main-check"><input type="checkbox" checked={transport?.accent_first ?? true} onChange={e => void change({ accent_first: e.target.checked })} />Accent the first beat</label>
          <div className="td-main-control-pair">
            <label>Sound<select value={transport?.sound ?? "click"} onChange={e => void change({ sound: e.target.value })}>
              <option value="click">Click</option><option value="wood">Wood</option><option value="hihat">Hi-hat</option>
            </select></label>
            <label>Volume <span className="td-volume-value">{volume}%</span><input className="td-main-range" aria-label="Volume" type="range" min={0} max={100} value={volume} onChange={e => setVolume(Number(e.target.value))}
              onPointerUp={e => void change({ volume: Number(e.currentTarget.value) })} onKeyUp={e => void change({ volume: Number(e.currentTarget.value) })} /></label>
          </div>
          <label>Audio output<select value={selectedDevice} onChange={e => void change({ output_device: e.target.value })}>
            <option value="">System default</option>{listedDevices.map(d => <option key={d} value={d}>{d}{devices.includes(d) ? "" : " (not connected)"}</option>)}
          </select></label>
        </fieldset>
        {transport?.device_problem && <p className="td-main-error" role="alert">{transport.device_problem}</p>}
        <p className="td-main-footnote">{transport?.active_device ? `Playing through ${transport.active_device}. ` : ""}Minimise the window to keep practising. Closing it stops playback and exits.</p>
      </section>
      <aside className="td-main-presets" aria-label="Practice library"><Practice embedded /></aside>
    </div>
  </main>;
}
