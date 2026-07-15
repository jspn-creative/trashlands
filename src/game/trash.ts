import { Container, Graphics, Renderer, Sprite, Texture } from "pixi.js";
import { WORLD_SIZE } from "./config";
import { Rng } from "./rng";

export interface TrashItem {
  sprite: Sprite;
  x: number;
  y: number;
  radius: number;
  cls: number;
  mass: number;
  points: number;
  alive: boolean;
  /** Index into TrashField.zones, or -1 when outside every zone. */
  zone: number;
}

/** A marked cleanup zone — empty it of trash for a score bonus (PRD §2.6). */
export interface Zone {
  name: string;
  x: number;
  y: number;
  radius: number;
  total: number;
  remaining: number;
  bonus: number;
  cleaned: boolean;
}

interface TrashSpec {
  cls: number;
  mass: number;
  points: number;
  radius: number;
  count: number;
}

/**
 * Total spawned mass (~9,270) slightly exceeds the Landslide threshold (9,000),
 * so a perfect clear of the map reaches the final size class.
 */
const SPECS: TrashSpec[] = [
  { cls: 1, mass: 1.5, points: 1, radius: 7, count: 520 },
  { cls: 2, mass: 6, points: 5, radius: 13, count: 260 },
  { cls: 3, mass: 24, points: 20, radius: 24, count: 120 },
  { cls: 4, mass: 90, points: 80, radius: 42, count: 45 },
];

/** Representative names per class, for "biggest thing eaten" on results. */
export const CLASS_LABELS = ["Bottle Cap", "Soda Can", "Trash Bag", "Dumpster"];

const CELL = 160;
/** Kept small so the first trash is on-screen at spawn, even on phones. */
const SPAWN_CLEAR_RADIUS = 150;

const ZONE_COUNT = 6;
const ZONE_RADIUS = 330;

export class TrashField {
  readonly items: TrashItem[] = [];
  readonly zones: Zone[] = [];
  private readonly grid = new Map<string, TrashItem[]>();
  private readonly texturesByClass: Texture[][];
  private readonly layer: Container;

  constructor(
    renderer: Renderer,
    layer: Container,
    rng: Rng,
    private readonly zoneNames: string[],
    private readonly spawnMaxX: number,
  ) {
    // Textures are cached across matches (a fresh Game is built per match).
    cachedTextures ??= buildTextures(renderer);
    this.texturesByClass = cachedTextures;
    this.layer = layer;
    this.spawnAll(layer, rng);
  }

  /** Drop a single item into the world mid-match (skirmish shedding). */
  spawn(cls: number, x: number, y: number, rng: Rng): void {
    const spec = SPECS[Math.min(Math.max(cls, 1), SPECS.length) - 1];
    x = Math.max(60, Math.min(WORLD_SIZE - 60, x));
    y = Math.max(60, Math.min(WORLD_SIZE - 60, y));

    const sprite = new Sprite(rng.pick(this.texturesByClass[spec.cls - 1]));
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    sprite.rotation = rng.range(0, Math.PI * 2);
    this.layer.addChild(sprite);

    const item: TrashItem = {
      sprite,
      x,
      y,
      radius: spec.radius,
      cls: spec.cls,
      mass: spec.mass,
      points: spec.points,
      alive: true,
      // Skirmish drops never join zones — a cleaned zone stays cleaned.
      zone: -1,
    };
    this.items.push(item);
    this.cellFor(x, y).push(item);
  }

