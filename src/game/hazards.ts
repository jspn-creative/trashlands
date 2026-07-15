import { Container, Graphics } from "pixi.js";
import { Blob } from "./blob";
import { Camera } from "./camera";
import { classForMass, START_MASS, WORLD_SIZE } from "./config";
import { HazardKind } from "./maps";
import { Rng } from "./rng";
import { Sound } from "./sound";
import { TrashField } from "./trash";

/**
 * Hazard framework (M4): hazards shed mass on contact and hit big blobs
 * proportionally harder — the comeback mechanic (PRD M4). Each hazard owns
 * its visuals and is stepped from the fixed-timestep sim.
 */
export interface HazardDeps {
  blobs: Blob[];
  field: TrashField;
  rng: Rng;
  sound: Sound;
  camera: Camera;
  shore: { sandX: number; oceanX: number };
  popup(msg: string, x: number, y: number, color?: number): void;
  announce(msg: string, dur?: number): void;
  nearPlayer(x: number, y: number): boolean;
}

export interface Hazard {
  readonly container: Container;
  step(dt: number): void;
}

export function buildHazard(kind: HazardKind, deps: HazardDeps): Hazard {
  switch (kind) {
    case "wave":
      return new Wave(deps);
    case "seagull":
      return new Seagull(deps);
    case "current":
      return new Current(deps);
    case "jelly":
      return new JellyfishSwarm(deps);
    case "asteroid":
      return new AsteroidField(deps);
    case "ufo":
      return new Ufo(deps);
    case "compactor":
      return new Compactor(deps);
  }
}

/** Fraction of mass a hazard knocks off — grows with size class. */
function hazardShedFraction(blob: Blob): number {
  return 0.04 * classForMass(blob.mass);
}

/** Knock loose mass and drop it as trash the victim (or a rival) can re-eat. */
function hazardShed(deps: HazardDeps, blob: Blob, spreadAngle: number): void {
  if (blob.mass <= START_MASS * 1.5) return;
  const cls = Math.max(1, classForMass(blob.mass) - 1);
  const lost = blob.mass * hazardShedFraction(blob);
  blob.setMass(blob.mass - lost);
  const n = Math.min(3, 1 + Math.floor(lost / 30));
  for (let i = 0; i < n; i++) {
    const ang = spreadAngle + deps.rng.range(-0.9, 0.9);
    const d = blob.radius + deps.rng.range(60, 180);
    deps.field.spawn(cls, blob.x + Math.cos(ang) * d, blob.y + Math.sin(ang) * d, deps.rng);
  }
}

const SWEEP_TIME = 1.5;
const RETREAT_TIME = 2.2;
const TELEGRAPH_TIME = 2;

/** Periodic wave that floods the beach, shoving blobs and washing trash inland. */
export class Wave implements Hazard {
  readonly container = new Container();
  private readonly g = new Graphics();
  private phase: "idle" | "telegraph" | "sweep" | "retreat" = "idle";
  private t = 0;
  private nextIn: number;
  private front = WORLD_SIZE;
  private foamSeed = 0;
  private readonly hit = new Set<Blob>();

  constructor(private readonly deps: HazardDeps) {
    this.container.addChild(this.g);
    this.nextIn = deps.rng.range(9, 14); // first wave arrives early, as a lesson
  }

