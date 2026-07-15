import { CLASSES } from "./config";
import { MAX_LEAGUE } from "./league";
import { SaveData } from "./save";
import { UNLOCKS } from "./unlocks";

/**
 * Lifetime achievements (M11) — checked against persisted save state only,
 * so they can be re-evaluated any time without touching the match pipeline.
 */
export interface Achievement {
  id: string;
  icon: string;
  name: string;
  desc: string;
  check(save: SaveData): boolean;
}

const maxUnlockXp = UNLOCKS[UNLOCKS.length - 1].xp;

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_match", icon: "🎮", name: "Getting Dirty", desc: "Play your first match", check: (s) => s.matchesPlayed >= 1 },
  { id: "matches25", icon: "📅", name: "Regular", desc: "Play 25 matches", check: (s) => s.matchesPlayed >= 25 },
  { id: "matches100", icon: "🏕️", name: "Veteran", desc: "Play 100 matches", check: (s) => s.matchesPlayed >= 100 },
  { id: "landslide", icon: "🏔️", name: "Landslide", desc: "Grow to the biggest size class in a match", check: (s) => s.statBiggestClass >= CLASSES.length },
  { id: "combo5", icon: "⚡", name: "Chain Reaction", desc: "Reach a ×5 combo", check: (s) => s.statBestCombo >= 5 },
  { id: "trash1000", icon: "🧹", name: "Clean Freak", desc: "Eat 1,000 pieces of trash, lifetime", check: (s) => s.statTrash >= 1000 },
  { id: "blobs50", icon: "🍽️", name: "Apex Blob", desc: "Eat 50 rival blobs, lifetime", check: (s) => s.statBlobsEaten >= 50 },
  { id: "zones25", icon: "🏅", name: "Zone Master", desc: "Clear 25 cleanup zones, lifetime", check: (s) => s.statZones >= 25 },
  { id: "trashlord", icon: "👑", name: "Trashlord", desc: "Reach the top of the league ladder", check: (s) => s.bestLeague >= MAX_LEAGUE },
  { id: "streak7", icon: "🔥", name: "Creature of Habit", desc: "Hit a 7-day daily streak", check: (s) => s.dailyStreak >= 7 },
  { id: "score1000", icon: "💯", name: "High Roller", desc: "Score 1,000+ in a single match", check: (s) => s.bestScore >= 1000 },
  { id: "unlockAll", icon: "🎉", name: "Fully Loaded", desc: "Unlock every cosmetic", check: (s) => s.xp >= maxUnlockXp },
];

/** Achievements satisfied by the save but not yet recorded — call once after any save mutation. */
export function newlyEarned(save: SaveData): Achievement[] {
  return ACHIEVEMENTS.filter((a) => !save.achievementsUnlocked.includes(a.id) && a.check(save));
}
