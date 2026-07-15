import { Container, Graphics, Renderer, Sprite, Texture } from "pixi.js";
import { WORLD_SIZE } from "./config";
import { Rng } from "./rng";

export type PowerupKind = "magnet" | "turbo" | "shield" | "shrink";

export interface PowerupPickup {
  kind: PowerupKind;
  sprite: Sprite;
  ring: Graphics;
  x: number;
  y: number;
  alive: boolean;
  bob: number;
}

const RADIUS = 30;
const COUNT = 4;
const RESPAWN_DELAY = [16, 26] as const;
const KIND_COLOR: Record<PowerupKind, number> = {
  magnet: 0xd94f4f,
  turbo: 0xf2c14e,
  shield: 0x7ee0ff,
  shrink: 0xb06bd9,
};

let cachedTextures: Record<PowerupKind, Texture> | null = null;

/**
 * Power-up pickups (M8, PRD §7 M5): touch to activate. A fixed pool of spots
 * cycles through the four kinds — each pickup respawns a while after it's
 * taken so the map never runs dry, but there's rarely more than a couple up
 * at once.
 */
export class PowerupField {
  readonly container = new Container();
  private readonly pickups: PowerupPickup[] = [];
  private readonly respawnAt: number[] = [];
  private readonly rng: Rng;
  private elapsed = 0;

  constructor(renderer: Renderer, private readonly spawnMaxX: number, rng: Rng) {
    this.rng = rng;
    cachedTextures ??= buildTextures(renderer);
    for (let i = 0; i < COUNT; i++) {
      const kind = KINDS[i % KINDS.length];
      const p = this.spawn(kind);
      this.pickups.push(p);
      this.respawnAt.push(-1);
    }
  }

  private spawn(kind: PowerupKind): PowerupPickup {
    const x = this.rng.range(300, this.spawnMaxX - 100);
    const y = this.rng.range(300, WORLD_SIZE - 300);
    const sprite = new Sprite(cachedTextures![kind]);
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    const ring = new Graphics()
      .circle(0, 0, RADIUS + 10)
      .stroke({ width: 3, color: KIND_COLOR[kind], alpha: 0.5 });
    ring.position.set(x, y);
    this.container.addChild(ring, sprite);
    return { kind, sprite, ring, x, y, alive: true, bob: this.rng.range(0, Math.PI * 2) };
  }

  /** Live pickups for collision checks. */
  active(): PowerupPickup[] {
    return this.pickups.filter((p) => p.alive);
  }

  /** Hide a taken pickup and queue its respawn as a fresh kind/spot. */
  take(p: PowerupPickup): void {
    p.alive = false;
    p.sprite.visible = false;
    p.ring.visible = false;
    const idx = this.pickups.indexOf(p);
    this.respawnAt[idx] = this.elapsed + this.rng.range(RESPAWN_DELAY[0], RESPAWN_DELAY[1]);
  }

  step(dt: number): void {
    this.elapsed += dt;
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      if (p.alive) {
        p.bob += dt * 2.4;
        p.sprite.position.set(p.x, p.y + Math.sin(p.bob) * 4);
        p.sprite.rotation = Math.sin(p.bob * 0.6) * 0.12;
        p.ring.scale.set(1 + Math.sin(p.bob) * 0.06);
        continue;
      }
      if (this.respawnAt[i] >= 0 && this.elapsed >= this.respawnAt[i]) {
        this.respawnAt[i] = -1;
        const kind = this.rng.pick(KINDS);
        const x = this.rng.range(300, this.spawnMaxX - 100);
        const y = this.rng.range(300, WORLD_SIZE - 300);
        p.kind = kind;
        p.x = x;
        p.y = y;
        p.alive = true;
        p.sprite.texture = cachedTextures![kind];
        p.sprite.visible = true;
        p.sprite.position.set(x, y);
        p.ring.clear().circle(0, 0, RADIUS + 10).stroke({ width: 3, color: KIND_COLOR[kind], alpha: 0.5 });
        p.ring.position.set(x, y);
        p.ring.visible = true;
      }
    }
  }
}

const KINDS: PowerupKind[] = ["magnet", "turbo", "shield", "shrink"];

/** Simple bold icon per power-up, baked to a texture once. */
function buildTextures(renderer: Renderer): Record<PowerupKind, Texture> {
  const disc = (color: number) =>
    new Graphics().circle(0, 0, RADIUS).fill({ color, alpha: 0.22 }).circle(0, 0, RADIUS).stroke({
      width: 3,
      color,
      alpha: 0.9,
    });

  const magnet = disc(KIND_COLOR.magnet);
  magnet
    .arc(0, 4, 14, Math.PI, Math.PI * 2)
    .stroke({ width: 9, color: 0xd94f4f })
    .rect(-14, 4, 8, 12)
    .fill(0xf2ede2)
    .rect(6, 4, 8, 12)
    .fill(0xf2ede2)
    .rect(-14, 13, 8, 4)
    .fill(0x8f2b2b)
    .rect(6, 13, 8, 4)
    .fill(0x8f2b2b);

  const turbo = disc(KIND_COLOR.turbo);
  turbo.poly([-4, -16, 8, -2, 0, -2, 6, 16, -10, 0, -2, 0]).fill(0xf2c14e).stroke({
    width: 1.5,
    color: 0xb08628,
  });

  const shield = disc(KIND_COLOR.shield);
  shield
    .poly([0, -16, 13, -9, 13, 4, 0, 17, -13, 4, -13, -9])
    .fill({ color: 0x7ee0ff, alpha: 0.85 })
    .stroke({ width: 2, color: 0x3a9fbf });

  const shrink = disc(KIND_COLOR.shrink);
  shrink
    .circle(0, 0, 11)
    .stroke({ width: 3, color: 0xb06bd9 })
    .moveTo(8, 8)
    .lineTo(15, 15)
    .stroke({ width: 3.5, color: 0xb06bd9 })
    .moveTo(-6, 0)
    .lineTo(6, 0)
    .stroke({ width: 2.5, color: 0xb06bd9 });

  const out: Partial<Record<PowerupKind, Texture>> = {};
  for (const [kind, g] of [
    ["magnet", magnet],
    ["turbo", turbo],
    ["shield", shield],
    ["shrink", shrink],
  ] as [PowerupKind, Graphics][]) {
    out[kind] = renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
  }
  return out as Record<PowerupKind, Texture>;
}