  step(dt: number): void {
    const { deps } = this;
    const { sandX, oceanX } = deps.shore;
    this.t += dt;
    this.foamSeed += dt * 6;

    if (this.phase === "idle") {
      this.nextIn -= dt;
      if (this.nextIn <= 0) {
        this.phase = "telegraph";
        this.t = 0;
        deps.announce("🌊 WAVE INCOMING!", 1.6);
      }
    } else if (this.phase === "telegraph") {
      if (this.t >= TELEGRAPH_TIME) {
        this.phase = "sweep";
        this.t = 0;
        this.hit.clear();
        deps.sound.wave();
        deps.camera.shake(6);
      }
    } else if (this.phase === "sweep") {
      const prevFront = this.front;
      const k = Math.min(1, this.t / SWEEP_TIME);
      // Ease-out: the wave charges in fast, then stalls at the sand line.
      this.front = WORLD_SIZE - (WORLD_SIZE - sandX) * (1 - Math.pow(1 - k, 2.2));
      this.affectBlobs(dt, true);
      this.washTrash(prevFront);
      if (k >= 1) {
        this.phase = "retreat";
        this.t = 0;
      }
    } else {
      const k = Math.min(1, this.t / RETREAT_TIME);
      this.front = sandX + (WORLD_SIZE - sandX) * k * k;
      this.affectBlobs(dt, false);
      if (k >= 1) {
        this.phase = "idle";
        this.front = WORLD_SIZE;
        this.nextIn = this.deps.rng.range(16, 26);
      }
    }

    this.draw(oceanX);
  }

  /** Push blobs around and shed mass once per wave (on the inbound sweep). */
  private affectBlobs(dt: number, inbound: boolean): void {
    const { deps } = this;
    for (const b of deps.blobs) {
      if (!b.alive || b.x + b.radius < this.front) continue;
      if (inbound) {
        // Smaller blobs get tossed much harder than heavies.
        b.vx -= (46000 / Math.max(20, b.radius)) * dt;
        if (!this.hit.has(b)) {
          this.hit.add(b);
          hazardShed(deps, b, Math.PI); // debris scatters inland
          if (b.isPlayer) {
            deps.camera.shake(9);
            deps.popup("SWEPT!", b.x, b.y - b.radius - 20, 0x8fc4e4);
          }
        }
      } else {
        // The undertow drags gently back toward open water.
        b.vx += 9000 / Math.max(20, b.radius) * dt;
      }
    }
  }

  /** Trash caught by the leading edge gets carried up the beach. */
  private washTrash(prevFront: number): void {
    const { deps } = this;
    for (const item of deps.field.items) {
      if (!item.alive || item.cls >= 4) continue; // dumpsters don't float
      if (item.x >= this.front && item.x < prevFront) {
        deps.field.moveItem(
          item,
          this.front - deps.rng.range(60, 480),
          item.y + deps.rng.range(-140, 140),
        );
      }
    }
  }

  private draw(oceanX: number): void {
    this.g.clear();
    if (this.phase === "idle") return;

    if (this.phase === "telegraph") {
      // Swelling foam line hugging the waterline.
      const pulse = 0.5 + 0.5 * Math.sin(this.foamSeed * 2.4);
      this.g
        .rect(oceanX - 10, 0, 26 + pulse * 22, WORLD_SIZE)
        .fill({ color: 0xf4fbff, alpha: 0.35 + pulse * 0.4 });
      return;
    }

    // Water body from the front edge to the world edge.
    this.g
      .rect(this.front, 0, WORLD_SIZE - this.front, WORLD_SIZE)
      .fill({ color: 0x4f93c4, alpha: 0.55 })
      .rect(this.front, 0, Math.min(180, WORLD_SIZE - this.front), WORLD_SIZE)
      .fill({ color: 0x6fb0d8, alpha: 0.35 });
    // Scalloped foam along the leading edge.
    for (let y = 0; y < WORLD_SIZE; y += 130) {
      const wobble = Math.sin(this.foamSeed + y * 0.02) * 26;
      this.g
        .circle(this.front + wobble, y + 65, 42)
        .fill({ color: 0xf4fbff, alpha: 0.7 });
    }
    this.g
      .rect(this.front - 14, 0, 20, WORLD_SIZE)
      .fill({ color: 0xffffff, alpha: 0.8 });
  }
}

const CURRENT_TELEGRAPH = 1.6;
const CURRENT_ACTIVE = 4.5;

/** A horizontal undertow lane that drags blobs and trash sideways (The Deep End). */
export class Current implements Hazard {
  readonly container = new Container();
  private readonly g = new Graphics();
  private phase: "idle" | "telegraph" | "active" = "idle";
  private t = 0;
  private nextIn: number;
  private dir = 1;
  private y0 = 0;
  private y1 = 0;
  private flow = 0;

