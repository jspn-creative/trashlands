import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { clamp, COMBO_WINDOW, radiusForMass, START_MASS, WORLD_SIZE } from "./config";
import { Rng } from "./rng";

/** Blob body art is drawn once at this radius, then scaled to the live radius. */
const R0 = 100;

interface StuckItem {
  sprite: Sprite;
  angle: number;
  dist: number;
  age: number;
  dur: number;
}

export interface BlobOptions {
  name: string;
  color: number;
  isPlayer: boolean;
  x: number;
  y: number;
  /** Cosmetic skin accent drawn into the rolling layer (player skins, M3). */
  accent?: "none" | "leaves" | "sparkle" | "cracks" | "frost";
}

/** Scale a 24-bit color's channels by f. */
function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

/** One rolling blob — the player and every bot share this body and physics. */
export class Blob {
  readonly container = new Container();
  readonly name: string;
  readonly color: number;
  readonly isPlayer: boolean;

  x: number;
  y: number;
  vx = 0;
  vy = 0;
  mass = START_MASS;
  radius = radiusForMass(START_MASS);
  score = 0;
  kills = 0;
  /** Bot top-speed handicap (1 for the player). */
  speedMult = 1;
  /** Steering responsiveness multiplier — low-traction maps (Junk Orbit) set this <1 for drift/skid. */
  traction = 1;

  alive = true;
  /** Seconds until respawn while dead. */
  respawnIn = 0;
  /** Post-respawn safety window (seconds); can't be eaten while > 0. */
  invuln = 0;
  /** Cooldown between mass-shedding skirmishes. */
  shedCooldown = 0;
  /** Consecutive pickups inside the combo window (drives the score multiplier). */
  combo = 0;
  /** Seconds left before the combo chain breaks. */
  comboTimer = 0;

  /** Power-up timers (M8) — 0 means inactive. */
  magnetTime = 0;
  turboTime = 0;
  shieldTime = 0;

  private readonly shieldRing: Graphics;

  private readonly bodyWrap = new Container();
  private readonly rollWrap = new Container();
  private readonly stuckLayer = new Container();
  private readonly pupils: Graphics;
  private lookX = 0;
  private lookY = 0;
  private roll = 0;
  private pulse = 0;
  private readonly stuck: StuckItem[] = [];

  constructor(rng: Rng, opts: BlobOptions) {
    this.name = opts.name;
    this.color = opts.color;
    this.isPlayer = opts.isPlayer;
    this.x = opts.x;
    this.y = opts.y;

    const dark = shade(opts.color, 0.58);

    // Soft drop shadow grounds the blob on the field.
    const shadow = new Graphics()
      .ellipse(R0 * 0.05, R0 * 0.12, R0 * 1.02, R0 * 0.98)
      .fill({ color: 0x1c150d, alpha: 0.18 });

    const base = new Graphics()
      .circle(0, 0, R0)
      .fill(opts.color)
      .stroke({ width: 7, color: dark });

    // Blotches live in a rotating layer so the blob visibly rolls.
    const blotches = new Graphics();
    for (let i = 0; i < 7; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const dist = rng.range(R0 * 0.12, R0 * 0.6);
      blotches
        .circle(Math.cos(ang) * dist, Math.sin(ang) * dist, rng.range(11, 24))
        .fill({ color: shade(opts.color, 0.78), alpha: 0.75 });
    }
    for (let i = 0; i < 6; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const dist = rng.range(R0 * 0.2, R0 * 0.72);
      blotches
        .circle(Math.cos(ang) * dist, Math.sin(ang) * dist, rng.range(4, 8))
        .fill({ color: shade(opts.color, 1.26), alpha: 0.7 });
    }

    // Dimensional shading: broad top-light, bottom rim shadow, small glint.
    const a0 = Math.PI * 0.12;
    const shading = new Graphics()
      .circle(-R0 * 0.18, -R0 * 0.22, R0 * 0.78)
      .fill({ color: 0xffffff, alpha: 0.08 })
      .circle(-R0 * 0.3, -R0 * 0.34, R0 * 0.3)
      .fill({ color: 0xffffff, alpha: 0.09 })
      .moveTo(Math.cos(a0) * R0 * 0.9, Math.sin(a0) * R0 * 0.9)
      .arc(0, 0, R0 * 0.9, a0, Math.PI * 0.88)
      .stroke({ width: R0 * 0.16, color: dark, alpha: 0.35 });

    // Big friendly eyes; pupils track the roll direction (set in update()).
    const eyeY = -R0 * 0.1;
    const eyeDX = R0 * 0.26;
    const eyes = new Graphics()
      .ellipse(-eyeDX, eyeY, R0 * 0.17, R0 * 0.21)
      .fill(0xffffff)
      .stroke({ width: 4, color: dark, alpha: 0.85 })
      .ellipse(eyeDX, eyeY, R0 * 0.17, R0 * 0.21)
      .fill(0xffffff)
      .stroke({ width: 4, color: dark, alpha: 0.85 });
    this.pupils = new Graphics()
      .circle(-eyeDX, eyeY, R0 * 0.085)
      .fill(0x2f2418)
      .circle(eyeDX, eyeY, R0 * 0.085)
      .fill(0x2f2418)
      .circle(-eyeDX + R0 * 0.03, eyeY - R0 * 0.03, R0 * 0.026)
      .fill(0xffffff)
      .circle(eyeDX + R0 * 0.03, eyeY - R0 * 0.03, R0 * 0.026)
      .fill(0xffffff);

    this.rollWrap.addChild(blotches);
    if (opts.accent && opts.accent !== "none") {
      this.rollWrap.addChild(buildAccent(opts.accent, rng));
    }
    // Shield ring lives in bodyWrap (not rollWrap) so it doesn't spin with the blob.
    this.shieldRing = new Graphics()
      .circle(0, 0, R0 * 1.16)
      .stroke({ width: 7, color: 0x7ee0ff, alpha: 0.85 });
    this.shieldRing.visible = false;
    this.bodyWrap.addChild(shadow, base, this.rollWrap, shading, eyes, this.pupils, this.shieldRing);
    this.container.addChild(this.bodyWrap, this.stuckLayer);
    this.syncScale();
    this.container.position.set(this.x, this.y);
  }

