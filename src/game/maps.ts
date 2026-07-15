import { Graphics } from "pixi.js";
import { WORLD_SIZE } from "./config";
import { Rng } from "./rng";

/** Where Boardwalk Dump's beach and water start (x coords). */
export const SHORE = { sandX: 2650, oceanX: WORLD_SIZE - 360 };

export type HazardKind = "wave" | "seagull" | "current" | "jelly" | "asteroid" | "ufo" | "compactor";

/**
 * Ground extends this far past the walls so the app background never peeks
 * through when a huge blob presses the camera against a world edge.
 */
const APRON = 2000;

export interface MapSpec {
  id: string;
  name: string;
  desc: string;
  /** Highest league ever reached must be ≥ this to play the map. */
  unlockLeague: number;
  zoneNames: string[];
  hazards: HazardKind[];
  /** Trash and zones never spawn beyond this x (keeps them off the ocean). */
  spawnMaxX: number;
  /** Low-traction movement (Junk Orbit): steering responds sluggishly, so blobs skid and drift. */
  drift?: boolean;
  /** Once-per-match map-wide event: a huge score bonus contested by every blob (M9). */
  goldenDumpster?: boolean;
  buildGround(rng: Rng): Graphics;
}

export const MAPS: MapSpec[] = [
  {
    id: "junkyard",
    name: "Junkyard Park",
    desc: "The classic — no hazards",
    unlockLeague: 0,
    zoneNames: [
      "Picnic Spot",
      "Playground",
      "Duck Pond",
      "Parking Lot",
      "Flower Bed",
      "Food Court",
      "Campsite",
      "Old Fountain",
    ],
    hazards: [],
    spawnMaxX: WORLD_SIZE - 80,
    buildGround: buildJunkyard,
  },
  {
    id: "boardwalk",
    name: "Boardwalk Dump",
    desc: "Waves & seagulls — reach Landfill",
    unlockLeague: 2,
    zoneNames: [
      "Tide Pools",
      "Pier End",
      "Snack Shack",
      "Volleyball Court",
      "Dune Path",
      "Lifeguard Post",
      "Arcade Alley",
      "Fishing Dock",
    ],
    hazards: ["wave", "seagull"],
    spawnMaxX: SHORE.oceanX - 60,
    buildGround: buildBoardwalk,
  },
  {
    id: "deepend",
    name: "The Deep End",
    desc: "Currents & jellyfish — reach Scrapheap",
    unlockLeague: 3,
    zoneNames: [
      "Coral Garden",
      "Shipwreck",
      "Kelp Forest",
      "Anchor Point",
      "Eel Grotto",
      "Treasure Cove",
      "Diver's Ledge",
      "Tidal Flats",
    ],
    hazards: ["current", "jelly"],
    spawnMaxX: WORLD_SIZE - 80,
    buildGround: buildDeepEnd,
  },
  {
    id: "junkorbit",
    name: "Junk Orbit",
    desc: "Asteroids, UFOs & drift — reach Wasteland",
    unlockLeague: 4,
    zoneNames: [
      "Satellite Wreck",
      "Debris Belt",
      "Solar Panel Field",
      "Escape Pod",
      "Comet Trail",
      "Scrapyard Ring",
      "Fuel Depot",
      "Meteor Crater",
    ],
    hazards: ["asteroid", "ufo"],
    spawnMaxX: WORLD_SIZE - 80,
    drift: true,
    buildGround: buildJunkOrbit,
  },
  {
    id: "scrapcity",
    name: "Scrap City",
    desc: "Compactors & the Golden Dumpster — reach Trashlord",
    unlockLeague: 5,
    zoneNames: [
      "Scrapyard Gate",
      "Loading Dock",
      "Back Alley",
      "Rooftop Lot",
      "Compactor Row",
      "Freight Yard",
      "Overpass",
      "Salvage Block",
    ],
    hazards: ["compactor"],
    spawnMaxX: WORLD_SIZE - 80,
    goldenDumpster: true,
    buildGround: buildScrapCity,
  },
];