  constructor(private readonly deps: HazardDeps) {
    this.container.addChild(this.g);
    this.nextIn = deps.rng.range(8, 13);
  }

  step(dt: number): void {
    const { deps } = this;
    this.t += dt;
    this.flow += dt;

    if (this.phase === "idle") {
      this.nextIn -= dt;
      if (this.nextIn <= 0) {
        this.phase = "telegraph";
        this.t = 0;
        this.dir = deps.rng.next() < 0.5 ? 1 : -1;
        const h = deps.rng.range(850, 1250);
        this.y0 = deps.rng.range(120, WORLD_SIZE - 120 - h);
        this.y1 = this.y0 + h;
        deps.announce("💨 CURRENT!", 1.4);
      }
    } else if (this.phase === "telegraph") {
      if (this.t >= CURRENT_TELEGRAPH) {
        this.phase = "active";
        this.t = 0;
        deps.sound.wave();
      }
    } else {
      // Drag everything in the lane. Small blobs travel; heavies trudge.
      for (const b of deps.blobs) {
        if (!b.alive || b.y < this.y0 - b.radius || b.y > this.y1 + b.radius) continue;
        b.vx += this.dir * (30000 / Math.max(20, b.radius)) * dt;
      }
      for (const item of deps.field.items) {
        if (!item.alive || item.cls >= 4) continue;
        if (item.y < this.y0 || item.y > this.y1) continue;
        deps.field.moveItem(item, item.x + this.dir * 210 * dt, item.y);
      }
      if (this.t >= CURRENT_ACTIVE) {
        this.phase = "idle";
        this.nextIn = deps.rng.range(14, 24);
      }
    }

    this.draw();
  }

  private draw(): void {
    this.g.clear();
    if (this.phase === "idle") return;
    const strength = this.phase === "telegraph" ? 0.4 : 1;
    this.g
      .rect(0, this.y0, WORLD_SIZE, this.y1 - this.y0)
      .fill({ color: 0x9fd8e8, alpha: 0.09 * strength });
    // Streaming dashes show the direction of pull.
    const speed = this.phase === "active" ? 900 : 300;
    for (let row = this.y0 + 90; row < this.y1; row += 170) {
      for (let k = 0; k < 3; k++) {
        const base = (this.flow * speed * this.dir + row * 137 + k * 1400) % (WORLD_SIZE + 300);
        const x = base < 0 ? base + WORLD_SIZE + 300 : base;
        this.g
          .roundRect(x - 150, row - 4, 110, 8, 4)
          .fill({ color: 0xeafcff, alpha: 0.3 * strength });
      }
    }
  }
}

/** Drifting jellyfish — brush one and it stings mass loose (The Deep End). */
export class JellyfishSwarm implements Hazard {
  readonly container = new Container();
  private readonly jellies: {
    view: Container;
    bell: Graphics;
    tentacles: Graphics;
    x: number;
    y: number;
    ang: number;
    phase: number;
  }[] = [];
  private readonly stungCooldown = new Map<Blob, number>();

  constructor(private readonly deps: HazardDeps) {
    for (let i = 0; i < 4; i++) {
      const view = new Container();
      const shadow = new Graphics().ellipse(0, 34, 26, 9).fill({ color: 0x1c150d, alpha: 0.15 });
      const tentacles = new Graphics();
      const bell = new Graphics()
        .ellipse(0, 0, 34, 27)
        .fill({ color: 0xd8a8e8, alpha: 0.82 })
        .stroke({ width: 3, color: 0xa878c0 })
        .ellipse(-9, -8, 10, 7)
        .fill({ color: 0xf2dcf8, alpha: 0.85 })
        .circle(-7, 4, 2.6)
        .fill(0x5a3a70)
        .circle(7, 4, 2.6)
        .fill(0x5a3a70);
      view.addChild(shadow, tentacles, bell);
      this.container.addChild(view);
      this.jellies.push({
        view,
        bell,
        tentacles,
        x: deps.rng.range(400, WORLD_SIZE - 400),
        y: deps.rng.range(400, WORLD_SIZE - 400),
        ang: deps.rng.range(0, Math.PI * 2),
        phase: deps.rng.range(0, Math.PI * 2),
      });
    }
  }

