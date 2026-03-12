import { Deck } from './deck';
import { ThreeBandEQ } from './dsp';
import { MixerState, MixerStatus } from '../../src/types';

export class Mixer {
  public deckA = new Deck();
  public deckB = new Deck();
  private crossfader = 0.5;
  private masterVolume = 1.0;
  private peakLevelDb = -Infinity;
  private status: MixerStatus = 'stopped';

  getState(): MixerState {
    const stateA = this.deckA.getState();
    const stateB = this.deckB.getState();

    // Determine overall status
    if (stateA.is_playing || stateB.is_playing) {
      this.status = (stateA.is_playing && stateB.is_playing) ? 'transitioning' : 'playing';
    } else {
      this.status = 'stopped';
    }

    // Simulate peak meter from volume levels
    const cfA = Math.cos(this.crossfader * Math.PI / 2);
    const cfB = Math.sin(this.crossfader * Math.PI / 2);
    const aPow = stateA.is_playing ? stateA.volume * cfA : 0;
    const bPow = stateB.is_playing ? stateB.volume * cfB : 0;
    const combined = Math.sqrt(aPow * aPow + bPow * bPow);
    this.peakLevelDb = combined > 0 ? 20 * Math.log10(combined * this.masterVolume) : -Infinity;

    return {
      status: this.status,
      deck_a: stateA,
      deck_b: stateB,
      crossfader: this.crossfader,
      peak_level_db: isFinite(this.peakLevelDb) ? this.peakLevelDb : -60,
    };
  }

  setCrossfader(value: number) {
    this.crossfader = Math.max(0, Math.min(1, value));
  }

  setMasterVolume(v: number) {
    this.masterVolume = Math.max(0, Math.min(2, v));
  }

  play(deck: 'A' | 'B') {
    (deck === 'A' ? this.deckA : this.deckB).play();
  }

  pause(deck: 'A' | 'B') {
    (deck === 'A' ? this.deckA : this.deckB).pause();
  }

  seek(deck: 'A' | 'B', ms: number) {
    (deck === 'A' ? this.deckA : this.deckB).seek(ms);
  }

  cue(deck: 'A' | 'B') {
    (deck === 'A' ? this.deckA : this.deckB).cue();
  }

  setCuePoint(deck: 'A' | 'B', ms: number) {
    (deck === 'A' ? this.deckA : this.deckB).setCuePoint(ms);
  }

  setEQ(deck: 'A' | 'B', band: 'low' | 'mid' | 'high', db: number) {
    const d = deck === 'A' ? this.deckA : this.deckB;
    if (band === 'low') d.setEqLow(db);
    else if (band === 'mid') d.setEqMid(db);
    else d.setEqHigh(db);
  }

  setVolume(deck: 'A' | 'B', v: number) {
    (deck === 'A' ? this.deckA : this.deckB).setVolume(v);
  }

  nudgeBpm(deck: 'A' | 'B', factor: number) {
    (deck === 'A' ? this.deckA : this.deckB).nudgeBpm(factor);
  }

  setLoop(deck: 'A' | 'B', startMs: number, endMs: number) {
    (deck === 'A' ? this.deckA : this.deckB).setLoop(startMs, endMs);
  }

  toggleLoop(deck: 'A' | 'B') {
    (deck === 'A' ? this.deckA : this.deckB).toggleLoop();
  }

  /** Load a track object onto a deck (0=A, 1=B) */
  async loadTrack(deckIndex: number, track: any): Promise<void> {
    const deck = deckIndex === 0 ? this.deckA : this.deckB;
    await deck.load(track);
  }
}