export function mapById(id: string): MapSpec {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

/** Warm park ground: mow-stripes, dirt patches, grass tufts, pebbles, cracks, walled edge. */
function buildJunkyard(rng: Rng): Graphics {
  const W = WORLD_SIZE;
  const g = new Graphics();
  g.rect(-APRON, -APRON, W + APRON * 2, W + APRON * 2).fill(0xb5c078);

  // Diagonal mow-stripes give the field large-scale structure at any zoom.
  const stripe = 560;
  for (let i = -1; i < (W * 2) / stripe + 1; i += 2) {
    g.poly([i * stripe, 0, (i + 1) * stripe, 0, (i + 1) * stripe - W, W, i * stripe - W, W]).fill({
      color: 0xa9b56c,
      alpha: 0.5,
    });
  }

  // Worn dirt patches.
  for (let i = 0; i < 90; i++) {
    const x = rng.range(0, W);
    const y = rng.range(0, W);
    const r = rng.range(60, 200);
    g.ellipse(x, y, r, r * rng.range(0.55, 0.85)).fill({ color: 0xc2b284, alpha: 0.4 });
    g.ellipse(x, y, r * 0.6, r * 0.45).fill({ color: 0xcbbb8d, alpha: 0.35 });
  }

  grassTufts(g, rng, 260, 30, W - 30);

  // Pebbles + cracks.
  for (let i = 0; i < 170; i++) {
    g.ellipse(rng.range(0, W), rng.range(0, W), rng.range(2.5, 6), rng.range(2, 4.5)).fill({
      color: rng.next() < 0.5 ? 0x9a9271 : 0xc9c2a2,
      alpha: 0.7,
    });
  }
  for (let i = 0; i < 26; i++) {
    let x = rng.range(100, W - 100);
    let y = rng.range(100, W - 100);
    g.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += rng.range(-70, 70);
      y += rng.range(-70, 70);
      g.lineTo(x, y);
    }
    g.stroke({ width: 3, color: 0x8f875a, alpha: 0.4 });
  }

  wall(g);
  return g;
}

/** Beach arena: fairground grass → boardwalk planks → sand → surf → open water. */
function buildBoardwalk(rng: Rng): Graphics {
  const W = WORLD_SIZE;
  const { sandX, oceanX } = SHORE;
  const plankX = sandX - 200;
  const g = new Graphics();

  // Fairground grass on the left, a touch more washed-out than the park.
  g.rect(-APRON, -APRON, plankX + APRON, W + APRON * 2).fill(0xaeba7d);
  const stripe = 520;
  for (let i = -1; i < (W * 2) / stripe + 1; i += 2) {
    g.poly([
      i * stripe, 0,
      (i + 1) * stripe, 0,
      (i + 1) * stripe - W, W,
      i * stripe - W, W,
    ]).fill({ color: 0xa2ad70, alpha: 0.5 });
  }
  // Re-mask the stripes off the beach half (sand runs into the aprons too).
  g.rect(plankX, -APRON, W - plankX + APRON, W + APRON * 2).fill(0xe3d29b);
  grassTufts(g, rng, 150, 30, plankX - 40);

  // Trampled paths through the fairground.
  for (let i = 0; i < 40; i++) {
    const x = rng.range(0, plankX);
    const y = rng.range(0, W);
    const r = rng.range(50, 160);
    g.ellipse(x, y, r, r * rng.range(0.5, 0.8)).fill({ color: 0xc2b284, alpha: 0.35 });
  }

  // Boardwalk: weathered planks with gaps and nail heads.
  g.rect(plankX, 0, sandX - plankX, W).fill(0xb08752);
  const plankH = 90;
  for (let y = 0; y < W; y += plankH) {
    const shade = rng.next() < 0.3 ? 0xa47a46 : rng.next() < 0.5 ? 0xb98f59 : 0xac8250;
    g.rect(plankX + 6, y + 4, sandX - plankX - 12, plankH - 8).fill(shade);
    g.moveTo(plankX, y).lineTo(sandX, y).stroke({ width: 5, color: 0x7d5a30, alpha: 0.8 });
    g.circle(plankX + 26, y + plankH / 2, 4).fill(0x6b4c26);
    g.circle(sandX - 26, y + plankH / 2, 4).fill(0x6b4c26);
    if (rng.next() < 0.25) {
      g.moveTo(plankX + rng.range(40, 120), y + rng.range(15, 70))
        .lineTo(plankX + rng.range(130, sandX - plankX - 40), y + rng.range(15, 70))
        .stroke({ width: 2.5, color: 0x8a6537, alpha: 0.7 });
    }
  }

  // Sand: speckles, shells, and a starfish or two.
  for (let i = 0; i < 320; i++) {
    g.circle(rng.range(sandX, oceanX), rng.range(0, W), rng.range(1.5, 4)).fill({
      color: rng.next() < 0.5 ? 0xd4c084 : 0xf0e2b4,
      alpha: 0.8,
    });
  }
  for (let i = 0; i < 26; i++) {
    const x = rng.range(sandX + 60, oceanX - 80);
    const y = rng.range(60, W - 60);
    if (rng.next() < 0.3) {
      // Starfish.
      const s = rng.range(9, 14);
      for (let a = 0; a < 5; a++) {
        const r = (a / 5) * Math.PI * 2 - Math.PI / 2;
        g.moveTo(x, y)
          .lineTo(x + Math.cos(r) * s, y + Math.sin(r) * s)
          .stroke({ width: 5, color: 0xe08a5a });
      }
      g.circle(x, y, 4).fill(0xd97a48);
    } else {
      // Shell. (moveTo first — a bare arc() draws a chord from the previous
      // path point, smearing thin slivers across the whole map.)
      const r = rng.range(6, 11);
      g.moveTo(x - r, y)
        .arc(x, y, r, Math.PI, Math.PI * 2)
        .fill(0xf2e6cd)
        .moveTo(x, y)
        .lineTo(x, y - 8)
        .stroke({ width: 1.5, color: 0xcbb591, alpha: 0.8 });
    }
  }
  // Wet sand at the waterline.
  g.rect(oceanX - 90, 0, 90, W).fill({ color: 0xc9b47e, alpha: 0.85 });

  // Ocean: layered blues with drifting streaks and a foam edge.
  g.rect(oceanX, -APRON, W - oceanX + APRON, W + APRON * 2).fill(0x4f93c4);
  g.rect(oceanX + 120, -APRON, W - oceanX - 120 + APRON, W + APRON * 2).fill({
    color: 0x3f7fae,
    alpha: 0.9,
  });
  for (let i = 0; i < 60; i++) {
    const x = rng.range(oceanX + 20, W - 20);
    const y = rng.range(20, W - 20);
    g.moveTo(x, y)
      .lineTo(x + rng.range(30, 90), y)
      .stroke({ width: 3.5, color: 0x8fc4e4, alpha: 0.6 });
  }
  for (let y = 0; y < W; y += 46) {
    g.circle(oceanX + rng.range(-4, 10), y + rng.range(0, 30), rng.range(5, 10)).fill({
      color: 0xf4fbff,
      alpha: 0.75,
    });
  }

  wall(g);
  return g;
}