  step(dt: number): void {
    const { deps } = this;
    for (const [blob, cd] of this.stungCooldown) {
      const left = cd - dt;
      if (left <= 0) this.stungCooldown.delete(blob);
      else this.stungCooldown.set(blob, left);
    }

    for (const j of this.jellies) {
      // Lazy drift with gentle heading wander; bounce off the walls.
      j.ang += deps.rng.range(-0.9, 0.9) * dt;
      j.phase += dt * 3;
      j.x += Math.cos(j.ang) * 36 * dt;
      j.y += (Math.sin(j.ang) * 36 + Math.sin(j.phase) * 14) * dt;
      if (j.x < 260 || j.x > WORLD_SIZE - 260) j.ang = Math.PI - j.ang;
      if (j.y < 260 || j.y > WORLD_SIZE - 260) j.ang = -j.ang;
      j.x = Math.max(240, Math.min(WORLD_SIZE - 240, j.x));
      j.y = Math.max(240, Math.min(WORLD_SIZE - 240, j.y));

      const pulse = 1 + Math.sin(j.phase) * 0.08;
      j.view.position.set(j.x, j.y);
      j.bell.scale.set(pulse, 2 - pulse);
      j.tentacles.clear();
      for (let t = 0; t < 4; t++) {
        const tx = -18 + t * 12;
        const swayT = Math.sin(j.phase + t) * 8;
        j.tentacles
          .moveTo(tx, 16)
          .quadraticCurveTo(tx + swayT, 34, tx - swayT * 0.6, 50)
          .stroke({ width: 3.5, color: 0xc490d8, alpha: 0.8 });
      }

      // Sting anyone brushing the bell (short per-blob immunity after).
      for (const b of deps.blobs) {
        if (!b.alive || b.invuln > 0 || this.stungCooldown.has(b)) continue;
        if (Math.hypot(b.x - j.x, b.y - j.y) > b.radius + 38) continue;
        this.stungCooldown.set(b, 2.5);
        const away = Math.atan2(b.y - j.y, b.x - j.x);
        hazardShed(deps, b, away + Math.PI);
        b.vx += Math.cos(away) * 420;
        b.vy += Math.sin(away) * 420;
        if (b.isPlayer) {
          deps.popup("STUNG! ⚡", b.x, b.y - b.radius - 20, 0xd8a8e8);
          deps.camera.shake(8);
          deps.sound.sting();
        } else if (deps.nearPlayer(j.x, j.y)) {
          deps.sound.sting();
        }
      }
    }
  }
}

const GULL_SPEED = 640;

/** A seagull that snatches mass from blobs sitting still — keep moving! */
export class Seagull implements Hazard {
  readonly container = new Container();
  private readonly shadow = new Graphics();
  private readonly bird = new Container();
  private readonly wings = new Graphics();
  private state: "waiting" | "flying" = "waiting";
  private nextIn: number;
  private x = 0;
  private y = 0;
  private dirX = 1;
  private dirY = 0;
  private target: Blob | null = null;
  private stole = false;
  private flap = 0;
  private readonly idleFor = new Map<Blob, number>();

  constructor(private readonly deps: HazardDeps) {
    this.nextIn = deps.rng.range(12, 18);
    this.shadow.ellipse(0, 0, 30, 12).fill({ color: 0x1c150d, alpha: 0.22 });

    const body = new Graphics()
      .ellipse(0, 0, 30, 14)
      .fill(0xf6f9fb)
      .stroke({ width: 2.5, color: 0x9fb0ba })
      .circle(24, -4, 9)
      .fill(0xf6f9fb)
      .stroke({ width: 2.5, color: 0x9fb0ba })
      .poly([32, -4, 44, -1, 32, 2])
      .fill(0xf2a33c)
      .circle(27, -6, 2)
      .fill(0x2f2418)
      .poly([-30, -4, -14, -1, -30, 4])
      .fill(0xd7dfe4);
    this.bird.addChild(body, this.wings);
    this.container.addChild(this.shadow, this.bird);
    this.container.visible = false;
  }

