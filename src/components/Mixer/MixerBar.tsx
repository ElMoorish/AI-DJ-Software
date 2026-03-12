import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { DeckState, WaveformData } from '../../types';
import WaveformCanvas from '../Waveform/WaveformCanvas';
import RenderModal from './RenderModal';

const ipc = (window as any).electron;

/* ── EQ Knob ──────────────────────────────────────────────────── */
interface KnobProps {
  value: number;
  min?: number;
  max?: number;
  label: string;
  size?: number;
  color?: string;
  onChange: (v: number) => void;
}

const Knob: React.FC<KnobProps> = ({ value, min = -12, max = 6, label, size = 44, color = '#7c6dff', onChange }) => {
  const dragging = useRef(false);
  const startY = useRef(0);
  const startVal = useRef(value);

  const normalised = (value - min) / (max - min);
  const angleDeg = -135 + normalised * 270;
  const rad = (angleDeg * Math.PI) / 180;
  const cx = size / 2, cy = size / 2, r = size / 2 - 5;

  const startRad = (-135 * Math.PI) / 180;
  const arcX1 = cx + r * Math.cos(startRad);
  const arcY1 = cy + r * Math.sin(startRad);
  const arcX2 = cx + r * Math.cos(rad);
  const arcY2 = cy + r * Math.sin(rad);
  const largeArc = normalised * 270 > 180 ? 1 : 0;

  const handleMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    startY.current = e.clientY;
    startVal.current = value;
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dy = startY.current - e.clientY;
      const range = max - min;
      const newVal = Math.max(min, Math.min(max, startVal.current + (dy / 80) * range));
      onChange(Math.round(newVal * 10) / 10);
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [min, max, onChange]);

  const isZero = Math.abs(value) < 0.5;
  const dotX = cx + (r - 3) * Math.cos(rad);
  const dotY = cy + (r - 3) * Math.sin(rad);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'ns-resize' }}>
      <svg
        width={size} height={size}
        onMouseDown={handleMouseDown}
        style={{ filter: `drop-shadow(0 0 ${isZero ? 4 : 8}px ${color}${isZero ? '40' : '80'})` }}
      >
        {/* Outer ring background */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
        {/* Inner circle */}
        <circle cx={cx} cy={cy} r={r - 6} fill="rgba(255,255,255,0.04)" />
        {/* Value arc */}
        <path
          d={`M ${arcX1} ${arcY1} A ${r} ${r} 0 ${largeArc} 1 ${arcX2} ${arcY2}`}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          opacity={0.9}
        />
        {/* Indicator dot */}
        <circle cx={dotX} cy={dotY} r={3.5} fill={color} />
      </svg>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace', color }}>
        {value >= 0 ? '+' : ''}{value.toFixed(0)}
      </span>
    </div>
  );
};