/** Sunken seabed: murky sand, kelp stands, coral clumps, rocks, caustic light. */
function buildDeepEnd(rng: Rng): Graphics {
  const W = WORLD_SIZE;
  const g = new Graphics();
  g.rect(-APRON, -APRON, W + APRON * 2, W + APRON * 2).fill(0x6592a0);

  // Caustic light bands — big soft diagonal ellipses of brighter water.
  for (let i = 0; i < 26; i++) {
    const x = rng.range(0, W);
    const y = rng.range(0, W);
    g.ellipse(x, y, rng.range(240, 520), rng.range(90, 190)).fill({
      color: 0x8fc0c9,
      alpha: 0.13,
    });
  }
  // Deep pockets.
  for (let i = 0; i < 40; i++) {
    const r = rng.range(90, 260);
    g.ellipse(rng.range(0, W), rng.range(0, W), r, r * rng.range(0.5, 0.8)).fill({
      color: 0x46707e,
      alpha: 0.35,
    });
  }
  // Sandy patches.
  for (let i = 0; i < 55; i++) {
    const r = rng.range(70, 200);
    g.ellipse(rng.range(0, W), rng.range(0, W), r, r * rng.range(0.55, 0.8)).fill({
      color: 0x8aa694,
      alpha: 0.3,
    });
  }

  // Kelp stands: wavy vertical fronds in loose clumps.
  for (let c = 0; c < 34; c++) {
    const cx = rng.range(120, W - 120);
    const cy = rng.range(120, W - 120);
    const fronds = rng.int(3, 6);
    for (let f = 0; f < fronds; f++) {
      const x = cx + rng.range(-70, 70);
      const y = cy + rng.range(-40, 40);
      const h = rng.range(60, 130);
      const sway = rng.range(10, 24);
      const col = rng.next() < 0.5 ? 0x3f7a52 : 0x4e8a5c;
      g.moveTo(x, y)
        .quadraticCurveTo(x + sway, y - h * 0.5, x - sway * 0.4, y - h)
        .stroke({ width: rng.range(5, 9), color: col, alpha: 0.85 });
      g.circle(x - sway * 0.4, y - h, 4).fill({ color: col, alpha: 0.85 });
    }
  }

  // Coral clumps: pink/orange bobbles on rock bases.
  for (let i = 0; i < 30; i++) {
    const x = rng.range(100, W - 100);
    const y = rng.range(100, W - 100);
    const col = rng.next() < 0.5 ? 0xd97a6a : 0xc95a8a;
    g.ellipse(x, y + 12, 34, 12).fill({ color: 0x46707e, alpha: 0.5 });
    for (let b = 0; b < 5; b++) {
      const bx = x + rng.range(-24, 24);
      const by = y + rng.range(-14, 8);
      g.circle(bx, by, rng.range(7, 14)).fill({ color: col, alpha: 0.9 });
    }
    g.circle(x - 8, y - 12, 4).fill({ color: 0xf0b8a8, alpha: 0.9 });
  }

  // Rocks + tiny drifting bubbles.
  for (let i = 0; i < 90; i++) {
    const x = rng.range(0, W);
    const y = rng.range(0, W);
    const r = rng.range(6, 18);
    g.ellipse(x, y, r, r * 0.7)
      .fill(0x5a7d88)
      .ellipse(x - r * 0.25, y - r * 0.25, r * 0.5, r * 0.3)
      .fill({ color: 0x7fa3ad, alpha: 0.8 });
  }
  for (let i = 0; i < 160; i++) {
    g.circle(rng.range(0, W), rng.range(0, W), rng.range(2, 5)).stroke({
      width: 1.5,
      color: 0xd8f0f4,
      alpha: rng.range(0.25, 0.55),
    });
  }

  wall(g);
  return g;
}