  step(dt: number): void {
    const { deps } = this;

    // Track how long each blob has been loitering.
    for (const b of deps.blobs) {
      if (!b.alive) {
        this.idleFor.delete(b);
        continue;
      }
      const speed = Math.hypot(b.vx, b.vy);
      this.idleFor.set(b, speed < 70 ? (this.idleFor.get(b) ?? 0) + dt : 0);
    }

    if (this.state === "waiting") {
      this.nextIn -= dt;
      if (this.nextIn > 0) return;
      const loafers = deps.blobs.filter((b) => b.alive && (this.idleFor.get(b) ?? 0) > 1.6);
      if (loafers.length === 0) {
        this.nextIn = 3; // check again shortly
        return;
      }
      // Prefer the player when they're loafing — it's their lesson to learn.
      this.target = loafers.find((b) => b.isPlayer) ?? deps.rng.pick(loafers);
      const ang = deps.rng.range(0, Math.PI * 2);
      this.x = this.target.x + Math.cos(ang) * 1500;
      this.y = this.target.y + Math.sin(ang) * 1500;
      this.state = "flying";
      this.stole = false;
      this.container.visible = true;
      deps.sound.squawk();
      if (this.target.isPlayer) deps.popup("🐦 SEAGULL!", this.target.x, this.target.y - this.target.radius - 30, 0xf2a33c);
      return;
    }

    // Flying: home in until the snatch, then carry on straight and away.
    this.flap += dt * 14;
    if (!this.stole && this.target && this.target.alive) {
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const d = Math.hypot(dx, dy);
      this.dirX = dx / Math.max(1, d);
      this.dirY = dy / Math.max(1, d);
      if (d < 60) {
        // Snatch only lands if the victim is still dawdling.
        if ((this.idleFor.get(this.target) ?? 0) > 0.4) {
          hazardShed(deps, this.target, Math.atan2(this.dirY, this.dirX));
          if (this.target.isPlayer) {
            deps.popup("GULLED!", this.target.x, this.target.y - this.target.radius - 20, 0xff5b4d);
            deps.camera.shake(7);
          }
          if (deps.nearPlayer(this.x, this.y)) deps.sound.squawk();
        }
        this.stole = true;
      }
    }
    this.x += this.dirX * GULL_SPEED * dt;
    this.y += this.dirY * GULL_SPEED * dt;

    // Visuals: bird "flies" above its ground shadow; wings beat.
    this.bird.position.set(this.x, this.y - 90);
    this.bird.rotation = Math.atan2(this.dirY, this.dirX) * 0.25;
    this.shadow.position.set(this.x + 26, this.y + 14);
    const w = Math.sin(this.flap) * 16;
    this.wings
      .clear()
      .poly([-4, -6, -22, -20 - w, -34, -10 - w, -8, 2])
      .fill(0xe4ebef)
      .stroke({ width: 2, color: 0x9fb0ba })
      .poly([4, -6, 20, -20 - w, 34, -10 - w, 8, 2])
      .fill(0xffffff)
      .stroke({ width: 2, color: 0x9fb0ba });

    const off = 400;
    if (this.x < -off || this.x > WORLD_SIZE + off || this.y < -off || this.y > WORLD_SIZE + off) {
      this.state = "waiting";
      this.container.visible = false;
      this.target = null;
      this.nextIn = this.deps.rng.range(14, 22);
    }
  }
}

interface Rock {
  view: Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rot: number;
  rotSpeed: number;
}

/** Drifting asteroid field — rocks wrap around the arena; collisions shed mass and bounce. */
export class AsteroidField implements Hazard {
  readonly container = new Container();
  private readonly rocks: Rock[] = [];
  private readonly hitCooldown = new Map<Blob, number>();

