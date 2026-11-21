/**
 * Procedural Web Audio API sound synthesizer for soap bubble pops.
 * Zero external audio files; pitch and resonance scale naturally with bubble radius.
 */
export class BubbleAudio {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted: boolean;
  private lastPlayTime = 0;

  constructor(muted = false) {
    this.muted = muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /**
   * Call on any user interaction so browsers unlock the AudioContext cleanly.
   */
  unlock(): void {
    if (this.muted || typeof window === 'undefined') return;
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume();
    }
  }

  playPop(radius: number, cause: 'click' | 'collision'): void {
    if (this.muted || typeof window === 'undefined') return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    // Slight rate-limit prevents harsh clipping if many bubbles pop on the exact same millisecond
    if (now - this.lastPlayTime < 0.018) return;
    this.lastPlayTime = now;

    // Larger bubbles sound deeper & fuller; small bubbles sound higher & crisper
    const sizeNorm = Math.max(0, Math.min(1, (radius - 24) / 72));
    const baseFreq = 560 - sizeNorm * 310 + (Math.random() - 0.5) * 35;
    const duration = 0.042 + sizeNorm * 0.028;
    const gainLevel = (cause === 'click' ? 0.14 : 0.095) * (0.85 + sizeNorm * 0.25);

    // 1. Classic bubble-bloop upward pitch chirp
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 2.25, now + duration);

    oscGain.gain.setValueAtTime(0.0001, now);
    oscGain.gain.linearRampToValueAtTime(gainLevel, now + 0.004);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.01);

    // 2. Crisp short filtered noise snap (soap film tearing)
    if (this.noiseBuffer) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1900 - sizeNorm * 650, now);
      filter.Q.setValueAtTime(2.4, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(gainLevel * 0.52, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.016);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      noise.start(now);
      noise.stop(now + 0.02);
    }
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.noiseBuffer = null;
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      this.ctx = new AudioCtx();
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
      return this.ctx;
    } catch {
      return null;
    }
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 0.04);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }
}
