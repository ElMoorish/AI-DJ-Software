import React, { useRef, useEffect, useCallback } from 'react';
import { WaveformData, CuePoint } from '../../types';

interface WaveformProps {
  data: WaveformData;
  width: number;
  height: number;
  playheadMs: number;       // animates via rAF from parent
  onSeek?: (ms: number) => void;
  bpm?: number;             // for beat grid
  zoomLevel?: number;       // px per second (default = full width)
  scrollOffsetMs?: number;  // for scrolling (default 0)
  label?: 'A' | 'B';       // deck label colour accent
}

const GRID_COLOR = 'rgba(255,255,255,0.06)';
const BEAT_COLOR = 'rgba(255,255,255,0.12)';
const PHRASE_COLOR = 'rgba(255,255,255,0.20)';
const PLAYHEAD_COLOR = '#6C63FF';
const CUE_COLORS: Record<string, string> = {
  intro_end: '#22d3ee',
  drop: '#f97316',
  outro_start: '#a855f7',
  user: '#facc15',
};

const WaveformCanvas: React.FC<WaveformProps> = ({
  data,
  width,
  height,
  playheadMs,
  onSeek,
  bpm,
  zoomLevel,
  scrollOffsetMs = 0,
  label,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const playheadRef = useRef(playheadMs);

  // Keep a mutable ref for playhead so rAF always reads the latest value
  useEffect(() => {
    playheadRef.current = playheadMs;
  }, [playheadMs]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data?.pixels?.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    const dur = data.duration_ms || 1;
    const curPos = playheadRef.current;

    // Zoom: pixels per ms
    const pxPerMs = zoomLevel
      ? zoomLevel / 1000
      : w / dur;

    const offsetMs = zoomLevel ? scrollOffsetMs : 0;

    // ── Background
    ctx.fillStyle = '#12121D';
    ctx.fillRect(0, 0, w, h);

    // ── Beat grid
    if (bpm && bpm > 0) {
      const beatMs = (60 / bpm) * 1000;
      const phraseMs = beatMs * 16;

      let t = Math.floor(offsetMs / beatMs) * beatMs;
      while (t < offsetMs + w / pxPerMs) {
        const x = (t - offsetMs) * pxPerMs;
        const isPhrase = Math.abs(t % phraseMs) < beatMs * 0.1;
        ctx.strokeStyle = isPhrase ? PHRASE_COLOR : BEAT_COLOR;
        ctx.lineWidth = isPhrase ? 1.5 : 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
        t += beatMs;
      }
    }

    // ── Waveform bars
    const numPixels = data.pixels.length;
    const barWidth = (w / numPixels);

    data.pixels.forEach((pixel, i) => {
      const msPos = (i / numPixels) * dur;
      const x = (msPos - offsetMs) * pxPerMs;

      if (x < -barWidth || x > w + barWidth) return; // cull off-screen

      const barH = pixel.peak * (h / 2);
      const inFuture = msPos > curPos;
      const alphaMult = inFuture ? 0.5 : 1.0;

      ctx.fillStyle = `rgba(${pixel.r}, ${pixel.g}, ${pixel.b}, ${0.9 * alphaMult})`;
      ctx.fillRect(x, h / 2 - barH, Math.max(1, barWidth - 0.5), barH);

      ctx.fillStyle = `rgba(${pixel.r}, ${pixel.g}, ${pixel.b}, ${0.3 * alphaMult})`;
      ctx.fillRect(x, h / 2, Math.max(1, barWidth - 0.5), barH * 0.6);
    });

    // ── Cue point markers
    if (data.cue_points) {
      for (const cp of data.cue_points) {
        const x = (cp.position_ms - offsetMs) * pxPerMs;
        if (x < 0 || x > w) continue;

        const color = CUE_COLORS[cp.type] ?? CUE_COLORS.user;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label tag
        const tag = cp.label ?? cp.type.replace('_', ' ').toUpperCase();
        ctx.fillStyle = color;
        ctx.font = `bold 9px monospace`;
        ctx.fillText(tag, x + 3, 11);
      }
    }

    // ── Playhead
    const playX = (curPos - offsetMs) * pxPerMs;
    if (playX >= 0 && playX <= w) {
      ctx.fillStyle = PLAYHEAD_COLOR;
      ctx.fillRect(playX - 1, 0, 2, h);

      // Diamond head marker
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX + 5, 6);
      ctx.lineTo(playX - 5, 6);
      ctx.closePath();
      ctx.fillStyle = PLAYHEAD_COLOR;
      ctx.fill();
    }

    // ── Deck label
    if (label) {
      const col = label === 'A' ? '#6C63FF' : '#22d3ee';
      ctx.fillStyle = col;
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`DECK ${label}`, 8, h - 8);
    }
  }, [data, bpm, zoomLevel, scrollOffsetMs, label]);

  // rAF animation loop
  useEffect(() => {
    let animating = true;
    const loop = () => {
      if (!animating) return;
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      animating = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [draw]);

  // HiDPI canvas setup
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx?.scale(dpr, dpr);
  }, [width, height]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeek || !data?.duration_ms) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const pxPerMs = zoomLevel ? zoomLevel / 1000 : rect.width / data.duration_ms;
    const ms = x / pxPerMs + scrollOffsetMs;
    onSeek(Math.max(0, Math.min(ms, data.duration_ms)));
  };

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="cursor-pointer block"
      onClick={handleClick}
    />
  );
};

export default WaveformCanvas;
