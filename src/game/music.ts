/**
 * Looping background music beds — one for the menus, one for a live match.
 *
 * These are streamed through <audio> rather than the Sound WebAudio graph: the
 * tracks are megabytes of mp3 and decoding them into memory up front would cost
 * far more than the tiny synth blips do.
 */

export type TrackId = "main" | "game";

const SRC: Record<TrackId, string> = {
  main: "/audio/bgm-main.mp3",
  game: "/audio/bgm-game.mp3",
};

/** Full-volume level for a bed — well under the SFX so pops still cut through. */
const FULL = 0.38;
/** Multiplier applied while the game is paused. */
const DUCKED = 0.3;
const FADE_MS = 550;
const STEP_MS = 40;

export class Music {
  enabled = true;

  private els = new Map<TrackId, HTMLAudioElement>();
  private fades = new Map<TrackId, ReturnType<typeof setInterval>>();
  private current: TrackId | null = null;
  private ducked = false;

  private el(track: TrackId): HTMLAudioElement {
    let el = this.els.get(track);
    if (!el) {
      el = new Audio(SRC[track]);
      el.loop = true;
      el.preload = "auto";
      el.volume = 0;
      this.els.set(track, el);
    }
    return el;
  }

  private target(): number {
    return this.ducked ? FULL * DUCKED : FULL;
  }

  /** Ramp one element's volume, pausing it when it lands on silence. */
  private fade(track: TrackId, to: number): void {
    const el = this.el(track);
    clearInterval(this.fades.get(track));
    const from = el.volume;
    const steps = Math.max(1, Math.round(FADE_MS / STEP_MS));
    let i = 0;
    const id = setInterval(() => {
      i++;
      const v = from + (to - from) * (i / steps);
      el.volume = Math.min(1, Math.max(0, v));
      if (i >= steps) {
        clearInterval(id);
        this.fades.delete(track);
        if (to === 0) el.pause();
      }
    }, STEP_MS);
    this.fades.set(track, id);
  }

  /**
   * Cross-fade to a track. Safe to call repeatedly with the same id.
   * Autoplay is blocked until the first gesture — `resume()` retries then.
   */
  play(track: TrackId): void {
    if (this.current === track) {
      this.resume();
      return;
    }
    const prev = this.current;
    this.current = track;
    if (prev) this.fade(prev, 0);
    if (!this.enabled) return;
    const el = this.el(track);
    void el.play().catch(() => {
      // Blocked pre-gesture; Input's first-interaction hook calls resume().
    });
    this.fade(track, this.target());
  }

  /** Retry playback of the current bed — call from a user-gesture handler. */
  resume(): void {
    if (!this.enabled || !this.current) return;
    const el = this.el(this.current);
    if (el.paused) {
      void el.play().catch(() => {});
      this.fade(this.current, this.target());
    }
  }

  /** Drop the volume while paused/backgrounded without losing the position. */
  setDucked(ducked: boolean): void {
    if (this.ducked === ducked) return;
    this.ducked = ducked;
    if (this.enabled && this.current) this.fade(this.current, this.target());
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      for (const [track, el] of this.els) {
        clearInterval(this.fades.get(track));
        this.fades.delete(track);
        el.pause();
        el.volume = 0;
      }
    } else if (this.current) {
      this.play(this.current);
    }
  }
}
