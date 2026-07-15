import { Container, Graphics, Renderer, RenderTexture, Sprite, Texture } from "pixi.js";
import { WORLD_SIZE } from "./config";
import { Rng } from "./rng";

/** Grime render-texture resolution; the sprite is stretched to WORLD_SIZE. */
const RT_SIZE = 1024;
const SCALE = WORLD_SIZE / RT_SIZE;
/** Soft-circle stamp texture radius in pixels. */
const STAMP_R = 64;
const MAX_FLOWERS = 260;

let stampTexture: Texture | null = null;
let flowerTextures: Texture[] | null = null;

/**
 * The cleanup-reveal layer (PRD §3.2): a translucent grime blanket covers the
 * park; every eaten piece of trash erases a soft hole around where it stood,
 * so a well-played match visibly restores the map to clean green. Cleaned
 * spots occasionally sprout a flower for the restoration feel.
 */
export class CleanupLayer {
  readonly container = new Container();
  private readonly rt: RenderTexture;
  private readonly stamp: Sprite;
  private readonly stampWrap = new Container();
  private readonly flowers = new Container();
  private readonly pending: { x: number; y: number; r: number }[] = [];
  private flowerCount = 0;

  constructor(private readonly renderer: Renderer, rng: Rng) {
    stampTexture ??= buildStamp(renderer);
    flowerTextures ??= buildFlowers(renderer);

    this.rt = RenderTexture.create({ width: RT_SIZE, height: RT_SIZE });
    const grime = buildGrime(rng);
    renderer.render({ container: grime, target: this.rt });
    grime.destroy();

    const sprite = new Sprite(this.rt);
    sprite.scale.set(SCALE);
    this.container.addChild(sprite, this.flowers);

    this.stamp = new Sprite(stampTexture);
    this.stamp.anchor.set(0.5);
    this.stamp.blendMode = "erase";
    this.stampWrap.addChild(this.stamp);
  }

  /** Queue a clean spot (world coords/radius); stamps flush once per frame. */
  clean(x: number, y: number, r: number): void {
    this.pending.push({ x, y, r });
  }

  /** Sometimes leave a flower where trash used to be. */
  maybeFlower(x: number, y: number, rng: Rng): void {
    if (rng.next() < 0.3) this.flower(x, y, rng);
  }

  /** A cleaned zone bursts into bloom. */
  flowerBurst(x: number, y: number, radius: number, rng: Rng): void {
    for (let i = 0; i < 9; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const d = rng.range(0, radius * 0.85);
      this.flower(x + Math.cos(ang) * d, y + Math.sin(ang) * d, rng);
    }
  }

  private flower(x: number, y: number, rng: Rng): void {
    if (this.flowerCount >= MAX_FLOWERS || !flowerTextures) return;
    this.flowerCount++;
    const sprite = new Sprite(rng.pick(flowerTextures));
    sprite.anchor.set(0.5);
    sprite.position.set(x + rng.range(-14, 14), y + rng.range(-14, 14));
    sprite.rotation = rng.range(-0.4, 0.4);
    sprite.scale.set(rng.range(0.8, 1.25));
    this.flowers.addChild(sprite);
  }

  /** Erase this frame's queued stamps into the grime texture. */
  flush(): void {
    if (this.pending.length === 0) return;
    for (const p of this.pending) {
      this.stamp.position.set(p.x / SCALE, p.y / SCALE);
      this.stamp.scale.set(p.r / SCALE / STAMP_R);
      this.renderer.render({ container: this.stampWrap, target: this.rt, clear: false });
    }
    this.pending.length = 0;
  }

  /** The render texture is per-match and isn't covered by root.destroy(). */
  destroyTexture(): void {
    this.rt.destroy(true);
  }
}

/** Translucent dirt blanket, drawn once into the render texture. */
function buildGrime(rng: Rng): Graphics {
  const g = new Graphics();
  // Inset past the arena wall so the wall art stays crisp.
  g.rect(12, 12, RT_SIZE - 24, RT_SIZE - 24).fill({ color: 0x77683f, alpha: 0.34 });
  for (let i = 0; i < 150; i++) {
    const r = rng.range(10, 46);
    g.ellipse(
      rng.range(16, RT_SIZE - 16),
      rng.range(16, RT_SIZE - 16),
      r,
      r * rng.range(0.55, 0.9),
    ).fill({ color: 0x574a2c, alpha: rng.range(0.07, 0.18) });
  }
  for (let i = 0; i < 70; i++) {
    const r = rng.range(14, 40);
    g.ellipse(
      rng.range(16, RT_SIZE - 16),
      rng.range(16, RT_SIZE - 16),
      r,
      r * 0.6,
    ).fill({ color: 0x8f7f52, alpha: rng.range(0.08, 0.16) });
  }
  return g;
}

/** Soft-edged white circle used as the erase brush. */
function buildStamp(renderer: Renderer): Texture {
  const g = new Graphics();
  for (let i = 10; i >= 1; i--) {
    g.circle(0, 0, (STAMP_R * i) / 10).fill({ color: 0xffffff, alpha: 0.16 });
  }
  const tex = renderer.generateTexture({ target: g });
  g.destroy();
  return tex;
}

/** Tiny flowers/sprouts left behind on cleaned ground. */
function buildFlowers(renderer: Renderer): Texture[] {
  const daisy = new Graphics();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    daisy.ellipse(Math.cos(a) * 5.5, Math.sin(a) * 5.5, 4, 2.6).fill(0xfdfaf2);
  }
  daisy.circle(0, 0, 3.2).fill(0xf2c14e);

  const tulip = new Graphics()
    .moveTo(0, 10)
    .lineTo(0, 2)
    .stroke({ width: 2, color: 0x55803c })
    .ellipse(-4, 8, 3.5, 2)
    .fill(0x67994a)
    .poly([-4.5, 2, -3, -7, 0, -3, 3, -7, 4.5, 2])
    .fill(0xe06a86)
    .stroke({ width: 1.5, color: 0xb04a64 });

  const sprout = new Graphics()
    .moveTo(0, 8)
    .quadraticCurveTo(-1, 0, -5, -4)
    .stroke({ width: 2.2, color: 0x67994a })
    .moveTo(0, 8)
    .quadraticCurveTo(1, 0, 5, -5)
    .stroke({ width: 2.2, color: 0x7cb35a })
    .ellipse(-5.5, -4.5, 3, 1.8)
    .fill(0x7cb35a)
    .ellipse(5.5, -5.5, 3.2, 2)
    .fill(0x8fc46b);

  const bloom = new Graphics();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    bloom.circle(Math.cos(a) * 4.2, Math.sin(a) * 4.2, 3.2).fill(0xf4a259);
  }
  bloom.circle(0, 0, 2.6).fill(0xa8631f);

  return [daisy, tulip, sprout, bloom].map((g) => {
    const tex = renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  });
}