  constructor(private readonly deps: HazardDeps) {
    for (let i = 0; i < 7; i++) {
      const r = deps.rng.range(38, 88);
      const view = buildRockGraphic(r, deps.rng);
      this.container.addChild(view);
      const ang = deps.rng.range(0, Math.PI * 2);
      const speed = deps.rng.range(60, 130);
      this.rocks.push({
        view,
        x: deps.rng.range(200, WORLD_SIZE - 200),
        y: deps.rng.range(200, WORLD_SIZE - 200),
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        r,
        rot: deps.rng.range(0, Math.PI * 2),
        rotSpeed: deps.rng.range(-0.6, 0.6),
      });
    }
  }

  step(dt: number): void {
    const { deps } = this;
    for (const [blob, cd] of this.hitCooldown) {
      const left = cd - dt;
      if (left <= 0) this.hitCooldown.delete(blob);
      else this.hitCooldown.set(blob, left);
    }

    for (const rock of this.rocks) {
      rock.x += rock.vx * dt;
      rock.y += rock.vy * dt;
      rock.rot += rock.rotSpeed * dt;
      // Screen-wrap: an asteroid field has no shore to bounce off of.
      const pad = rock.r + 20;
      if (rock.x < -pad) rock.x = WORLD_SIZE + pad;
      else if (rock.x > WORLD_SIZE + pad) rock.x = -pad;
      if (rock.y < -pad) rock.y = WORLD_SIZE + pad;
      else if (rock.y > WORLD_SIZE + pad) rock.y = -pad;
      rock.view.position.set(rock.x, rock.y);
      rock.view.rotation = rock.rot;

      for (const b of deps.blobs) {
        if (!b.alive || b.invuln > 0 || this.hitCooldown.has(b)) continue;
        if (Math.hypot(b.x - rock.x, b.y - rock.y) > b.radius + rock.r) continue;
        this.hitCooldown.set(b, 1.1);
        const away = Math.atan2(b.y - rock.y, b.x - rock.x);
        hazardShed(deps, b, away);
        b.vx += Math.cos(away) * 480;
        b.vy += Math.sin(away) * 480;
        // The rock caroms off too — a glancing shove, not a full physics swap.
        rock.vx -= Math.cos(away) * 35;
        rock.vy -= Math.sin(away) * 35;
        if (b.isPlayer) {
          deps.popup("ROCKED!", b.x, b.y - b.radius - 20, 0xc9a37a);
          deps.camera.shake(9);
          deps.sound.asteroidHit();
        } else if (deps.nearPlayer(rock.x, rock.y)) {
          deps.sound.asteroidHit();
        }
      }
    }
  }
}

const COMPACTOR_TELEGRAPH = 1.6;
const COMPACTOR_SWEEP_TIME = 3.2;

/** A compactor truck that rumbles down a street lane, crushing anything caught underneath (Scrap City). */
export class Compactor implements Hazard {
  readonly container = new Container();
  private readonly g = new Graphics();
  private phase: "idle" | "telegraph" | "sweep" = "idle";
  private t = 0;
  private nextIn: number;
  private dir = 1;
  private y0 = 0;
  private y1 = 0;
  private x = 0;
  private readonly hit = new Set<Blob>();

  constructor(private readonly deps: HazardDeps) {
    this.container.addChild(this.g);
    this.nextIn = deps.rng.range(10, 15);
  }

