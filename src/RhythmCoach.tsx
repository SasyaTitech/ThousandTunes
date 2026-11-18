import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Transport } from "@/lib/types";
import { recentReview, type CoachNote, type ExtraCount } from "@/lib/coach-review";
import "@/rhythm-coach.css";

type Config = { input_id: string; channel: number; notes_per_beat: number; gate_db: number; length: number; review_length: number };
type Device = { id: string; name: string; channels: number; sample_rate: number };
type Status = {
  active: boolean; mode: string; message: string; level_db: number; clipped: boolean; attacks: number;
  clock_ms: number; start_ms: number | null; interval_ms: number; length: number;
  calibrated: boolean; offset_ms: number; calibration_jitter_ms: number; results: CoachNote[]; recent_extras: ExtraCount[];
  summary: { played: number; on_time: number; missed: number; extra: number; uncertain: number; mean_ms: number; spread_ms: number };
};
const INITIAL: Status = { active: false, mode: "idle", message: "选择吉他输入，先检查拨弦能否被识别。", level_db: -90, clipped: false, attacks: 0, clock_ms: 0, start_ms: null, interval_ms: 500, length: 32, calibrated: false, offset_ms: 0, calibration_jitter_ms: 0, results: [], recent_extras: [], summary: { played: 0, on_time: 0, missed: 0, extra: 0, uncertain: 0, mean_ms: 0, spread_ms: 0 } };
const signed = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)}`;
const labels: Record<string, string> = { good: "正好", early: "早了", late: "晚了", miss: "未检测到", uncertain: "信号不清晰" };

export default function RhythmCoach({ transport }: { transport: Transport | null }) {
  const [config, setConfig] = React.useState<Config>({ input_id: "", channel: 0, notes_per_beat: 1, gate_db: -45, length: 32, review_length: 32 });
  const [devices, setDevices] = React.useState<Device[]>([]);
  const [status, setStatus] = React.useState<Status>(INITIAL);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [calibration, setCalibration] = React.useState(false);
  const [connected, setConnected] = React.useState(false);
  const [now, setNow] = React.useState(0);
  const anchor = React.useRef({ audio: 0, performance: 0 });
  const latest = React.useRef(INITIAL);
  const flight = React.useRef(false);
  React.useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const update = (s: Status) => {
      if (disposed) return;
      latest.current = s;
      anchor.current = { audio: s.clock_ms, performance: performance.now() };
      setStatus(s); setNow(s.clock_ms);
    };
    void listen<Status>("coach", e => update(e.payload)).then(un => { if (disposed) un(); else unlisten = un; });
    void invoke<{ config: Config; status: Status }>("get_coach").then(v => {
      if (!disposed) { setConfig(v.config); update(v.status); }
    }).catch(e => { if (!disposed) setError(String(e)); });
    void invoke<Device[]>("get_input_devices").then(v => { if (!disposed) setDevices(v); }).catch(e => { if (!disposed) setError(String(e)); });
    let frame = 0;
    const draw = () => {
      if (latest.current.active) setNow(anchor.current.audio + performance.now() - anchor.current.performance);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { disposed = true; unlisten?.(); cancelAnimationFrame(frame); };
  }, []);
  async function action(fn: () => Promise<unknown>) {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(String(e)); }
    finally { flight.current = false; setBusy(false); }
  }
  const device = devices.find(d => d.id === config.input_id);
  const ready = !!device && !busy && !status.active;
  const start = (mode: string) => action(() => invoke("coach_start", { config, mode }));
  const change = (v: Partial<Config>) => setConfig(c => ({ ...c, ...v }));
  const progress = status.start_ms === null ? -4 : (now - status.start_ms) / status.interval_ms;
  const countIn = status.active && status.start_ms !== null && progress < 0;
  const last = status.results.at(-1);
  const recent = React.useMemo(() => recentReview(status.results, status.recent_extras, config.review_length), [status.results, status.recent_extras, config.review_length]);
  const chartX = (index: number) => {
    const lastIndex = Math.max(status.results.at(-1)?.index ?? -1, status.recent_extras.at(-1)?.index ?? -1);
    return 32 + (index - Math.max(0, lastIndex - config.review_length + 1)) * 346 / (config.review_length - 1);
  };
  const position = (index: number) => 27 + (index - progress) * 16;
  const visible: number[] = [];
  for (let i = Math.max(0, Math.floor(progress) - 2); i < Math.min(status.length || Infinity, progress + 6); i++) visible.push(i);
  const review = !status.active && status.results.length > 0 && status.mode === "practice";
  const calibrating = status.active && status.mode === "calibrate";
  const continuous = config.length === 0;
  const trackProgress = status.length === 0 ? `第 ${Math.max(1, Math.floor(progress) + 1)} 音 · ∞` : `${Math.min(status.length, Math.max(1, Math.floor(progress) + 1))} / ${status.length}`;

  return <section className="rc" aria-label="跟拍练习">
    <div className="rc-heading"><div><span className="rc-eyebrow">单音拨弦</span><h2>跟拍练习</h2></div>
      <span className="rc-badge">{status.active ? status.mode === "monitor" ? "正在检查输入" : status.mode === "calibrate" ? "回送校准中" : "练习中" : "未开始"}</span></div>
    <div className="rc-topline"><span><strong>{calibrating ? 90 : transport?.bpm ?? 120}</strong> BPM · {calibrating ? "回送测试 · 16 拍" : `${config.notes_per_beat === 1 ? "每拍一音" : "每半拍一音"} · ${continuous ? "无限练习" : `${config.length} 音一轮`}`}</span>
      <span className="rc-muted">{status.calibrated ? `本次已校准 ${signed(status.offset_ms)} ms` : "还没校准，早晚数值仅供参考"}</span></div>
    <div className="rc-highway" aria-label="音游轨道">
      <div className="rc-track-top"><span>{calibrating ? "接收回送节拍 · 不用弹奏" : "音符从右向左 · 到竖线时拨弦"}</span><span>{status.active && status.start_ms !== null && !countIn ? trackProgress : review ? "练习已结束" : "听四拍，开始"}</span></div>
      <div className="rc-lane"><div className="rc-rail" /><div className="rc-zone" /><div className="rc-hitline"><span>NOW</span></div>
        {status.start_ms !== null && visible.map(i => {
          const result = status.results.find(r => r.index === i);
          return <div key={i} className="rc-note" data-kind={result?.kind ?? "waiting"} style={{ left: `${position(i)}%` }}><span>{result ? result.kind === "good" ? "✓" : result.kind === "miss" ? "–" : "•" : i % config.notes_per_beat === 0 ? "●" : "○"}</span></div>;
        })}
        {status.start_ms === null && <div className="rc-empty">{status.mode === "monitor" && status.active ? "轻拨一音，观察下方识别次数" : "选好吉他输入，点下面的“开始跟拍”"}</div>}
      </div>
      <div className="rc-feedback" data-kind={last?.kind ?? "waiting"} aria-live="off">
        {countIn ? <><strong>{Math.ceil(-progress / (status.mode === "calibrate" ? 1 : config.notes_per_beat))}</strong><span>预备</span></> : last ? <><strong>{labels[last.kind]}</strong><span>{last.delta_ms === null ? "此次不计入早晚统计" : `${status.calibrated ? "" : "参考约 "}${signed(last.delta_ms)} ms`}</span></> : <><strong>{status.active ? "准备" : "未开始"}</strong><span>这里会显示每一下是早了还是晚了</span></>}
      </div>
      <div className="rc-legend"><span className="rc-early">● 早了</span><span className="rc-good">● 正好 ±30 ms</span><span className="rc-late">● 晚了</span><span>判定范围为练习设置</span></div>
    </div>
    <p className="rc-message" role="status">{status.message}</p>
    {error && <p className="rc-error" role="alert">{error}</p>}
    <div className="rc-actions">
      {status.active ? <button className="rc-primary" disabled={busy} onClick={() => void action(() => invoke("coach_stop"))}>结束{status.mode === "monitor" ? "检查" : status.mode === "calibrate" ? "校准" : status.length === 0 ? "练习" : "本轮"}</button>
        : <button className="rc-primary" disabled={!ready} onClick={() => void start("practice")}>{review ? continuous ? "再次开始" : "再练一轮" : "开始跟拍"}</button>}
      <button disabled={!ready} onClick={() => void start("monitor")}>检查输入</button>
      <button disabled={busy || status.active} onClick={() => setCalibration(v => !v)}>延迟校准</button>
      <span className="rc-muted">速度和拍号用底部的节拍器调</span>
    </div>

    {calibration && <div className="rc-calibration">
      <h3>用回送测设备延迟</h3>
      <p>把当前声卡的线路输出回送到所选输入，让软件听到自己发出的节拍。使用合适的线电平输入，关闭输入监听以免反馈；不要连接功放／音箱的功率输出。校准时不用弹琴。</p>
      <p>按下开始后，会以 90 BPM、25% 音量发出四拍预备和 16 拍测试，结束后恢复原设置。校准只对本次打开的输入／通道和输出组合有效；更改驱动缓冲、效果或接线后请重做。</p>
      <label className="rc-confirm"><input type="checkbox" disabled={status.active} checked={connected} onChange={e => setConnected(e.target.checked)} />我已接好同一信号路径的回送，并关闭输入监听</label>
      <button disabled={!ready || !connected} onClick={() => void start("calibrate")}>开始回送校准</button>
      <small>没法接回送的话可以不校准直接练，只是早晚的数值仅供参考。</small>
    </div>}

    <div className="rc-bottom-grid">
      <section className="rc-panel" aria-label="吉他输入设置"><h3>01 <span>吉他输入</span></h3>
        <fieldset disabled={status.active || busy}>
          <label>输入设备<select aria-label="吉他输入设备" value={config.input_id} onChange={e => change({ input_id: e.target.value, channel: 0 })}><option value="">请选择输入设备</option>
            {config.input_id && !device && <option value={config.input_id}>原设备未连接</option>}{devices.map(d => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label>
          <div className="rc-fields"><label>输入通道<select aria-label="输入通道" value={config.channel} onChange={e => change({ channel: Number(e.target.value) })}>{Array.from({ length: device?.channels ?? 1 }, (_, i) => <option value={i} key={i}>通道 {i + 1}</option>)}</select></label>
            <label>目标节奏<select aria-label="目标节奏" value={config.notes_per_beat} onChange={e => change({ notes_per_beat: Number(e.target.value) })}><option value={1}>每拍一音</option><option value={2}>每半拍一音</option></select></label></div>
          <div className="rc-fields"><label>一轮长度<select aria-label="一轮长度" value={config.length} onChange={e => change({ length: Number(e.target.value) })}><option value={0}>无限 · 手动停止</option>{[32, 64, 128].map(n => <option key={n} value={n}>{n} 音</option>)}</select></label>
            <label>忽略低于 {config.gate_db} dB 的信号<input aria-label="输入噪声门限" type="range" min={-70} max={-12} value={config.gate_db} onChange={e => change({ gate_db: Number(e.target.value) })} /></label></div>
          <button className="rc-refresh" onClick={() => void action(async () => setDevices(await invoke<Device[]>("get_input_devices")))}>刷新设备</button>
        </fieldset>
        <div className="rc-meter" role="meter" aria-label="输入电平" aria-valuemin={-90} aria-valuemax={0} aria-valuenow={Math.round(status.level_db)}><i data-clipped={status.clipped} style={{ width: `${Math.max(0, Math.min(100, (status.level_db + 60) / 60 * 100))}%` }} /></div>
        <div className="rc-meter-caption"><span>{status.clipped ? "输入过载，请降低声卡增益" : status.active ? `${Math.round(status.level_db)} dBFS` : "输入未开启"}</span><span>已识别 {status.attacks} 次拨弦</span></div>
        <p className="rc-muted">GT-1000CORE 输出接声卡时，选择声卡的模拟输入（如 E1x2 的 Analog IN），先用无延迟、无混响的音色。输入只用于本机分析，不回放、不保存录音。先用清晰拨弦，滑音和连奏暂不适合。</p>
      </section>
      <section className="rc-panel" aria-label="最近练习回顾"><h3>02 <span>最近 {config.review_length} 音回顾</span></h3>
        <label className="rc-review-range">回顾范围<select aria-label="回顾范围" disabled={busy} value={config.review_length} onChange={e => {
          const length = Number(e.target.value);
          void action(async () => { await invoke("coach_set_review_length", { length }); change({ review_length: length }); });
        }}>{[16, 32, 64, 128].map(n => <option key={n} value={n}>最近 {n} 音</option>)}</select></label>
        <p className="rc-muted rc-review-caption">随练习滚动更新 · 已有 {recent.notes.length} 个目标结果 · 漏检也占一音</p>
        <div className="rc-stat-grid"><div><strong>{recent.played ? signed(recent.mean_ms) : "—"}<small> ms</small></strong><span>整体早晚{!status.calibrated ? "（参考）" : ""}</span></div><div><strong>{recent.played >= 2 ? Math.round(recent.spread_ms) : "—"}<small> ms</small></strong><span>波动 · 越小越稳定</span></div></div>
        <svg className="rc-history" viewBox="0 0 400 120" role="img" aria-label={`最近${config.review_length}音早晚分布，中心线为正好`}>
          <rect x="25" y="45" width="360" height="30" rx="4" className="rc-chart-zone" /><path d="M25 60 H385" className="rc-chart-line" /><text x="1" y="20">晚</text><text x="1" y="64">0</text><text x="1" y="108">早</text>
          {recent.notes.map(n => n.delta_ms !== null ? <circle key={`${n.index}-${n.kind}`} cx={chartX(n.index)} cy={60 - Math.max(-90, Math.min(90, n.delta_ms)) / 2} r={config.review_length > 64 ? 1.5 : config.review_length > 32 ? 2.5 : 4} className={`rc-dot-${n.kind}`}><title>第{n.index + 1}音 {signed(n.delta_ms)} ms</title></circle> : <text key={`${n.index}-${n.kind}`} x={chartX(n.index) - 2} y="115" style={{ fontSize: config.review_length > 64 ? 5 : 9 }}>×<title>第{n.index + 1}音 {labels[n.kind]}</title></text>)}
        </svg>
        <div className="rc-counts"><span>识别 <b>{recent.played}</b></span><span>未检测到 <b>{recent.missed}</b></span><span>额外拨弦 <b>{recent.extra}</b></span><span>信号不清 <b>{recent.uncertain}</b></span></div>
        <p className="rc-muted">{status.calibrated ? "回送已补偿设备偏移；吉他音色和拨弦力度仍会影响识别。" : "还没校准时，整体早晚里含有设备延迟，数值只能参考，主要看波动。"} 未检测到也可能是轻拨或连奏漏检。只判断拨弦的时机，不判断音高。</p>
      </section>
    </div>
  </section>;
}
