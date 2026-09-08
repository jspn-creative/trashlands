/**
 * Looping background music beds, one for the menus and one for a live match.
 *
 * Plays through Web Audio rather than `<audio>` on purpose: on iOS a playing `HTMLAudioElement` claims the system "Now Playing" session, putting Trashlands transport controls on the lock screen. Don't reintroduce one here to simplify things.
 *
 * The context belongs to `Sound` and is created on first gesture; never construct a second one, as iOS caps how many a page may keep alive.
 */

import type { Sound } from "./sound";

export type TrackId = "main" | "game";

const TRACK_IDS: TrackId[] = ["main", "game"];

const SRC: Record<TrackId, string> = {
  main: "/audio/bgm-main.mp3",
  game: "/audio/bgm-game.mp3",
};

/** Full-volume level for a bed — well under the SFX so pops still cut through. */
const FULL = 0.38;
/** Multiplier applied while the game is paused. */
const DUCKED = 0.3;
const FADE_MS = 550;

interface TrackState {
  buffer: AudioBuffer | null;
  gain: GainNode | null;
  source: AudioBufferSourceNode | null;
  /** Seconds into the track: the offset a running source started at, or the paused position once stopped. */
  offset: number;
  /** ctx.currentTime when `source` was started; meaningless if source is null. */
  startedAt: number;
  stopTimer: ReturnType<typeof setTimeout> | null;
}

export class Music {
  enabled = true;
  /** Music bed level, 0..1 — driven by the settings stepped slider. */
  volume = 1;

  private readonly sound: Sound;
  private readonly states = new Map<TrackId, TrackState>();
  /** Cached in-flight decode per track, so a second play() can't kick off a duplicate fetch. */
  private readonly loading = new Map<TrackId, Promise<AudioBuffer>>();
  private current: TrackId | null = null;
  private ducked = false;

  constructor(sound: Sound) {
    this.sound = sound;
  }

  private state(track: TrackId): TrackState {
    let st = this.states.get(track);
    if (!st) {
      st = { buffer: null, gain: null, source: null, offset: 0, startedAt: 0, stopTimer: null };
      this.states.set(track, st);
    }
    return st;
  }

  private target(): number {
    return FULL * this.volume * (this.ducked ? DUCKED : 1);
  }

  /** Stepped slider level 0..1; re-ramps the live bed so drags are heard immediately. */
  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (!this.enabled || !this.current) return;
    const st = this.state(this.current);
    if (st.gain) this.fadeGain(st.gain, this.target());
  }

  private ensureGain(track: TrackId, ctx: AudioContext): GainNode {
    const st = this.state(track);
    if (!st.gain) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      st.gain = gain;
    }
    return st.gain;
  }

  /** Cross-fade-safe ramp: cancel anything in flight and re-anchor before ramping. */
  private fadeGain(gain: GainNode, to: number): void {
    const ctx = this.sound.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(Math.min(1, Math.max(0, to)), now + FADE_MS / 1000);
  }

  private loadBuffer(track: TrackId, ctx: AudioContext): Promise<AudioBuffer> {
    const st = this.state(track);
    if (st.buffer) return Promise.resolve(st.buffer);
    let p = this.loading.get(track);
    if (!p) {
      p = fetch(SRC[track])
        .then((res) => res.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .then((decoded) => {
          st.buffer = decoded;
          this.loading.delete(track);
          return decoded;
        })
        .catch((err) => {
          this.loading.delete(track);
          throw err;
        });
      this.loading.set(track, p);
    }
    return p;
  }

  /** How far into the track playback currently is, whether running or paused. */
  private currentOffset(track: TrackId): number {
    const st = this.state(track);
    const ctx = this.sound.context;
    if (!st.source || !ctx || !st.buffer) return st.offset;
    const elapsed = ctx.currentTime - st.startedAt;
    return (st.offset + elapsed) % st.buffer.duration;
  }

  /** Start a track at its remembered position. No-op until the context exists, and never throws. */
  private startTrack(track: TrackId): void {
    const ctx = this.sound.context;
    if (!ctx) return;
    const st = this.state(track);
    if (st.source) return; // already running
    if (!st.buffer) {
      void this.loadBuffer(track, ctx)
        .then(() => {
          // The player may have switched tracks while this decode was in flight.
          if (this.enabled && this.current === track) this.startTrack(track);
        })
        .catch(() => {
          // Fetch/decode failed — silently give up on this track.
        });
      return;
    }
    const gain = this.ensureGain(track, ctx);
    const source = ctx.createBufferSource();
    source.buffer = st.buffer;
    source.loop = true;
    source.connect(gain);
    const offset = st.offset % st.buffer.duration;
    source.start(0, offset);
    st.source = source;
    st.startedAt = ctx.currentTime;
    if (st.stopTimer) {
      clearTimeout(st.stopTimer);
      st.stopTimer = null;
    }
    this.fadeGain(gain, this.target());
  }

  /** Fade a track out, then stop the source and remember where it left off. */
  private stopTrack(track: TrackId): void {
    const st = this.state(track);
    if (!st.source) return;
    if (st.gain) this.fadeGain(st.gain, 0);
    if (st.stopTimer) clearTimeout(st.stopTimer);
    const source = st.source;
    st.stopTimer = setTimeout(() => {
      if (st.source !== source) return; // superseded by a newer start
      st.offset = this.currentOffset(track);
      try {
        source.stop();
      } catch {
        // Already stopped — nothing to clean up.
      }
      st.source = null;
      st.stopTimer = null;
    }, FADE_MS);
  }

  /** Cross-fade to a track. Safe to call repeatedly with the same id; `resume()` covers blocked autoplay. */
  play(track: TrackId): void {
    if (this.current === track) {
      this.resume();
      return;
    }
    const prev = this.current;
    this.current = track;
    if (prev) this.stopTrack(prev);
    if (!this.enabled) return;
    this.startTrack(track);
  }

  /** Retry playback of the current bed — call from a user-gesture handler. */
  resume(): void {
    if (!this.enabled || !this.current) return;
    this.startTrack(this.current);
  }

  /** Drop the volume while paused/backgrounded without losing the position. */
  setDucked(ducked: boolean): void {
    if (this.ducked === ducked) return;
    this.ducked = ducked;
    if (!this.enabled || !this.current) return;
    const st = this.state(this.current);
    if (st.gain) this.fadeGain(st.gain, this.target());
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    const ctx = this.sound.context;
    if (!on) {
      for (const track of TRACK_IDS) {
        const st = this.state(track);
        if (st.source) {
          if (st.stopTimer) {
            clearTimeout(st.stopTimer);
            st.stopTimer = null;
          }
          st.offset = this.currentOffset(track);
          try {
            st.source.stop();
          } catch {
            // Already stopped — nothing to clean up.
          }
          st.source = null;
        }
        if (st.gain && ctx) {
          st.gain.gain.cancelScheduledValues(ctx.currentTime);
          st.gain.gain.setValueAtTime(0, ctx.currentTime);
        }
      }
    } else if (this.current) {
      this.startTrack(this.current);
    }
  }
}