  /** Steer toward dir (vector ≤ 1 length, or null for coasting). Heavier = more momentum. */
  update(dt: number, dir: { x: number; y: number } | null): void {
    if (!this.alive) return;

    const turboMult = this.turboTime > 0 ? 1.6 : 1;
    const maxSpeed = 340 * Math.pow(20 / this.radius, 0.12) * this.speedMult * turboMult;
    const targetVx = dir ? dir.x * maxSpeed : 0;
    const targetVy = dir ? dir.y * maxSpeed : 0;
    const response = clamp(7 * Math.pow(18 / this.radius, 0.4), 2.2, 7) * this.traction;
    const blend = 1 - Math.exp(-response * dt);
    this.vx += (targetVx - this.vx) * blend;
    this.vy += (targetVy - this.vy) * blend;

    this.x = clamp(this.x + this.vx * dt, this.radius, WORLD_SIZE - this.radius);
    this.y = clamp(this.y + this.vy * dt, this.radius, WORLD_SIZE - this.radius);

    const speed = Math.hypot(this.vx, this.vy);
    this.roll += (speed * dt) / this.radius;
    this.rollWrap.rotation = this.roll;
    this.stuckLayer.rotation = this.roll;

    // Pupils glance toward the direction of travel.
    const lookBlend = 1 - Math.exp(-8 * dt);
    this.lookX += ((this.vx / maxSpeed) - this.lookX) * lookBlend;
    this.lookY += ((this.vy / maxSpeed) - this.lookY) * lookBlend;
    this.pupils.position.set(this.lookX * R0 * 0.055, this.lookY * R0 * 0.055);

    this.pulse *= Math.exp(-6 * dt);
    if (this.invuln > 0) {
      this.invuln = Math.max(0, this.invuln - dt);
      this.container.alpha = 0.55 + 0.3 * Math.sin(this.invuln * 22);
    } else {
      this.container.alpha = 1;
    }
    if (this.shedCooldown > 0) this.shedCooldown -= dt;
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    if (this.magnetTime > 0) this.magnetTime = Math.max(0, this.magnetTime - dt);
    if (this.turboTime > 0) this.turboTime = Math.max(0, this.turboTime - dt);
    if (this.shieldTime > 0) {
      this.shieldTime = Math.max(0, this.shieldTime - dt);
      this.shieldRing.visible = true;
      this.shieldRing.alpha = 0.6 + 0.4 * Math.sin(this.shieldTime * 14);
      this.shieldRing.scale.set(1 + Math.sin(this.shieldTime * 14) * 0.03);
    } else {
      this.shieldRing.visible = false;
    }
    this.syncScale();
    this.container.position.set(this.x, this.y);

    for (let i = this.stuck.length - 1; i >= 0; i--) {
      const s = this.stuck[i];
      s.age += dt;
      const t = s.age / s.dur;
      if (t >= 1) {
        s.sprite.destroy();
        this.stuck.splice(i, 1);
        continue;
      }
      const d = s.dist * (1 - t * 0.85);
      s.sprite.position.set(Math.cos(s.angle) * d, Math.sin(s.angle) * d);
      s.sprite.scale.set(1 - t);
    }
  }

