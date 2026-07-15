/** Simulation runs on a fixed timestep; rendering is per-frame. */
export const STEP = 1 / 60;

export const WORLD_SIZE = 4200;
export const START_MASS = 10;

export const MATCH_TIME = 120;
export const PLAYER_LIVES = 3;
export const BOT_COUNT = 7;

/** Seconds a pickup keeps the combo chain alive. */
export const COMBO_WINDOW = 2;

/** Score multiplier for a running pickup chain: ×1 → ×5 (PRD §2.6). */
export function comboMult(chain: number): number {
  return Math.min(5, 1 + Math.floor(chain / 5));
}

/** Blob size classes. A blob can eat trash of its class or below. */
export const CLASSES = [
  { name: "Dust Bunny", minMass: 0 },
  { name: "Soccer Ball", minMass: 40 },
  { name: "Beach Ball", minMass: 160 },
  { name: "Boulder", minMass: 600 },
  { name: "Wrecking Ball", minMass: 2400 },
  { name: "Landslide", minMass: 9000 },
] as const;

export function classForMass(mass: number): number {
  let cls = 1;
  for (let i = 0; i < CLASSES.length; i++) {
    if (mass >= CLASSES[i].minMass) cls = i + 1;
  }
  return cls;
}

/** 0..1 progress from the current class threshold to the next (1 at max class). */
export function classProgress(mass: number): number {
  const cls = classForMass(mass);
  if (cls >= CLASSES.length) return 1;
  const lo = CLASSES[cls - 1].minMass;
  const hi = CLASSES[cls].minMass;
  return Math.min(1, (mass - lo) / (hi - lo));
}

/** Logarithmic-feel growth: doubling mass grows radius ~23%. */
export function radiusForMass(mass: number): number {
  return 18 * Math.pow(mass / START_MASS, 0.3);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
