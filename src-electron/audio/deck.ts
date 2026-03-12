import { Track } from '../../src/types';

export interface DeckState {
  track_id: string | null;
  title: string;
  artist: string;
  duration_ms: number;
  position_ms: number;
  bpm: number;
  key_camelot: string;
  is_playing: boolean;
  volume: number;
  eq_low: number;   // dB, -12 to +6
  eq_mid: number;
  eq_high: number;
  cue_point_ms: number;
  loop_start_ms: number | null;
  loop_end_ms: number | null;
  loop_active: boolean;
}

export class Deck {
  private currentTrack: Track | null = null;
  private isPlaying = false;
  private positionMs = 0;
  private cuePointMs = 0;
  private loopStartMs: number | null = null;
  private loopEndMs: number | null = null;
  private loopActive = false;
  private volume = 1.0;
  private eqLow = 0;
  private eqMid = 0;
  private eqHigh = 0;

  /** Wall-clock reference when play() was last called */
  private playStartWallMs = 0;
  private playStartPositionMs = 0;
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  async loadTrack(track: Track): Promise<void> {
    this.stopTicker();
    this.currentTrack = track;
    this.positionMs = 0;
    this.cuePointMs = 0;
    this.loopStartMs = null;
    this.loopEndMs = null;
    this.loopActive = false;
    this.isPlaying = false;
    console.log(`[Deck] Loaded: ${track.title}`);
  }

  /** Alias for loadTrack — used by Mixer.loadTrack() */
  async load(track: Track): Promise<void> {
    return this.loadTrack(track);
  }

  play(): void {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.playStartWallMs = Date.now();
    this.playStartPositionMs = this.positionMs;
    this.startTicker();
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.updatePosition();
    this.isPlaying = false;
    this.stopTicker();
  }

  seek(ms: number): void {
    const duration = this.currentTrack?.duration_ms ?? Infinity;
    this.positionMs = Math.max(0, Math.min(ms, duration));
    if (this.isPlaying) {
      // Reset wall-clock reference so position continues correctly
      this.playStartWallMs = Date.now();
      this.playStartPositionMs = this.positionMs;
    }
  }

  /** Jump to CUE point (or set CUE if paused). Standard DJ behaviour. */
  cue(): void {
    if (this.isPlaying) {
      // While playing: jump back to cue and stop (CDJ behaviour)
      this.pause();
      this.seek(this.cuePointMs);
    } else {
      // While paused: set cue point at current position
      this.cuePointMs = this.positionMs;
    }
  }

  setCuePoint(ms: number): void {
    this.cuePointMs = Math.max(0, ms);
  }

  setLoop(startMs: number, endMs: number): void {
    this.loopStartMs = startMs;
    this.loopEndMs = endMs;
    this.loopActive = true;
  }

  toggleLoop(): void {
    this.loopActive = !this.loopActive;
  }

  /** BPM nudge: temporarily speeds up (+) or slows down (-) by a factor. */
  nudgeBpm(factor: number): void {
    // In a real audio engine this would adjust the playback rate on the AudioNode.
    // Here we adjust the effective playback speed multiplier for position tracking.
    // factor: e.g. 1.02 = 2% faster, 0.98 = 2% slower
    this._bpmNudge = Math.max(0.9, Math.min(1.1, factor));
  }
  private _bpmNudge = 1.0;

  setVolume(v: number): void { this.volume = Math.max(0, Math.min(1.5, v)); }
  setEqLow(db: number): void { this.eqLow = Math.max(-12, Math.min(6, db)); }
  setEqMid(db: number): void { this.eqMid = Math.max(-12, Math.min(6, db)); }
  setEqHigh(db: number): void { this.eqHigh = Math.max(-12, Math.min(6, db)); }

  getPosition(): number { return this.positionMs; }

  getState(): DeckState {
    return {
      track_id: this.currentTrack?.track_id ?? null,
      title: this.currentTrack?.title ?? '—',
      artist: this.currentTrack?.artist ?? '—',
      duration_ms: this.currentTrack?.duration_ms ?? 0,
      position_ms: this.positionMs,
      bpm: (this.currentTrack as any)?.bpm ?? 0,
      key_camelot: (this.currentTrack as any)?.key_camelot ?? '—',
      is_playing: this.isPlaying,
      volume: this.volume,
      eq_low: this.eqLow,
      eq_mid: this.eqMid,
      eq_high: this.eqHigh,
      cue_point_ms: this.cuePointMs,
      loop_start_ms: this.loopStartMs,
      loop_end_ms: this.loopEndMs,
      loop_active: this.loopActive,
    };
  }

  // Simplified buffer retrieval for audio engine integration
  getNextSamples(n: number): Float32Array {
    return new Float32Array(n).fill(0);
  }

  private startTicker(): void {
    this.tickInterval = setInterval(() => {
      this.updatePosition();

      // Loop handling
      if (
        this.loopActive &&
        this.loopStartMs !== null &&
        this.loopEndMs !== null &&
        this.positionMs >= this.loopEndMs
      ) {
        this.seek(this.loopStartMs);
      }

      // End of track
      const duration = this.currentTrack?.duration_ms ?? Infinity;
      if (this.positionMs >= duration) {
        this.pause();
        this.positionMs = duration;
      }
    }, 16); // ~60fps
  }

  private stopTicker(): void {
    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private updatePosition(): void {
    if (!this.isPlaying) return;
    const elapsed = (Date.now() - this.playStartWallMs) * this._bpmNudge;
    this.positionMs = this.playStartPositionMs + elapsed;
  }
}