  private spawnAll(layer: Container, rng: Rng): void {
    const cx = WORLD_SIZE / 2;
    const cy = WORLD_SIZE / 2;

    // Cluster centers make routing through dense pockets rewarding.
    const clusters: { x: number; y: number }[] = [];
    for (let i = 0; i < 40; i++) {
      clusters.push({
        x: rng.range(200, this.spawnMaxX - 120),
        y: rng.range(200, WORLD_SIZE - 200),
      });
    }

    // Promote well-spaced clusters to named cleanup zones, then weight those
    // centers extra so zones read as the densest trash pockets on the map.
    const names = [...this.zoneNames];
    for (const c of clusters) {
      if (this.zones.length >= ZONE_COUNT) break;
      if (Math.hypot(c.x - cx, c.y - cy) < 750) continue;
      if (c.x < 500 || c.x > this.spawnMaxX - 400 || c.y < 500 || c.y > WORLD_SIZE - 500) continue;
      if (this.zones.some((z) => Math.hypot(z.x - c.x, z.y - c.y) < 950)) continue;
      this.zones.push({
        name: names.splice(rng.int(0, names.length - 1), 1)[0],
        x: c.x,
        y: c.y,
        radius: ZONE_RADIUS,
        total: 0,
        remaining: 0,
        bonus: 0,
        cleaned: false,
      });
    }
    for (const z of this.zones) {
      clusters.push({ x: z.x, y: z.y }, { x: z.x, y: z.y });
    }

    const zonePoints = this.zones.map(() => 0);

    for (const spec of SPECS) {
      for (let i = 0; i < spec.count; i++) {
        let x: number;
        let y: number;
        // ~65% of trash spawns in clusters, the rest scatters uniformly.
        // Big trash (class 4) always scatters so it reads as landmarks.
        if (spec.cls < 4 && rng.next() < 0.65) {
          const c = rng.pick(clusters);
          const ang = rng.range(0, Math.PI * 2);
          const dist = rng.range(0, 220);
          x = c.x + Math.cos(ang) * dist;
          y = c.y + Math.sin(ang) * dist;
        } else {
          x = rng.range(80, this.spawnMaxX);
          y = rng.range(80, WORLD_SIZE - 80);
        }
        x = Math.max(80, Math.min(this.spawnMaxX, x));
        y = Math.max(80, Math.min(WORLD_SIZE - 80, y));

        // Keep the player's spawn point clear.
        if (Math.hypot(x - cx, y - cy) < SPAWN_CLEAR_RADIUS + spec.radius) {
          i--;
          continue;
        }

        const texture = rng.pick(this.texturesByClass[spec.cls - 1]);
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.position.set(x, y);
        sprite.rotation = rng.range(0, Math.PI * 2);
        layer.addChild(sprite);

        let zone = -1;
        for (let z = 0; z < this.zones.length; z++) {
          const zn = this.zones[z];
          if (Math.hypot(x - zn.x, y - zn.y) < zn.radius - spec.radius) {
            zone = z;
            zn.total++;
            zn.remaining++;
            zonePoints[z] += spec.points;
            break;
          }
        }

        const item: TrashItem = {
          sprite,
          x,
          y,
          radius: spec.radius,
          cls: spec.cls,
          mass: spec.mass,
          points: spec.points,
          alive: true,
          zone,
        };
        this.items.push(item);
        this.cellFor(x, y).push(item);
      }
    }

    // Bonus scales with what the zone held, so big zones pay big.
    for (let z = 0; z < this.zones.length; z++) {
      const bonus = Math.round((zonePoints[z] * 0.8) / 10) * 10;
      this.zones[z].bonus = Math.max(60, Math.min(400, bonus));
    }
  }

  private cellFor(x: number, y: number): TrashItem[] {
    const key = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
    let cell = this.grid.get(key);
    if (!cell) {
      cell = [];
      this.grid.set(key, cell);
    }
    return cell;
  }