  step(dt: number): void {
    const { deps } = this;
    this.t += dt;

    if (this.phase === "idle") {
      this.nextIn -= dt;
      if (this.nextIn <= 0) {
        this.phase = "telegraph";
        this.t = 0;
        this.dir = deps.rng.next() < 0.5 ? 1 : -1;
        const h = deps.rng.range(260, 340);
        this.y0 = deps.rng.range(150, WORLD_SIZE - 150 - h);
        this.y1 = this.y0 + h;
        this.x = this.dir > 0 ? -200 : WORLD_SIZE + 200;
        this.hit.clear();
        deps.announce("🚛 COMPACTOR INCOMING!", 1.6);
      }
    } else if (this.phase === "telegraph") {
      if (this.t >= COMPACTOR_TELEGRAPH) {
        this.phase = "sweep";
        this.t = 0;
        deps.sound.wave();
        deps.camera.shake(6);
      }
    } else {
      const speed = (WORLD_SIZE + 400) / COMPACTOR_SWEEP_TIME;
      this.x += this.dir * speed * dt;

      for (const b of deps.blobs) {
        if (!b.alive || this.hit.has(b)) continue;
        if (b.y < this.y0 - b.radius || b.y > this.y1 + b.radius) continue;
        if (Math.abs(b.x - this.x) > 120 + b.radius) continue;
        this.hit.add(b);
        hazardShed(deps, b, this.dir > 0 ? 0 : Math.PI);
        b.vx += this.dir * 520;
        if (b.isPlayer) {
          deps.popup("CRUSHED!", b.x, b.y - b.radius - 20, 0xc9a37a);
          deps.camera.shake(10);
          deps.sound.asteroidHit();
        } else if (deps.nearPlayer(this.x, b.y)) {
          deps.sound.asteroidHit();
        }
      }
      for (const item of deps.field.items) {
        if (!item.alive || item.cls >= 4) continue;
        if (item.y < this.y0 || item.y > this.y1) continue;
        if (Math.abs(item.x - this.x) > 130) continue;
        deps.field.moveItem(item, item.x + this.dir * 220, item.y);
      }

      if (this.x > WORLD_SIZE + 250 || this.x < -250) {
        this.phase = "idle";
        this.nextIn = deps.rng.range(16, 24);
      }
    }

    this.draw();
  }

  private draw(): void {
    this.g.clear();
    if (this.phase === "idle") return;
    const midY = (this.y0 + this.y1) / 2;
    const h = this.y1 - this.y0;
    if (this.phase === "telegraph") {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 14);
      this.g.rect(0, this.y0, WORLD_SIZE, h).fill({ color: 0xe8541e, alpha: 0.08 + pulse * 0.08 });
      return;
    }
    this.g.rect(0, this.y0, WORLD_SIZE, h).fill({ color: 0x4a4a4a, alpha: 0.08 });
    this.g
      .roundRect(this.x - 90, midY - 70, 180, 140, 10)
      .fill(0xd9a441)
      .stroke({ width: 5, color: 0x8a6420 })
      .roundRect(this.x - 90 + (this.dir > 0 ? 130 : 0), midY - 70, 60, 140, 8)
      .fill(0x5a5a5a)
      .rect(this.x - 20, midY - 90, 40, 20)
      .fill({ color: 0xe8541e, alpha: 0.85 });
  }
}

/** Chunky rock silhouette with craters and a rim highlight, baked once per rock. */
function buildRockGraphic(r: number, rng: Rng): Graphics {
  const g = new Graphics();
  const pts: number[] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * rng.range(0.75, 1.05);
    pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.poly(pts).fill(0x6b7280).stroke({ width: 3, color: 0x3f4756 });
  for (let i = 0; i < 4; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const dist = rng.range(0, r * 0.5);
    g.circle(Math.cos(ang) * dist, Math.sin(ang) * dist, rng.range(r * 0.1, r * 0.22)).fill({
      color: 0x545c6b,
      alpha: 0.8,
    });
  }
  g.ellipse(-r * 0.25, -r * 0.3, r * 0.4, r * 0.25).fill({ color: 0x9aa3b0, alpha: 0.35 });
  return g;
}

const UFO_TELEGRAPH = 1.4;
const UFO_BEAM = 3.6;
const UFO_RETREAT = 1.4;
const BEAM_RADIUS = 520;
const BEAM_DRAIN_RADIUS = 95;

/** A saucer that descends, throws a tractor beam, and drains anything caught in it. */
export class Ufo implements Hazard {
  readonly container = new Container();
  private readonly saucer = new Container();
  private readonly beamG = new Graphics();
  private phase: "idle" | "telegraph" | "beam" | "retreat" = "idle";
  private t = 0;
  private nextIn: number;
  private x = 0;
  private y = 0;
  private hum = 0;
  private readonly drainCooldown = new Map<Blob, number>();

