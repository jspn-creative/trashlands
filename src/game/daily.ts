import { MatchResult } from "./game";

/** UTC calendar day key, e.g. "2026-07-14" — stable regardless of local timezone at midnight. */
export function dayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** The day key immediately before the given one (for streak continuity checks). */
export function prevDayKey(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return dayKey(d);
}

/** Deterministic string hash → the day's match seed. Same for every player, every retry. */
export function dailySeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface DailyChallenge {
  id: string;
  desc: string;
  check(r: MatchResult): boolean;
}

const TEMPLATES: DailyChallenge[] = [
  { id: "top3", desc: "Finish top 3", check: (r) => !r.zen && r.placement <= 3 },
  { id: "kill1", desc: "Eat a rival blob", check: (r) => r.kills >= 1 },
  { id: "zones2", desc: "Clear 2 cleanup zones", check: (r) => r.zonesCleaned >= 2 },
  { id: "combo3", desc: "Reach a ×3 combo", check: (r) => r.bestCombo >= 3 },
  { id: "score400", desc: "Score 400+", check: (r) => r.score >= 400 },
  { id: "class3", desc: "Grow to Beach Ball size", check: (r) => r.biggestClass >= 3 },
  { id: "fullLives", desc: "Finish with all 3 lives", check: (r) => !r.zen && r.livesLeft >= 3 },
  { id: "clean50", desc: "Clean 50% of the map", check: (r) => r.cleanedPct >= 50 },
  { id: "trash40", desc: "Eat 40 pieces of trash", check: (r) => r.trashEaten >= 40 },
];

/** 3 challenges for the day, picked deterministically so every player sees the same trio. */
export function dailyChallenges(key: string): DailyChallenge[] {
  let state = dailySeed(key);
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  const pool = [...TEMPLATES];
  const picked: DailyChallenge[] = [];
  for (let i = 0; i < 3 && pool.length > 0; i++) {
    picked.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
  }
  return picked;
}
