/** Local persistence: IndexedDB with a localStorage fallback (PRD §4.1). */

export interface SaveData {
  league: number;
  leaguePoints: number;
  matchesPlayed: number;
  bestScore: number;
  sound: boolean;
  /** Looping background music (separate from the sound-effects toggle). */
  music: boolean;
  shake: boolean;
  installDismissed: boolean;
  /** Lifetime XP — unlocks are derived from this total (M3). */
  xp: number;
  /** Highest league ever reached (drives the badge shelf). */
  bestLeague: number;
  /** Equipped cosmetics (ids from unlocks.ts; "" = default). */
  skin: string;
  trail: string;
  popStyle: string;
  /** Selected arena (id from maps.ts). */
  map: string;
  /** Lifetime stats (M3 stats page). */
  statTrash: number;
  statBlobsEaten: number;
  statTimesEaten: number;
  statZones: number;
  statBestCombo: number;
  statBiggestClass: number;
  /** Daily seeded run (M10) — all keyed to the current UTC day. */
  dailyDate: string;
  dailyBestScore: number;
  dailyDoneIds: string[];
  dailyStreak: number;
  /** Last day that counted toward the streak (may differ from dailyDate if today hasn't been played yet). */
  dailyLastStreakDate: string;
  /** Unlocked achievement ids (M11). */
  achievementsUnlocked: string[];
}

export const DEFAULT_SAVE: SaveData = {
  league: 0,
  leaguePoints: 0,
  matchesPlayed: 0,
  bestScore: 0,
  sound: true,
  music: true,
  shake: true,
  installDismissed: false,
  xp: 0,
  bestLeague: 0,
  skin: "",
  trail: "",
  popStyle: "",
  map: "junkyard",
  statTrash: 0,
  statBlobsEaten: 0,
  statTimesEaten: 0,
  statZones: 0,
  statBestCombo: 1,
  statBiggestClass: 1,
  dailyDate: "",
  dailyBestScore: 0,
  dailyDoneIds: [],
  dailyStreak: 0,
  dailyLastStreakDate: "",
  achievementsUnlocked: [],
};

const DB_NAME = "trashlands";
const STORE = "kv";
const KEY = "save";
const LS_KEY = "trashlands-save";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(): Promise<unknown> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(STORE).objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbSet(value: SaveData): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export async function loadSave(): Promise<SaveData> {
  let raw: unknown = null;
  try {
    raw = await idbGet();
  } catch {
    try {
      const s = localStorage.getItem(LS_KEY);
      raw = s ? JSON.parse(s) : null;
    } catch {
      raw = null;
    }
  }
  // Merge over defaults so new fields get sane values after updates.
  return { ...DEFAULT_SAVE, ...(typeof raw === "object" && raw ? raw : {}) };
}

/** Fire-and-forget write; the game never blocks on saving. */
export function persistSave(data: SaveData): void {
  void idbSet(data).catch(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch {
      // Storage unavailable (private mode quota, etc.) — play on without saves.
    }
  });
}