  /** Consume trash: gain mass now, show the item riding the surface briefly. */
  absorb(mass: number, texture: Texture, worldAngle: number): void {
    this.grow(mass);
    this.combo++;
    this.comboTimer = COMBO_WINDOW;

    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.rotation = worldAngle;
    // Store the angle in the rolling layer's frame so the item rolls with the blob.
    const angle = worldAngle - this.roll;
    const dist = this.radius * 0.8;
    sprite.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist);
    this.stuckLayer.addChild(sprite);
    this.stuck.push({ sprite, angle, dist, age: 0, dur: 0.9 });
  }

  /** Gain mass with a pulse but no surface sprite (e.g. eating a blob). */
  grow(mass: number): void {
    this.setMass(this.mass + mass);
    this.pulse = 0.07;
  }

  setMass(mass: number): void {
    this.mass = Math.max(START_MASS * 0.5, mass);
    this.radius = radiusForMass(this.mass);
    this.syncScale();
  }

  /** Eaten: hide and start the respawn countdown. */
  kill(respawnDelay: number): void {
    this.alive = false;
    this.container.visible = false;
    this.respawnIn = respawnDelay;
    this.vx = 0;
    this.vy = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.magnetTime = 0;
    this.turboTime = 0;
    this.shieldTime = 0;
  }

  respawnAt(x: number, y: number, mass: number): void {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.setMass(mass);
    this.alive = true;
    this.invuln = 2.5;
    this.container.visible = true;
    this.container.position.set(x, y);
  }

  private syncScale(): void {
    this.bodyWrap.scale.set((this.radius / R0) * (1 + this.pulse));
  }
}

/** Skin flourishes: little shapes scattered across the rolling surface. */
function buildAccent(accent: NonNullable<BlobOptions["accent"]>, rng: Rng): Graphics {
  const g = new Graphics();

  if (accent === "leaves") {
    for (let i = 0; i < 6; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const dist = rng.range(R0 * 0.15, R0 * 0.68);
      const x = Math.cos(ang) * dist;
      const y = Math.sin(ang) * dist;
      const rot = rng.range(0, Math.PI);
      const s = rng.range(0.8, 1.3);
      g.ellipse(x, y, 14 * s, 6.5 * s)
        .fill(rng.next() < 0.5 ? 0x8fbf5a : 0x769e45)
        .moveTo(x - Math.cos(rot) * 12 * s, y - Math.sin(rot) * 12 * s)
        .lineTo(x + Math.cos(rot) * 12 * s, y + Math.sin(rot) * 12 * s)
        .stroke({ width: 2, color: 0x55803c, alpha: 0.85 });
    }
  } else if (accent === "sparkle") {
    for (let i = 0; i < 9; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const dist = rng.range(R0 * 0.1, R0 * 0.72);
      const x = Math.cos(ang) * dist;
      const y = Math.sin(ang) * dist;
      const s = rng.range(4, 9);
      g.poly([x, y - s, x + s * 0.28, y - s * 0.28, x + s, y, x + s * 0.28, y + s * 0.28, x, y + s, x - s * 0.28, y + s * 0.28, x - s, y, x - s * 0.28, y - s * 0.28])
        .fill({ color: rng.next() < 0.5 ? 0xffffff : 0xffe9a8, alpha: 0.9 });
    }
  } else if (accent === "cracks") {
    for (let i = 0; i < 5; i++) {
      const ang = rng.range(0, Math.PI * 2);
      let x = Math.cos(ang) * R0 * 0.2;
      let y = Math.sin(ang) * R0 * 0.2;
      g.moveTo(x, y);
      for (let s = 0; s < 3; s++) {
        x += Math.cos(ang + rng.range(-0.7, 0.7)) * R0 * 0.22;
        y += Math.sin(ang + rng.range(-0.7, 0.7)) * R0 * 0.22;
        g.lineTo(x, y);
      }
      g.stroke({ width: 7, color: 0xe8541e, alpha: 0.95 });
    }
    // Hot cores inside the cracks.
    for (let i = 0; i < 4; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const dist = rng.range(R0 * 0.15, R0 * 0.6);
      g.circle(Math.cos(ang) * dist, Math.sin(ang) * dist, rng.range(3, 6)).fill(0xffb03a);
    }
  } else {
    // frost — pale crystal crosses.
    for (let i = 0; i < 7; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const dist = rng.range(R0 * 0.12, R0 * 0.7);
      const x = Math.cos(ang) * dist;
      const y = Math.sin(ang) * dist;
      const s = rng.range(6, 12);
      const rot = rng.range(0, Math.PI);
      for (let a = 0; a < 3; a++) {
        const r = rot + (a / 3) * Math.PI;
        g.moveTo(x - Math.cos(r) * s, y - Math.sin(r) * s)
          .lineTo(x + Math.cos(r) * s, y + Math.sin(r) * s)
          .stroke({ width: 2.5, color: 0x9ecfe4, alpha: 0.9 });
      }
    }
  }
  return g;
}