  constructor(private readonly deps: HazardDeps) {
    this.nextIn = deps.rng.range(11, 17);
    const body = new Graphics()
      .ellipse(0, 6, 60, 16)
      .fill(0x5a6270)
      .stroke({ width: 3, color: 0x2f3540 })
      .ellipse(0, -4, 34, 24)
      .fill(0x8b95a5)
      .stroke({ width: 3, color: 0x2f3540 })
      .ellipse(0, 6, 44, 8)
      .fill({ color: 0x3a4048, alpha: 0.9 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      body.circle(Math.cos(a) * 44, 8 + Math.sin(a) * 4, 3.5).fill(0xf2e04a);
    }
    this.saucer.addChild(body);
    this.container.addChild(this.beamG, this.saucer);
    this.container.visible = false;
  }

  step(dt: number): void {
    const { deps } = this;
    this.hum += dt;
    for (const [blob, cd] of this.drainCooldown) {
      const left = cd - dt;
      if (left <= 0) this.drainCooldown.delete(blob);
      else this.drainCooldown.set(blob, left);
    }

    if (this.phase === "idle") {
      this.nextIn -= dt;
      if (this.nextIn <= 0) {
        this.phase = "telegraph";
        this.t = 0;
        this.x = deps.rng.range(600, WORLD_SIZE - 600);
        this.y = deps.rng.range(600, WORLD_SIZE - 600);
        this.container.visible = true;
        this.saucer.position.set(this.x, this.y);
        deps.announce("🛸 TRACTOR BEAM INBOUND!", 1.6);
      }
      this.beamG.clear();
      return;
    }

    this.t += dt;
    if (this.phase === "telegraph") {
      if (this.t >= UFO_TELEGRAPH) {
        this.phase = "beam";
        this.t = 0;
        deps.sound.tractorBeam();
        if (deps.nearPlayer(this.x, this.y)) deps.camera.shake(5);
      }
    } else if (this.phase === "beam") {
      for (const b of deps.blobs) {
        if (!b.alive) continue;
        const dx = this.x - b.x;
        const dy = this.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d > BEAM_RADIUS) continue;
        const pull = (1 - d / BEAM_RADIUS) * (24000 / Math.max(20, b.radius));
        b.vx += (dx / Math.max(1, d)) * pull * dt;
        b.vy += (dy / Math.max(1, d)) * pull * dt;
        if (d < BEAM_DRAIN_RADIUS && !this.drainCooldown.has(b)) {
          this.drainCooldown.set(b, 1.0);
          hazardShed(deps, b, Math.atan2(-dy, -dx));
          if (b.isPlayer) {
            deps.popup("BEAMED!", b.x, b.y - b.radius - 20, 0x9ff2f6);
            deps.camera.shake(6);
          }
        }
      }
      if (this.t >= UFO_BEAM) {
        this.phase = "retreat";
        this.t = 0;
      }
    } else {
      if (this.t >= UFO_RETREAT) {
        this.phase = "idle";
        this.container.visible = false;
        this.nextIn = deps.rng.range(16, 24);
      }
    }

    this.draw();
  }

  private draw(): void {
    this.beamG.clear();
    if (this.phase === "idle") return;
    const strength = this.phase === "telegraph" ? 0.35 + 0.25 * Math.sin(this.hum * 8) : 1;
    const radius = this.phase === "telegraph" ? BEAM_DRAIN_RADIUS * 1.4 : BEAM_RADIUS;
    this.beamG
      .poly([
        this.x - 22, this.y - 4,
        this.x + 22, this.y - 4,
        this.x + radius * 0.55, this.y + radius,
        this.x - radius * 0.55, this.y + radius,
      ])
      .fill({ color: 0x9ff2f6, alpha: 0.1 * strength })
      .circle(this.x, this.y + radius, radius * 0.5)
      .fill({ color: 0x9ff2f6, alpha: 0.07 * strength });
    for (let i = 0; i < 3; i++) {
      const t = (this.hum * 1.6 + i / 3) % 1;
      this.beamG
        .circle(this.x, this.y + t * radius, 6 + t * 10)
        .fill({ color: 0xdcfeff, alpha: (1 - t) * 0.5 * strength });
    }
  }
}
