/**
 * AudioRenderer — bridges Web Audio API-style playback for the DJ engine.
 * In production this would integrate with CPAL via native Node addon.
 * Current implementation is a functional skeleton that tracks state
 * so the mixer UI always has something to respond to.
 */
export class AudioRenderer {
    private playing: boolean = false;
    private positionMs: number = 0;
    private volume: number = 1.0;
    private intervalHandle: ReturnType<typeof setInterval> | null = null;
    private startTime: number | null = null;
    private startPosition: number = 0;
    private durationMs: number = 0;

    /** Called when a track buffer is ready. Duration helps bound position. */
    load(durationMs: number): void {
        this.stop();
        this.durationMs = durationMs;
        this.positionMs = 0;
    }

    play(): void {
        if (this.playing) return;
        this.playing = true;
        this.startTime = Date.now();
        this.startPosition = this.positionMs;

        // Advance position in real-time so UI polls can read it
        this.intervalHandle = setInterval(() => {
            if (!this.playing || this.startTime === null) return;
            this.positionMs = this.startPosition + (Date.now() - this.startTime);
            if (this.durationMs > 0 && this.positionMs >= this.durationMs) {
                this.stop();
            }
        }, 50);
    }

    pause(): void {
        if (!this.playing) return;
        this.playing = false;
        if (this.intervalHandle) clearInterval(this.intervalHandle);
        this.intervalHandle = null;
    }

    stop(): void {
        this.playing = false;
        this.positionMs = 0;
        this.startTime = null;
        if (this.intervalHandle) clearInterval(this.intervalHandle);
        this.intervalHandle = null;
    }

    seek(ms: number): void {
        this.positionMs = Math.max(0, Math.min(ms, this.durationMs));
        if (this.playing) {
            this.startPosition = this.positionMs;
            this.startTime = Date.now();
        }
    }

    setVolume(v: number): void {
        this.volume = Math.max(0, Math.min(1, v));
    }

    getPosition(): number {
        return this.positionMs;
    }

    isPlaying(): boolean {
        return this.playing;
    }

    getVolume(): number {
        return this.volume;
    }

    /**
     * Returns a dummy stereo audio buffer for scaffolding.
     * Replace with actual CPAL/Web Audio Node output in native integration.
     */
    getNextSamples(sampleCount: number): Float32Array {
        return new Float32Array(sampleCount).fill(0);
    }
}
