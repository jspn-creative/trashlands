import { MatchResult } from "./game";

/**
 * Meta progression (M3): XP accrues forever, cosmetics unlock at fixed XP
 * thresholds — no purchase choices, no currency. First unlock lands after
 * ~3 typical matches (PRD M3 exit criteria). Cosmetic only, by design.
 */

export type UnlockKind = "skin" | "trail" | "sound";

export interface Unlock {
  id: string;
  kind: UnlockKind;
  name: string;
  desc: string;
  xp: number;
}

export const UNLOCKS: Unlock[] = [
  { id: "compost", kind: "skin", name: "Compost", desc: "Fresh from the bin, leafy bits included", xp: 400 },
  { id: "slime", kind: "trail", name: "Slime Streak", desc: "Leave a gooey green wake", xp: 900 },
  { id: "glitter", kind: "skin", name: "Glitter Sludge", desc: "Toxic, but make it fashion", xp: 1600 },
  { id: "bubble", kind: "sound", name: "Bubble Pops", desc: "Every pickup goes blorp", xp: 2500 },
  { id: "sparkle", kind: "trail", name: "Sparkle Dust", desc: "Twinkle as you tumble", xp: 3600 },
  { id: "lava", kind: "skin", name: "Lava Ball", desc: "Piping-hot magma with glowing cracks", xp: 5000 },
  { id: "snowball", kind: "skin", name: "Snowball", desc: "The one thing the Trashlands can't stain", xp: 6800 },
  { id: "confetti", kind: "trail", name: "Confetti Trail", desc: "Party wherever you roll", xp: 8000 },
  { id: "rust", kind: "skin", name: "Rust Bucket", desc: "Weathered scrap-metal patina", xp: 9200 },
  { id: "clang", kind: "sound", name: "Clang Pops", desc: "Every pickup rings like scrap metal", xp: 10500 },
  { id: "goldenskin", kind: "skin", name: "Golden Blob", desc: "Gilded from one too many dumpster dives", xp: 12000 },
];

export function unlocked(id: string, xp: number): boolean {
  const u = UNLOCKS.find((u) => u.id === id);
  return !!u && xp >= u.xp;
}

/** XP earned for a finished match. */
export function xpForMatch(r: MatchResult): number {
  const placementBonus = [60, 45, 35, 25, 18, 12, 8, 5][r.placement - 1] ?? 5;
  return (
    Math.round(r.score / 8) +
    placementBonus +
    r.zonesCleaned * 15 +
    (r.bestCombo >= 5 ? 15 : 0)
  );
}

/** Visual recipe for a blob skin (consumed by Blob's constructor). */
export interface SkinSpec {
  base: number;
  accent: "none" | "leaves" | "sparkle" | "cracks" | "frost";
}

/** Skin id → look. "" (default Mud) is always available. */
export const SKINS: Record<string, SkinSpec> = {
  "": { base: 0x6f4e27, accent: "none" },
  compost: { base: 0x5d7a3a, accent: "leaves" },
  glitter: { base: 0x7b5bb5, accent: "sparkle" },
  lava: { base: 0x453030, accent: "cracks" },
  snowball: { base: 0xdfe9ee, accent: "frost" },
  rust: { base: 0x8a5a3a, accent: "cracks" },
  goldenskin: { base: 0xd9a441, accent: "sparkle" },
};

export function skinSpec(id: string, xp: number): SkinSpec {
  // Fall back to Mud if the equipped skin isn't actually unlocked
  // (e.g. an edited/imported save).
  if (id && (!SKINS[id] || !unlocked(id, xp))) return SKINS[""];
  return SKINS[id] ?? SKINS[""];
}
