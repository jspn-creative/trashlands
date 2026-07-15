/** League ladder — the difficulty & progression spine (PRD §2.7). */

export const LEAGUES = [
  "Compost",
  "Curbside",
  "Landfill",
  "Scrapheap",
  "Wasteland",
  "Trashlord",
] as const;

/** Leagues 1–6 shipped (M9 added Trashlord). */
export const MAX_LEAGUE = 5;

export const PROMOTE_AT = 10;

/** League points earned/lost per placement (1st..8th). */
const PLACEMENT_POINTS = [5, 4, 3, 1, 0, -1, -2, -3];

export interface LadderResult {
  league: number;
  points: number;
  delta: number;
  promoted: boolean;
  demoted: boolean;
  /** Hit the v1 league cap — "next league coming soon". */
  capped: boolean;
}

export function applyPlacement(league: number, points: number, placement: number): LadderResult {
  const delta = PLACEMENT_POINTS[Math.min(placement, PLACEMENT_POINTS.length) - 1];
  let pts = points + delta;
  let lg = league;
  let promoted = false;
  let demoted = false;
  let capped = false;

  if (pts >= PROMOTE_AT) {
    if (lg < MAX_LEAGUE) {
      lg++;
      pts -= PROMOTE_AT;
      promoted = true;
    } else {
      pts = PROMOTE_AT; // parked at the cap until new leagues ship
      capped = true;
    }
  } else if (pts < 0) {
    if (lg > 0) {
      lg--;
      pts = PROMOTE_AT - 2;
      demoted = true;
    } else {
      pts = 0; // never below Compost
    }
  }

  return { league: lg, points: pts, delta, promoted, demoted, capped };
}

/** Per-league bot difficulty knobs. */
export interface BotTuning {
  /** Seconds between AI decisions. */
  reaction: number;
  /** Bot top-speed relative to the player. */
  speedMult: number;
  /** How far a Hunter looks for prey. */
  huntRange: number;
  /** Seconds at match start during which bots won't hunt the player. */
  graceSeconds: number;
  /** Chance per decision that a bot grazes a mediocre target instead of the best one. */
  sloppiness: number;
  /** Bots' combo multiplier is capped here (the player always reaches ×5). */
  comboCap: number;
  /** Class lead over the player at which a bot starts slacking (rubber-band). */
  lazyLead: number;
}

const BOT_TUNINGS: BotTuning[] = [
  // Compost: a first league you're supposed to win — slow, sloppy, combo-capped.
  {
    reaction: 1.1,
    speedMult: 0.72,
    huntRange: 700,
    graceSeconds: 30,
    sloppiness: 0.4,
    comboCap: 2,
    lazyLead: 1,
  },
  {
    reaction: 0.65,
    speedMult: 0.88,
    huntRange: 1200,
    graceSeconds: 12,
    sloppiness: 0.18,
    comboCap: 3,
    lazyLead: 2,
  },
  // Landfill: sharp bots — the league that gates Boardwalk Dump (M4).
  {
    reaction: 0.45,
    speedMult: 0.96,
    huntRange: 1600,
    graceSeconds: 6,
    sloppiness: 0.08,
    comboCap: 4,
    lazyLead: 2,
  },
  // Scrapheap: near-flawless bots — the league that gates The Deep End (M6).
  {
    reaction: 0.35,
    speedMult: 1.0,
    huntRange: 1900,
    graceSeconds: 5,
    sloppiness: 0.04,
    comboCap: 5,
    lazyLead: 2,
  },
  // Wasteland: elite bots — the league that gates Junk Orbit (M7).
  {
    reaction: 0.28,
    speedMult: 1.04,
    huntRange: 2200,
    graceSeconds: 4,
    sloppiness: 0.02,
    comboCap: 5,
    lazyLead: 2,
  },
  // Trashlord: the top of the ladder — the league that gates Scrap City (M9).
  {
    reaction: 0.22,
    speedMult: 1.08,
    huntRange: 2500,
    graceSeconds: 3,
    sloppiness: 0.01,
    comboCap: 5,
    lazyLead: 2,
  },
];

export function botTuning(league: number): BotTuning {
  return BOT_TUNINGS[Math.min(league, BOT_TUNINGS.length - 1)];
}
