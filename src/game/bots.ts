import { Blob } from "./blob";
import { classForMass, WORLD_SIZE } from "./config";
import { BotTuning } from "./league";
import { Rng } from "./rng";
import { TrashField, TrashItem } from "./trash";

export type Persona = "grazer" | "hunter" | "sweeper" | "opportunist";

export interface BotContext {
  blobs: Blob[];
  field: TrashField;
  tuning: BotTuning;
  /** Seconds since match start (for the anti-frustration grace window). */
  elapsed: number;
  /** Shared scratch buffer for trash queries. */
  buf: TrashItem[];
  /** Golden Dumpster (M9): when active, every bot beelines for it — a guaranteed brawl. */
  golden?: { active: boolean; x: number; y: number };
}

type Target =
  | { kind: "point"; x: number; y: number }
  | { kind: "item"; item: TrashItem }
  | { kind: "blob"; blob: Blob }
  | null;

/**
 * Drives one bot blob. Bots use the exact same movement/eating rules as the
 * player — this class only produces a steering direction (PRD §2.5).
 */
export class BotDriver {
  private tickIn = 0;
  private target: Target = null;
  private fleeX = 0;
  private fleeY = 0;
  private fleeing = false;
  private stuckTime = 0;
  /** Sweeper/Opportunist: the zone index currently being worked, or -1. */
  private zoneGoal = -1;

  constructor(
    readonly blob: Blob,
    readonly persona: Persona,
    private readonly rng: Rng,
  ) {}

  /** Steering direction for this frame (unit-ish vector or null). */
  update(dt: number, ctx: BotContext): { x: number; y: number } | null {
    const b = this.blob;
    if (!b.alive) return null;

    // Rubber-band: a bot far enough ahead of the player slacks off, so one
    // lucky grazer can't vacuum the whole map (runaway-leader guard).
    const player = ctx.blobs[0];
    const lead = classForMass(b.mass) - classForMass(player.mass);
    const lazy = lead >= ctx.tuning.lazyLead;

    this.tickIn -= dt;
    if (this.tickIn <= 0 || this.targetGone()) {
      this.tickIn = ctx.tuning.reaction * this.rng.range(0.7, 1.3) * (lazy ? 2.2 : 1);
      this.think(ctx);
    }

    // Escape when pinned against an obstacle or wall.
    if (Math.hypot(b.vx, b.vy) < 14 && !this.fleeing) {
      this.stuckTime += dt;
      if (this.stuckTime > 1.2) {
        this.stuckTime = 0;
        this.target = this.randomPoint();
      }
    } else {
      this.stuckTime = 0;
    }

    if (this.fleeing) return norm(this.fleeX, this.fleeY);

    const t = this.target;
    if (!t) return null;
    const tx = t.kind === "point" ? t.x : t.kind === "item" ? t.item.x : t.blob.x;
    const ty = t.kind === "point" ? t.y : t.kind === "item" ? t.item.y : t.blob.y;
    const dx = tx - b.x;
    const dy = ty - b.y;
    if (t.kind === "point" && Math.hypot(dx, dy) < 160) {
      this.target = this.randomPoint();
    }
    const dir = norm(dx, dy);
    if (dir && lazy) {
      dir.x *= 0.78;
      dir.y *= 0.78;
    }
    return dir;
  }

  private targetGone(): boolean {
    const t = this.target;
    if (!t) return true;
    if (t.kind === "item") return !t.item.alive;
    if (t.kind === "blob") return !t.blob.alive;
    return false;
  }