  /** All live items whose cell overlaps the query circle. */
  queryCircle(x: number, y: number, r: number, out: TrashItem[]): void {
    out.length = 0;
    const x0 = Math.floor((x - r) / CELL);
    const x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((y - r) / CELL);
    const y1 = Math.floor((y + r) / CELL);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const cell = this.grid.get(`${gx},${gy}`);
        if (!cell) continue;
        for (const item of cell) {
          if (item.alive) out.push(item);
        }
      }
    }
  }

  /** Relocate a live item (wave-washed trash) and keep the spatial grid honest. */
  moveItem(item: TrashItem, x: number, y: number): void {
    const oldCell = this.cellFor(item.x, item.y);
    const idx = oldCell.indexOf(item);
    if (idx >= 0) oldCell.splice(idx, 1);
    item.x = Math.max(70, Math.min(WORLD_SIZE - 70, x));
    item.y = Math.max(70, Math.min(WORLD_SIZE - 70, y));
    item.sprite.position.set(item.x, item.y);
    this.cellFor(item.x, item.y).push(item);

    // A hazard (wave, current) can wash zone trash outside its own circle.
    // Left assigned, it would keep the zone stuck at "N left" forever with
    // a visibly empty ring. Unassign it — the piece just isn't zone trash
    // anymore, same as a skirmish drop.
    if (item.zone >= 0) {
      const zone = this.zones[item.zone];
      if (Math.hypot(item.x - zone.x, item.y - zone.y) > zone.radius - item.radius) {
        zone.remaining--;
        item.zone = -1;
        if (zone.remaining <= 0 && !zone.cleaned) {
          // Nobody ate the last piece — freeze the ring without a payout.
          zone.cleaned = true;
        }
      }
    }
  }

  /**
   * Off-screen culling (PRD §4.2): hide sprites well outside the given world
   * rect so the renderer skips drawing them — matches survive at ~1,000
   * pieces per map, but only a fraction are ever on-screen at once.
   */
  cull(x0: number, y0: number, x1: number, y1: number): void {
    for (const item of this.items) {
      if (!item.alive) continue;
      item.sprite.visible =
        item.x + item.radius >= x0 &&
        item.x - item.radius <= x1 &&
        item.y + item.radius >= y0 &&
        item.y - item.radius <= y1;
    }
  }

  /** Remove an eaten item; returns the zone if this was its last piece of trash. */
  remove(item: TrashItem): Zone | null {
    item.alive = false;
    item.sprite.destroy();
    if (item.zone >= 0) {
      const zone = this.zones[item.zone];
      zone.remaining--;
      if (zone.remaining <= 0 && !zone.cleaned) {
        zone.cleaned = true;
        return zone;
      }
    }
    return null;
  }
}

let cachedTextures: Texture[][] | null = null;

const SHADOW = 0x1c150d;