/* ── Peak Meter ───────────────────────────────────────────────── */
const PeakMeter: React.FC<{ db: number; color?: string }> = ({ db, color = '#7c6dff' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dbRef = useRef(db);
  useEffect(() => { dbRef.current = db; }, [db]);

  useEffect(() => {
    let raf: number;
    const draw = () => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const w = c.width, h = c.height;
      ctx.clearRect(0, 0, w, h);

      // Background segments
      const segH = 4, gap = 2, totalSeg = Math.floor(h / (segH + gap));
      for (let i = 0; i < totalSeg; i++) {
        const y = h - i * (segH + gap) - segH;
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.roundRect(0, y, w, segH, 1);
        ctx.fill();
      }

      const level = Math.max(0, Math.min(1, (dbRef.current + 60) / 60));
      const litSegs = Math.round(level * totalSeg);

      for (let i = 0; i < litSegs; i++) {
        const y = h - i * (segH + gap) - segH;
        const t = i / totalSeg;
        let segColor: string;
        if (t < 0.6) segColor = '#00e676';
        else if (t < 0.85) segColor = '#ffd740';
        else segColor = '#ff4f6a';
        ctx.fillStyle = segColor;
        ctx.roundRect(0, y, w, segH, 1);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} width={8} height={72} style={{ borderRadius: 2 }} />;
};

/* ── Time formatter ───────────────────────────────────────────── */
const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

/* ── Deck Panel ───────────────────────────────────────────────── */
interface DeckPanelProps {
  deck: 'A' | 'B';
  state: DeckState;
  waveform: WaveformData | null;
  containerWidth: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (ms: number) => void;
  onCue: () => void;
  onLoop: () => void;
  onEQ: (band: 'low' | 'mid' | 'high', db: number) => void;
  onNudge: (factor: number) => void;
}

const DeckPanel: React.FC<DeckPanelProps> = ({
  deck, state, waveform, containerWidth,
  onPlay, onPause, onSeek, onCue, onLoop, onEQ, onNudge,
}) => {
  const isA = deck === 'A';
  const accentColor = isA ? '#7c6dff' : '#00d4ff';
  const accentGlow = isA ? 'rgba(124,109,255,0.4)' : 'rgba(0,212,255,0.35)';
  const hasTrack = !!state.track_id;
  const progress = state.duration_ms > 0 ? state.position_ms / state.duration_ms : 0;

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      minWidth: 0,
      background: 'rgba(255,255,255,0.018)',
      borderRadius: 12,
      border: `1px solid ${hasTrack ? `${accentColor}30` : 'rgba(255,255,255,0.05)'}`,
      padding: '10px 12px',
      position: 'relative',
      overflow: 'hidden',
      transition: 'border-color 0.3s ease',
    }}>
      {/* Deck label */}
      <div style={{
        position: 'absolute',
        top: 8,
        right: 10,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: '0.12em',
        color: accentColor,
        opacity: 0.5,
        userSelect: 'none',
      }}>
        DECK {deck}
      </div>

      {/* Track info row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingRight: 52 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 13,
            fontWeight: 700,
            color: hasTrack ? 'var(--text-primary)' : 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            letterSpacing: '-0.01em',
          }}>
            {state.title || '— No Track Loaded —'}
          </div>
          <div style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 1,
          }}>
            {state.artist || ''}
          </div>
        </div>

        {/* BPM + Key */}
        {hasTrack && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: accentColor, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
              {state.bpm > 0 ? state.bpm.toFixed(1) : '—'}
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>BPM</div>
            {state.key_camelot && (
              <div style={{
                marginTop: 3,
                padding: '2px 6px',
                borderRadius: 4,
                background: `${accentColor}20`,
                color: accentColor,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.05em',
              }}>
                {state.key_camelot}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Waveform */}
      <div className="waveform-container" style={{ height: 64, flexShrink: 0 }}>
        {waveform ? (
          <WaveformCanvas
            data={waveform}
            width={containerWidth}
            height={64}
            playheadMs={state.position_ms}
            bpm={state.bpm}
            onSeek={onSeek}
            label={deck}
          />
        ) : (
          <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            color: 'var(--text-muted)',
            gap: 6,
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
            </svg>
            {state.track_id ? 'Loading waveform…' : 'Load a track to see waveform'}
          </div>
        )}
      </div>

      {/* Progress bar */}
      {hasTrack && (
        <div className="progress-bar" style={{ marginTop: -4 }}>
          <div className="progress-bar-fill" style={{
            width: `${progress * 100}%`,
            background: state.is_playing
              ? `linear-gradient(90deg, ${accentColor}, ${isA ? '#00d4ff' : '#7c6dff'})`
              : `linear-gradient(90deg, ${accentColor}80, ${accentColor}40)`,
          }} />
        </div>
      )}

      {/* Time display */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', padding: '0 2px' }}>
        <span style={{ color: accentColor, fontWeight: 600 }}>{fmt(state.position_ms)}</span>
        {state.loop_active && (
          <span style={{ color: '#f97316', fontWeight: 700, fontSize: 10, letterSpacing: '0.05em' }}>
            ↺ LOOP {fmt(state.loop_end_ms! - state.loop_start_ms!)}
          </span>
        )}
        <span style={{ color: 'var(--text-muted)' }}>
          −{fmt(Math.max(0, state.duration_ms - state.position_ms))}
        </span>
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexDirection: isA ? 'row' : 'row-reverse' }}>
        {/* BPM nudge */}
        <div style={{ display: 'flex', gap: 3 }}>
          <button
            onMouseDown={() => onNudge(0.985)}
            onMouseUp={() => onNudge(1.0)}
            onMouseLeave={() => onNudge(1.0)}
            style={{
              width: 26, height: 28,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6,
              color: 'var(--text-secondary)',
              fontSize: 14, fontWeight: 700,
              cursor: 'pointer', lineHeight: 1,
              transition: 'all 0.1s',
            }}
          >−</button>
          <button
            onMouseDown={() => onNudge(1.015)}
            onMouseUp={() => onNudge(1.0)}
            onMouseLeave={() => onNudge(1.0)}
            style={{
              width: 26, height: 28,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6,
              color: 'var(--text-secondary)',
              fontSize: 14, fontWeight: 700,
              cursor: 'pointer', lineHeight: 1,
              transition: 'all 0.1s',
            }}
          >+</button>
        </div>

        {/* CUE */}
        <button
          onClick={onCue}
          style={{
            padding: '0 10px',
            height: 28,
            background: `${accentColor}18`,
            border: `1px solid ${accentColor}35`,
            borderRadius: 6,
            color: accentColor,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            cursor: 'pointer',
            textTransform: 'uppercase',
          }}
        >CUE</button>

        {/* Play/Pause — main button */}
        <button
          onClick={state.is_playing ? onPause : onPlay}
          style={{
            width: 42,
            height: 42,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'all 0.15s ease',
            background: state.is_playing
              ? `linear-gradient(135deg, ${accentColor}, ${isA ? '#5f52e8' : '#0096cc'})`
              : `${accentColor}25`,
            boxShadow: state.is_playing
              ? `0 0 20px ${accentGlow}, 0 4px 12px rgba(0,0,0,0.4)`
              : `inset 0 1px 0 ${accentColor}30`,
            transform: 'scale(1)',
          }}
        >
          {state.is_playing
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill={accentColor}><polygon points="5,3 19,12 5,21" /></svg>
          }
        </button>

        {/* LOOP */}
        <button
          onClick={onLoop}
          style={{
            padding: '0 10px',
            height: 28,
            background: state.loop_active ? 'rgba(249,115,22,0.18)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${state.loop_active ? 'rgba(249,115,22,0.4)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 6,
            color: state.loop_active ? '#f97316' : 'var(--text-muted)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            cursor: 'pointer',
            textTransform: 'uppercase',
          }}
        >↺ LOOP</button>

        {/* EQ Knobs */}
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <Knob value={state.eq_low} label="Low" color={accentColor} size={40} onChange={db => onEQ('low', db)} />
          <Knob value={state.eq_mid} label="Mid" color={accentColor} size={40} onChange={db => onEQ('mid', db)} />
          <Knob value={state.eq_high} label="Hi" color={accentColor} size={40} onChange={db => onEQ('high', db)} />
        </div>
      </div>
    </div>
  );
};

/* ── MixerBar ─────────────────────────────────────────────────── */
const EMPTY_DECK: DeckState = {
  track_id: null, title: '— No Track —', artist: '', duration_ms: 0,
  position_ms: 0, bpm: 0, key_camelot: '', is_playing: false,
  volume: 1, eq_low: 0, eq_mid: 0, eq_high: 0,
  cue_point_ms: 0, loop_start_ms: null, loop_end_ms: null, loop_active: false,
};

const MixerBar: React.FC = () => {
  const [deckA, setDeckA] = useState<DeckState>(EMPTY_DECK);
  const [deckB, setDeckB] = useState<DeckState>(EMPTY_DECK);
  const [crossfader, setCrossfader] = useState(0.5);
  const [peakDb, setPeakDb] = useState(-60);
  const [waveformA, setWaveformA] = useState<WaveformData | null>(null);
  const [waveformB, setWaveformB] = useState<WaveformData | null>(null);
  const [showRender, setShowRender] = useState(false);
  const [containerWidth, setContainerWidth] = useState(400);
  const containerRef = useRef<HTMLDivElement>(null);
  const { activePlaylist } = useStore();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width / 2 - 60);
      setContainerWidth(Math.max(200, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (!alive) return;
      try {
        const state = await ipc.invoke('mixer:get-state');
        if (state) {
          setDeckA(state.deck_a);
          setDeckB(state.deck_b);
          setCrossfader(state.crossfader);
          setPeakDb(state.peak_level_db);
        }
      } catch { }
      if (alive) setTimeout(poll, 33);
    };
    poll();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (deckA.track_id) {
      ipc.invoke('waveform:get', deckA.track_id).then(setWaveformA).catch(() => { });
    } else setWaveformA(null);
  }, [deckA.track_id]);

  useEffect(() => {
    if (deckB.track_id) {
      ipc.invoke('waveform:get', deckB.track_id).then(setWaveformB).catch(() => { });
    } else setWaveformB(null);
  }, [deckB.track_id]);

  const mkDeckHandlers = (deck: 'A' | 'B') => ({
    onPlay: () => ipc.invoke('mixer:play', deck),
    onPause: () => ipc.invoke('mixer:pause', deck),
    onSeek: (ms: number) => ipc.invoke('mixer:seek', deck, ms),
    onCue: () => ipc.invoke('mixer:cue', deck),
    onLoop: () => ipc.invoke('mixer:toggle-loop', deck),
    onEQ: (band: 'low' | 'mid' | 'high', db: number) => ipc.invoke('mixer:set-eq', deck, band, db),
    onNudge: (factor: number) => ipc.invoke('mixer:nudge-bpm', deck, factor),
  });

  return (
    <>
      {showRender && <RenderModal playlistId={activePlaylist?.playlist_id} onClose={() => setShowRender(false)} />}

      <div
        ref={containerRef}
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'stretch',
          padding: '10px 12px',
          gap: 10,
        }}
      >
        {/* Deck A */}
        <DeckPanel deck="A" state={deckA} waveform={waveformA}
          containerWidth={containerWidth} {...mkDeckHandlers('A')} />

        {/* ── Center mixer column ── */}
        <div style={{
          width: 110,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          flexShrink: 0,
          padding: '4px 0',
        }}>
          {/* Master label */}
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            MASTER
          </div>

          {/* VU Meters */}
          <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end' }}>
            <PeakMeter db={peakDb} />
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3 }}>
              {['-3', '-6', '-12', '-∞'].map(label => (
                <div key={label} style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>{label}</div>
              ))}
            </div>
            <PeakMeter db={peakDb - 0.3} />
          </div>

          {/* Crossfader */}
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.05em' }}>A</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>XFADE</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--deck-b)', letterSpacing: '0.05em' }}>B</span>
            </div>
            <input
              id="crossfader"
              type="range" min={0} max={1} step={0.01}
              value={crossfader}
              onChange={e => {
                const v = parseFloat(e.target.value);
                setCrossfader(v);
                ipc.invoke('mixer:set-crossfader', v);
              }}
              className="crossfader-track"
              style={{ width: '100%', height: 20, padding: '8px 0' }}
            />
          </div>

          {/* Render button */}
          <button
            id="render-mix-btn"
            onClick={() => setShowRender(true)}
            style={{
              width: '100%',
              padding: '7px 0',
              borderRadius: 8,
              border: '1px solid rgba(124,109,255,0.25)',
              background: 'rgba(124,109,255,0.12)',
              color: 'var(--accent)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.05em',
              cursor: 'pointer',
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17" />
            </svg>
            Render Mix
          </button>
        </div>

        {/* Deck B */}
        <DeckPanel deck="B" state={deckB} waveform={waveformB}
          containerWidth={containerWidth} {...mkDeckHandlers('B')} />
      </div>
    </>
  );
};

export default MixerBar;