  private think(ctx: BotContext): void {
    const b = this.blob;
    const myCls = classForMass(b.mass);

    // 1) Survival: flee anything that can eat us. Workmanlike personas (grazer,
    // sweeper) are extra skittish; the two hunting personas take more risk.
    const fleeRange = this.persona === "grazer" || this.persona === "sweeper" ? 640 : 460;
    let fx = 0;
    let fy = 0;
    let threatened = false;
    for (const o of ctx.blobs) {
      if (o === b || !o.alive) continue;
      if (classForMass(o.mass) < myCls + 1) continue;
      const dx = b.x - o.x;
      const dy = b.y - o.y;
      const d = Math.hypot(dx, dy);
      const range = b.radius + o.radius + fleeRange;
      if (d < range && d > 0.001) {
        const w = 1 - d / range;
        fx += (dx / d) * w;
        fy += (dy / d) * w;
        threatened = true;
      }
    }
    this.fleeing = threatened;
    if (threatened) {
      // Steer away, biased toward the map center so bots don't corner themselves.
      fx += ((WORLD_SIZE / 2 - b.x) / WORLD_SIZE) * 0.4;
      fy += ((WORLD_SIZE / 2 - b.y) / WORLD_SIZE) * 0.4;
      this.fleeX = fx;
      this.fleeY = fy;
      return;
    }

    // 1.5) A live Golden Dumpster outranks everything but survival — its
    // "map-wide ping" means every bot converges on it at once (PRD M9).
    if (ctx.golden?.active) {
      this.target = { kind: "point", x: ctx.golden.x, y: ctx.golden.y };
      return;
    }

    // 2) Hunters chase the nearest edible blob; Opportunists prefer the
    // weakest one in range over the closest — they pick off the wounded
    // rather than whoever happens to be nearby (PRD §2.5).
    if (this.persona === "hunter" || this.persona === "opportunist") {
      let prey: Blob | null = null;
      let preyDist = ctx.tuning.huntRange;
      let preyMass = Infinity;
      for (const o of ctx.blobs) {
        if (o === b || !o.alive || o.invuln > 0) continue;
        if (classForMass(o.mass) > myCls - 1) continue;
        if (o.isPlayer && ctx.elapsed < ctx.tuning.graceSeconds) continue;
        const d = Math.hypot(o.x - b.x, o.y - b.y);
        if (d > ctx.tuning.huntRange) continue;
        if (this.persona === "opportunist") {
          if (o.mass < preyMass) {
            preyMass = o.mass;
            prey = o;
          }
        } else if (d < preyDist) {
          preyDist = d;
          prey = o;
        }
      }
      if (prey) {
        this.target = { kind: "blob", blob: prey };
        return;
      }
    }

    // 3) Sweepers and Opportunists work a specific zone instead of grazing
    // wherever's convenient. Sweepers methodically pick the nearest zone
    // and grind it out; Opportunists swoop in on zones someone else has
    // already half-cleared — stealing the finishing blow and its bonus.
    if (this.persona === "sweeper" || this.persona === "opportunist") {
      const zones = ctx.field.zones;
      const goal = this.zoneGoal >= 0 ? zones[this.zoneGoal] : null;
      if (!goal || goal.cleaned || goal.remaining <= 0) {
        let bestZone = -1;
        let bestScore = -Infinity;
        for (let z = 0; z < zones.length; z++) {
          const zn = zones[z];
          if (zn.cleaned || zn.remaining <= 0) continue;
          const d = Math.hypot(zn.x - b.x, zn.y - b.y);
          const score =
            this.persona === "opportunist"
              ? (zn.total - zn.remaining) / zn.total - d / 6000
              : -d;
          if (score > bestScore) {
            bestScore = score;
            bestZone = z;
          }
        }
        this.zoneGoal = bestZone;
      }
      const zone = this.zoneGoal >= 0 ? zones[this.zoneGoal] : null;
      if (zone) {
        ctx.field.queryCircle(b.x, b.y, 700, ctx.buf);
        let best: TrashItem | null = null;
        let bestScore = 0;
        for (const item of ctx.buf) {
          if (item.cls > myCls || item.zone !== this.zoneGoal) continue;
          const d = Math.hypot(item.x - b.x, item.y - b.y);
          const s = item.points / (80 + d);
          if (s > bestScore) {
            bestScore = s;
            best = item;
          }
        }
        if (best) {
          this.target = { kind: "item", item: best };
          return;
        }
        // Not yet in range of the zone's trash — head for its center.
        this.target = { kind: "point", x: zone.x, y: zone.y };
        return;
      }
    }

    // 4) Graze: best value-per-distance edible trash nearby. Low-league bots
    // are sloppy — sometimes they shuffle off to whatever edible thing is
    // around instead of the best pick, which also breaks their combo chains.
    ctx.field.queryCircle(b.x, b.y, 700, ctx.buf);
    const sloppy = this.rng.next() < ctx.tuning.sloppiness;
    let best: TrashItem | null = null;
    let bestScore = 0;
    for (const item of ctx.buf) {
      if (item.cls > myCls) continue;
      if (sloppy) {
        if (!best || this.rng.next() < 0.2) best = item;
        continue;
      }
      const d = Math.hypot(item.x - b.x, item.y - b.y);
      const s = item.points / (80 + d);
      if (s > bestScore) {
        bestScore = s;
        best = item;
      }
    }
    if (best) {
      this.target = { kind: "item", item: best };
      return;
    }

    // 5) Nothing nearby: wander to a fresh spot.
    if (!this.target || this.target.kind !== "point") {
      this.target = this.randomPoint();
    }
  }

  private randomPoint(): Target {
    return {
      kind: "point",
      x: this.rng.range(300, WORLD_SIZE - 300),
      y: this.rng.range(300, WORLD_SIZE - 300),
    };
  }
}

function norm(x: number, y: number): { x: number; y: number } | null {
  const len = Math.hypot(x, y);
  if (len < 0.0001) return null;
  return { x: x / len, y: y / len };
}