/** Programmer-art trash, baked to textures once so the field renders as cheap sprites. */
function buildTextures(renderer: Renderer): Texture[][] {
  const cap = new Graphics()
    .ellipse(0.5, 1.5, 7.8, 7)
    .fill({ color: SHADOW, alpha: 0.16 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    cap.circle(Math.cos(a) * 7, Math.sin(a) * 7, 1.6).fill(0xc23c3c);
  }
  cap
    .circle(0, 0, 7)
    .fill(0xd94f4f)
    .stroke({ width: 1.5, color: 0x8f2b2b })
    .circle(0, 0, 4)
    .fill(0xf6efe4)
    .circle(-2, -2, 1.4)
    .fill({ color: 0xffffff, alpha: 0.85 });

  const variants: Graphics[][] = [
    // Class 1 — bottle cap, candy wrapper, gum
    [
      cap,
      new Graphics()
        .ellipse(0.5, 4.5, 9.5, 3.2)
        .fill({ color: SHADOW, alpha: 0.16 })
        .poly([-7, -2, -12, -5.5, -11, 0, -12, 5.5, -7, 2])
        .fill(0xd8447e)
        .poly([7, -2, 12, -5.5, 11, 0, 12, 5.5, 7, 2])
        .fill(0xd8447e)
        .roundRect(-7.5, -5, 15, 10, 4)
        .fill(0xf06a9e)
        .stroke({ width: 1.5, color: 0xa83060 })
        .rect(-2.4, -5, 4.8, 10)
        .fill(0xfdf0d5)
        .circle(-4.5, -2.5, 1.2)
        .fill({ color: 0xffffff, alpha: 0.8 }),
      new Graphics()
        .ellipse(0.5, 4, 7.5, 2.8)
        .fill({ color: SHADOW, alpha: 0.16 })
        .circle(-2.5, 0.5, 4.5)
        .fill(0xe57fd0)
        .circle(2.8, -0.5, 4)
        .fill(0xe57fd0)
        .ellipse(0, 1, 6.2, 4.6)
        .fill(0xe57fd0)
        .stroke({ width: 1.5, color: 0xad4f9c })
        .circle(-2.5, -2, 1.6)
        .fill({ color: 0xffffff, alpha: 0.75 }),
    ],
    // Class 2 — soda can, bottle, takeout box
    [
      new Graphics()
        .ellipse(1, 12.5, 10, 3.6)
        .fill({ color: SHADOW, alpha: 0.18 })
        .roundRect(-8, -12, 16, 24, 4.5)
        .fill(0x5fa8dc)
        .stroke({ width: 2, color: 0x2f6d9c })
        .rect(-8, -12, 16, 3.5)
        .fill(0xc9d6dc)
        .rect(-8, 8.5, 16, 3.5)
        .fill(0xc9d6dc)
        .rect(-8, -5, 16, 10)
        .fill(0xf2ede2)
        .circle(0, 0, 3.6)
        .fill(0xd94f4f)
        .rect(-6.2, -10.5, 2.2, 19)
        .fill({ color: 0xffffff, alpha: 0.5 })
        .ellipse(0, -10.4, 4.5, 1.4)
        .fill(0xdde6ea),
      new Graphics()
        .ellipse(1, 14, 8.5, 3.2)
        .fill({ color: SHADOW, alpha: 0.18 })
        .roundRect(-6.5, -4, 13, 18, 4.5)
        .fill(0x59b56b)
        .stroke({ width: 2, color: 0x2f7c42 })
        .poly([-3, -4, -2.2, -12, 2.2, -12, 3, -4])
        .fill(0x59b56b)
        .roundRect(-3, -15.5, 6, 4.5, 1.5)
        .fill(0xf2c14e)
        .stroke({ width: 1.5, color: 0xb08628 })
        .rect(-6.5, 2, 13, 7)
        .fill(0xf6efe4)
        .rect(-4.6, -3, 1.8, 14)
        .fill({ color: 0xffffff, alpha: 0.55 }),
      new Graphics()
        .ellipse(1, 11, 12, 3.6)
        .fill({ color: SHADOW, alpha: 0.18 })
        .poly([-11, -8, 11, -8, 13, 10, -13, 10])
        .fill(0xf2ede2)
        .stroke({ width: 2, color: 0xb8a58c })
        .poly([-11.8, 2, 12.8, 2, 13, 5, -13, 5])
        .fill(0xd94f4f)
        .moveTo(-6, -8)
        .quadraticCurveTo(0, -16, 6, -8)
        .stroke({ width: 2, color: 0x8f8271 })
        .circle(4, -3, 1.4)
        .fill({ color: 0xffffff, alpha: 0.7 }),
    ],
    // Class 3 — trash bag, tire, traffic cone
    [
      new Graphics()
        .ellipse(2, 16, 22, 6.5)
        .fill({ color: SHADOW, alpha: 0.18 })
        .circle(-9, 4, 12)
        .fill(0x4d5470)
        .circle(9, 5, 11)
        .fill(0x4d5470)
        .ellipse(0, 4, 21, 15)
        .fill(0x565e7e)
        .stroke({ width: 2.5, color: 0x343a52 })
        .poly([-5, -13, -8, -20, -2, -16, 0, -22, 3, -16, 8, -19, 5, -12])
        .fill(0x424866)
        .stroke({ width: 2, color: 0x343a52 })
        .ellipse(-8, -2, 6.5, 4.5)
        .fill({ color: 0x7d86ad, alpha: 0.8 })
        .ellipse(7, 8, 4.5, 3)
        .fill({ color: 0x7d86ad, alpha: 0.5 }),
      (() => {
        const t = new Graphics()
          .ellipse(2, 8, 25, 12)
          .fill({ color: SHADOW, alpha: 0.18 })
          .circle(0, 0, 24)
          .fill(0x3d3d3d)
          .stroke({ width: 2.5, color: 0x222222 });
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          t.moveTo(Math.cos(a) * 19.5, Math.sin(a) * 19.5)
            .lineTo(Math.cos(a) * 23.5, Math.sin(a) * 23.5)
            .stroke({ width: 3, color: 0x252525 });
        }
        t.circle(0, 0, 12)
          .fill(0x9a9a8c)
          .stroke({ width: 2, color: 0x6e6e62 })
          .circle(0, 0, 4.5)
          .fill(0x55554a);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
          t.circle(Math.cos(a) * 8, Math.sin(a) * 8, 1.6).fill(0x6e6e62);
        }
        t.arc(0, 0, 20.5, Math.PI * 1.08, Math.PI * 1.45).stroke({
          width: 4,
          color: 0x5a5a5a,
        });
        return t;
      })(),
      new Graphics()
        .ellipse(2, 24, 22, 5.5)
        .fill({ color: SHADOW, alpha: 0.18 })
        .roundRect(-19, 19, 38, 7, 3)
        .fill(0xe8641c)
        .stroke({ width: 2.5, color: 0xa8430c })
        .poly([-3.5, -23, 3.5, -23, 14, 19, -14, 19])
        .fill(0xf47b28)
        .stroke({ width: 2.5, color: 0xa8430c })
        .poly([-8.2, -4, 8.2, -4, 9.8, 3, -9.8, 3])
        .fill(0xf6efe4)
        .poly([-11, 8, 11, 8, 12.4, 14, -12.4, 14])
        .fill(0xf6efe4)
        .arc(0, -20, 3.2, Math.PI, Math.PI * 2)
        .fill(0xf47b28)
        .poly([-3.5, -20, -8, 0, -5, 0, -1, -20])
        .fill({ color: 0xffffff, alpha: 0.28 }),
    ],
    // Class 4 — dumpster, park bench, fridge
    [
      (() => {
        const g = new Graphics()
          .ellipse(3, 27, 45, 10)
          .fill({ color: SHADOW, alpha: 0.2 })
          .circle(-30, 28, 6)
          .fill(0x2b2b2b)
          .circle(30, 28, 6)
          .fill(0x2b2b2b)
          .roundRect(-42, -22, 84, 50, 6)
          .fill(0x439150)
          .stroke({ width: 3.5, color: 0x27572f })
          .roundRect(-44, -30, 88, 13, 5)
          .fill(0x367a42)
          .stroke({ width: 3.5, color: 0x27572f });
        for (let i = -1; i <= 1; i++) {
          g.roundRect(i * 24 - 8, -12, 16, 32, 3).fill({ color: 0x2f6839, alpha: 0.55 });
        }
        g.roundRect(-12, -27.5, 24, 5, 2.5)
          .fill(0x27572f)
          .rect(-42, -22, 84, 5)
          .fill({ color: 0xffffff, alpha: 0.12 });
        return g;
      })(),
      (() => {
        const g = new Graphics()
          .ellipse(3, 20, 50, 8)
          .fill({ color: SHADOW, alpha: 0.2 })
          .roundRect(-46, 10, 8, 12, 2)
          .fill(0x4a4a4a)
          .roundRect(38, 10, 8, 12, 2)
          .fill(0x4a4a4a);
        for (let i = 0; i < 3; i++) {
          const y = -16 + i * 12;
          g.roundRect(-48, y, 96, 9, 4)
            .fill(0xa8713d)
            .stroke({ width: 2.5, color: 0x6b4423 });
          g.moveTo(-40, y + 4.5)
            .lineTo(30 - i * 12, y + 4.5)
            .stroke({ width: 1.5, color: 0x8a5a30 });
        }
        g.roundRect(-52, -20, 8, 34, 3)
          .fill(0x5a5a5a)
          .stroke({ width: 2, color: 0x3a3a3a })
          .roundRect(44, -20, 8, 34, 3)
          .fill(0x5a5a5a)
          .stroke({ width: 2, color: 0x3a3a3a });
        return g;
      })(),
      new Graphics()
        .ellipse(3, 40, 32, 8)
        .fill({ color: SHADOW, alpha: 0.2 })
        .roundRect(-28, -40, 56, 80, 8)
        .fill(0xe4ebe6)
        .stroke({ width: 3.5, color: 0x9aa8a0 })
        .rect(-28, -14, 56, 3.5)
        .fill(0x9aa8a0)
        .roundRect(20, -34, 4.5, 15, 2)
        .fill(0x7c8a82)
        .roundRect(20, -6, 4.5, 22, 2)
        .fill(0x7c8a82)
        .rect(-24, -40, 6, 80)
        .fill({ color: 0xffffff, alpha: 0.45 })
        .circle(-12, -26, 3.5)
        .fill(0xd94f4f)
        .roundRect(-16, 8, 12, 8, 2)
        .fill(0x5fa8dc),
    ],
  ];

  return variants.map((classVariants) =>
    classVariants.map((g) => {
      const tex = renderer.generateTexture({ target: g, resolution: 2 });
      g.destroy();
      return tex;
    }),
  );
}
