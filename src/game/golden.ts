import { Container, Graphics } from "pixi.js";
import { Blob } from "./blob";
import { Camera } from "./camera";
import { classForMass, WORLD_SIZE } from "./config";
import { Rng } from "./rng";
import { Sound } from "./sound";
import { TrashField } from "./trash";

export interface GoldenDeps {
  blobs: Blob[];
  field: TrashField;
  rng: Rng;
  sound: Sound;
  camera: Camera;
  popup(msg: string, x: number, y: number, color?: number): void;
  announce(msg: string, dur?: number): void;
  nearPlayer(x: number, y: number): boolean;
}

const BONUS_SCORE = 500;
const TREASURE_COUNT = 6;
const RADIUS = 46;

/**
 * Golden Dumpster (M9, Scrap City only): a once-per-match, map-wide event.
 * It pings the whole map so every bot beelines for the same spot — a
 * guaranteed brawl over a huge score bonus (PRD M9).
 */
export class GoldenDumpster {
  readonly container = new Container();
  private readonly g = new Graphics();
  x = 0;
  y = 0;
  active = false;
  claimed = false;
  private spawnAt: number;
  private pulse = 0;

  constructor(private readonly deps: GoldenDeps, matchTime: number) {
    this.container.addChild(this.g);
    // Fires once, mid-match — early enough to matter, late enough to be a scramble.
    this.spawnAt = matchTime * deps.rng.range(0.42, 0.58);
  }

  step(dt: number, elapsed: number): void {
    if (this.claimed) return;
    if (!this.active) {
      if (elapsed >= this.spawnAt) this.trigger();
      return;
    }
    this.pulse += dt * 5;
    const r = RADIUS + Math.sin(this.pulse) * 5;
    this.g
      .clear()
      .circle(this.x, this.y, r + 30)
      .fill({ color: 0xf2c14e, alpha: 0.15 + Math.sin(this.pulse) * 0.05 })
      .roundRect(this.x - 34, this.y - 30, 68, 56, 6)
      .fill(0xf2c14e)
      .stroke({ width: 4, color: 0xb08628 })
      .roundRect(this.x - 38, this.y - 40, 76, 16, 5)
      .fill(0xffe27a)
      .stroke({ width: 4, color: 0xb08628 });

    for (const b of this.deps.blobs) {
      if (!b.alive) continue;
      if (Math.hypot(b.x - this.x, b.y - this.y) < b.radius + r) {
        this.claim(b);
        break;
      }
    }
  }

  private trigger(): void {
    this.active = true;
    this.x = this.deps.rng.range(600, WORLD_SIZE - 600);
    this.y = this.deps.rng.range(600, WORLD_SIZE - 600);
    this.deps.announce("✨ GOLDEN DUMPSTER SPOTTED!", 2.2);
    this.deps.sound.zoneClear();
  }

  private claim(blob: Blob): void {
    this.claimed = true;
    this.active = false;
    this.g.clear();
    blob.score += BONUS_SCORE;
    blob.grow(blob.mass * 0.18);
    const cls = Math.max(1, classForMass(blob.mass) - 1);
    for (let i = 0; i < TREASURE_COUNT; i++) {
      const ang = this.deps.rng.range(0, Math.PI * 2);
      const d = blob.radius + this.deps.rng.range(60, 200);
      this.deps.field.spawn(cls, this.x + Math.cos(ang) * d, this.y + Math.sin(ang) * d, this.deps.rng);
    }
    if (blob.isPlayer) {
      this.deps.popup(`+${BONUS_SCORE} GOLDEN DUMPSTER!`, blob.x, blob.y - blob.radius - 24, 0xf2c14e);
      this.deps.camera.shake(14);
      this.deps.announce("YOU GRABBED THE GOLD!", 2);
    } else {
      this.deps.announce(`${blob.name.toUpperCase()} GRABBED THE GOLDEN DUMPSTER!`, 2);
      if (this.deps.nearPlayer(this.x, this.y)) this.deps.camera.shake(10);
    }
    this.deps.sound.zoneClear();
  }
}