/** Zero-g scrapyard: starfield, nebula haze, debris clusters, drifting satellites. */
function buildJunkOrbit(rng: Rng): Graphics {
  const W = WORLD_SIZE;
  const g = new Graphics();
  g.rect(-APRON, -APRON, W + APRON * 2, W + APRON * 2).fill(0x0b0e1c);

  // Nebula haze — big soft color washes.
  const nebulaColors = [0x3a2a5c, 0x1f3a52, 0x4a2038];
  for (let i = 0; i < 14; i++) {
    const x = rng.range(0, W);
    const y = rng.range(0, W);
    g.ellipse(x, y, rng.range(300, 700), rng.range(200, 500)).fill({
      color: rng.pick(nebulaColors),
      alpha: 0.16,
    });
  }

  // Starfield: three depths for a little parallax texture.
  for (let i = 0; i < 500; i++) {
    g.circle(rng.range(-APRON, W + APRON), rng.range(-APRON, W + APRON), rng.range(0.6, 1.4)).fill({
      color: 0xffffff,
      alpha: rng.range(0.3, 0.7),
    });
  }
  for (let i = 0; i < 120; i++) {
    const r = rng.range(1.6, 3);
    g.circle(rng.range(0, W), rng.range(0, W), r).fill({ color: 0xdce8ff, alpha: rng.range(0.6, 0.95) });
    if (rng.next() < 0.3) {
      g.circle(rng.range(0, W), rng.range(0, W), r * 2.4).fill({ color: 0xdce8ff, alpha: 0.08 });
    }
  }

  // Scrap-metal debris clusters (hull plating, girders) drifting in the field.
  for (let c = 0; c < 26; c++) {
    const cx = rng.range(150, W - 150);
    const cy = rng.range(150, W - 150);
    for (let p = 0; p < rng.int(2, 4); p++) {
      const x = cx + rng.range(-90, 90);
      const y = cy + rng.range(-60, 60);
      const w = rng.range(30, 70);
      const h = rng.range(14, 30);
      const rot = rng.range(0, Math.PI);
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const corners: number[] = [];
      for (const [lx, ly] of [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2],
      ]) {
        corners.push(x + lx * cos - ly * sin, y + lx * sin + ly * cos);
      }
      g.poly(corners).fill({ color: rng.next() < 0.5 ? 0x4a5568 : 0x394152, alpha: 0.55 });
    }
  }

  // Faint orbital ring lanes for a sense of motion structure.
  for (let i = 0; i < 4; i++) {
    const r = 700 + i * 520;
    g.circle(W / 2, W / 2, r).stroke({ width: 2, color: 0x6fa8dc, alpha: 0.05 });
  }

  forcefieldWall(g);
  return g;
}

/** Downtown grid: sidewalk blocks, asphalt streets with dashed lines, alley grime. */
function buildScrapCity(rng: Rng): Graphics {
  const W = WORLD_SIZE;
  const g = new Graphics();
  g.rect(-APRON, -APRON, W + APRON * 2, W + APRON * 2).fill(0x8a8a86);

  const block = 640;
  const street = 110;
  const cells = Math.ceil(W / block) + 1;
  for (let bx = 0; bx < cells; bx++) {
    for (let by = 0; by < cells; by++) {
      g.rect(bx * block, by * block, block - street, block - street).fill({
        color: 0x9c9c94,
        alpha: 0.55,
      });
    }
  }
  for (let bx = 0; bx <= cells; bx++) {
    const x = bx * block - street / 2;
    g.rect(x - street / 2, -APRON, street, W + APRON * 2).fill({ color: 0x4a4a48, alpha: 0.6 });
    for (let y = 0; y < W; y += 70) {
      g.rect(x - 4, y, 8, 36).fill({ color: 0xe8d24a, alpha: 0.7 });
    }
  }
  for (let by = 0; by <= cells; by++) {
    const y = by * block - street / 2;
    g.rect(-APRON, y - street / 2, W + APRON * 2, street).fill({ color: 0x4a4a48, alpha: 0.6 });
    for (let x = 0; x < W; x += 70) {
      g.rect(x, y - 4, 36, 8).fill({ color: 0xe8d24a, alpha: 0.7 });
    }
  }

  // Manhole covers.
  for (let i = 0; i < 60; i++) {
    g.circle(rng.range(0, W), rng.range(0, W), rng.range(10, 16)).stroke({
      width: 2.5,
      color: 0x3a3a38,
      alpha: 0.5,
    });
  }
  // Pavement cracks.
  for (let i = 0; i < 26; i++) {
    let x = rng.range(100, W - 100);
    let y = rng.range(100, W - 100);
    g.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += rng.range(-70, 70);
      y += rng.range(-70, 70);
      g.lineTo(x, y);
    }
    g.stroke({ width: 3, color: 0x2f2f2d, alpha: 0.35 });
  }
  // Alley grime where scrap piles up.
  for (let i = 0; i < 40; i++) {
    const r = rng.range(50, 140);
    g.ellipse(rng.range(0, W), rng.range(0, W), r, r * rng.range(0.5, 0.75)).fill({
      color: 0x2f2a24,
      alpha: 0.18,
    });
  }

  wall(g);
  return g;
}

function grassTufts(g: Graphics, rng: Rng, count: number, minX: number, maxX: number): void {
  for (let i = 0; i < count; i++) {
    const x = rng.range(minX, maxX);
    const y = rng.range(30, WORLD_SIZE - 30);
    const s = rng.range(5, 10);
    const col = rng.next() < 0.5 ? 0x8ba14f : 0x99ad5c;
    g.moveTo(x, y)
      .lineTo(x - s * 0.5, y - s)
      .moveTo(x, y)
      .lineTo(x, y - s * 1.25)
      .moveTo(x, y)
      .lineTo(x + s * 0.5, y - s)
      .stroke({ width: 2.5, color: col, alpha: 0.85 });
  }
}

/** Two-tone arena wall: outer dark rim + inner lit face + soft inner shadow. */
function wall(g: Graphics): void {
  const W = WORLD_SIZE;
  g.rect(0, 0, W, W).stroke({ width: 46, color: 0x4a3418, alignment: 1 });
  g.rect(10, 10, W - 20, W - 20).stroke({ width: 18, color: 0x6b4c26, alignment: 1 });
  g.rect(30, 30, W - 60, W - 60).stroke({ width: 26, color: 0x1c150d, alpha: 0.12, alignment: 1 });
}

/** Glowing cyan energy-field boundary for the orbital arena. */
function forcefieldWall(g: Graphics): void {
  const W = WORLD_SIZE;
  g.rect(0, 0, W, W).stroke({ width: 60, color: 0x0d3f52, alignment: 1 });
  g.rect(0, 0, W, W).stroke({ width: 10, color: 0x5fe0e8, alpha: 0.85, alignment: 1 });
  g.rect(14, 14, W - 28, W - 28).stroke({ width: 4, color: 0x9ff2f6, alpha: 0.5, alignment: 1 });
  g.rect(40, 40, W - 80, W - 80).stroke({ width: 30, color: 0x5fe0e8, alpha: 0.08, alignment: 1 });
}
