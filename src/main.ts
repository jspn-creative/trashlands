import { Application } from "pixi.js";
import { registerSW } from "virtual:pwa-register";
import { ACHIEVEMENTS, newlyEarned } from "./game/achievements";
import { BOT_COUNT, CLASSES, PLAYER_LIVES } from "./game/config";
import { dailyChallenges, dailySeed, dayKey, prevDayKey } from "./game/daily";
import { Game, MatchResult } from "./game/game";
import { Input } from "./game/input";
import { applyPlacement, LEAGUES, MAX_LEAGUE, PROMOTE_AT } from "./game/league";
import { mapById, MAPS } from "./game/maps";
import { Music } from "./game/music";
import { DEFAULT_SAVE, loadSave, persistSave, SaveData } from "./game/save";
import { Sound } from "./game/sound";
import { SKINS, skinSpec, UNLOCKS, unlocked, xpForMatch } from "./game/unlocks";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

async function boot(): Promise<void> {
  registerSW({ immediate: true });

  try {
    await Promise.all([document.fonts.load('800 28px "Baloo 2"'), document.fonts.load('600 16px "Baloo 2"')]);
  } catch {}

  const app = new Application();
  await app.init({
    resizeTo: window,
    // Matches --edge in index.html, so any gap reads as screen edge, not a green border.
    background: 0x1c160f,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  document.getElementById("app")!.appendChild(app.canvas);

  const save: SaveData = await loadSave();
  const sound = new Sound();
  const music = new Music(sound);
  // Master mute wins over both channel toggles; clearing it restores them.
  const applyAudioPrefs = () => {
    sound.enabled = save.sound && !save.muted;
    if (!sound.enabled) sound.stopAmbient();
    music.setEnabled(save.music && !save.muted);
  };
  sound.enabled = save.sound && !save.muted;
  music.enabled = save.music && !save.muted;
  const input = new Input(document.body, () => {
    sound.unlock();
    music.resume();
  });

  const $ = (id: string) => document.getElementById(id)!;
  const home = $("home");
  const results = $("results");
  const pauseOverlay = $("pause");
  const locker = $("locker");
  const statsPanel = $("stats");
  const dailyPanel = $("daily");
  const mapSelect = $("mapselect");
  const helpPanel = $("help");
  const settingsPanel = $("settings");
  const moreRow = $("more-row") as HTMLElement;
  const moreBtn = $("more") as HTMLButtonElement;
  const pauseBtn = $("pause-btn") as HTMLButtonElement;
  const isOpen = (el: HTMLElement) => !el.classList.contains("hidden");

  sound.popStyle = unlocked(save.popStyle, save.xp) ? save.popStyle : "";

  // Settings toggles.
  const soundToggle = $("toggle-sound") as HTMLInputElement;
  const musicToggle = $("toggle-music") as HTMLInputElement;
  const shakeToggle = $("toggle-shake") as HTMLInputElement;
  soundToggle.checked = save.sound;
  musicToggle.checked = save.music;
  shakeToggle.checked = save.shake;
  soundToggle.addEventListener("change", () => {
    save.sound = soundToggle.checked;
    applyAudioPrefs();
    persistSave(save);
  });
  musicToggle.addEventListener("change", () => {
    save.music = musicToggle.checked;
    applyAudioPrefs();
    persistSave(save);
  });

  // Home-screen quick mute.
  const muteBtn = $("mute") as HTMLButtonElement;
  const renderMute = () => {
    muteBtn.textContent = save.muted ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-pressed", String(save.muted));
    muteBtn.setAttribute("aria-label", save.muted ? "Unmute all audio" : "Mute all audio");
  };
  renderMute();
  muteBtn.addEventListener("click", () => {
    save.muted = !save.muted;
    applyAudioPrefs();
    renderMute();
    persistSave(save);
  });
  shakeToggle.addEventListener("change", () => {
    save.shake = shakeToggle.checked;
    persistSave(save);
  });

  // Deferred PWA install prompt — offered on results after the 2nd match (PRD §4.1).
  let installEvent: BeforeInstallPromptEvent | null = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e as BeforeInstallPromptEvent;
  });
  $("install").addEventListener("click", () => {
    if (installEvent) {
      void installEvent.prompt();
      installEvent = null;
    }
    ($("install") as HTMLButtonElement).hidden = true;
  });

  /** Fill a .ladder stepper + .league-progress bar pair with the current standing. */
  const renderLadder = (ladderId: string, progressId: string) => {
    const ladder = $(ladderId);
    ladder.innerHTML = LEAGUES.map((name, i) => {
      const state = i < save.league ? "done" : i === save.league ? "current" : "";
      const link = i > 0 ? `<div class="link ${i <= save.league ? "done" : ""}"></div>` : "";
      return `${link}<div class="rung ${state}"><div class="dot"></div><span>${name}</span></div>`;
    }).join("");

    const progress = $(progressId);
    const fill = progress.querySelector<HTMLElement>(".fill")!;
    const cap = progress.querySelector<HTMLElement>(".cap")!;
    const pts = Math.min(save.leaguePoints, PROMOTE_AT);
    fill.style.width = `${(pts / PROMOTE_AT) * 100}%`;
    cap.innerHTML = save.league >= MAX_LEAGUE ? `<b>${LEAGUES[save.league]}</b> — top of the ladder!` : `<b>${pts}/${PROMOTE_AT} pts</b> to ${LEAGUES[save.league + 1]}`;
  };
  renderLadder("ladder-home", "progress-home");

  const updateXp = () => {
    $("xp-home").textContent = `⭐ ${save.xp.toLocaleString()} XP`;
    $("xp-locker").textContent = `⭐ ${save.xp.toLocaleString()} XP`;
  };
  updateXp();

  // Map selector
  const mapUnlocked = (id: string) => save.bestLeague >= mapById(id).unlockLeague;
  const renderMaps = () => {
    if (!mapUnlocked(save.map)) save.map = "junkyard";
    const holder = $("maps");
    holder.innerHTML = "";
    for (const m of MAPS) {
      const open = save.bestLeague >= m.unlockLeague;
      const card = document.createElement("div");
      card.className = `map-card${save.map === m.id ? " selected" : ""}${open ? "" : " locked"}`;
      card.innerHTML = `<div class="mn">${open ? "" : "🔒 "}${m.name}</div>` + `<div class="md">${open ? m.desc : `Reach ${LEAGUES[m.unlockLeague]} to unlock`}</div>`;
      if (open) {
        card.addEventListener("click", () => {
          // Tapping the map you're already on is the express lane into the match.
          if (save.map === m.id) {
            startMatch(pendingZen);
            return;
          }
          save.map = m.id;
          persistSave(save);
          renderMaps();
        });
      }
      holder.appendChild(card);
    }
  };

  // Locker
  const SWATCH: Record<string, string> = {
    compost: "🍃",
    glitter: "✨",
    lava: "🔥",
    snowball: "❄️",
    slime: "💚",
    sparkle: "🌟",
    bubble: "🫧",
  };
  const DEFAULT_CARDS = [
    { id: "", kind: "skin" as const, name: "Mud", desc: "The original dirt", xp: 0 },
    { id: "", kind: "trail" as const, name: "No Trail", desc: "A clean getaway", xp: 0 },
    { id: "", kind: "sound" as const, name: "Classic Pops", desc: "The original crunch", xp: 0 },
  ];
  const equippedId = (kind: string) => (kind === "skin" ? save.skin : kind === "trail" ? save.trail : save.popStyle);

  const renderLocker = () => {
    const grid = $("locker-grid");
    grid.innerHTML = "";
    for (const u of [...DEFAULT_CARDS, ...UNLOCKS]) {
      const isLocked = save.xp < u.xp;
      const isEquipped = !isLocked && equippedId(u.kind) === u.id;
      const card = document.createElement("div");
      card.className = `unlock-card${isEquipped ? " equipped" : ""}${isLocked ? " locked" : ""}`;
      const skin = u.kind === "skin" ? SKINS[u.id] : null;
      const swatchBg = skin ? `#${skin.base.toString(16).padStart(6, "0")}` : "rgba(0,0,0,0.35)";
      card.innerHTML = `<div class="swatch" style="background:${swatchBg}">${SWATCH[u.id] ?? ""}</div>` + `<div class="kind">${u.kind}</div><div class="n">${u.name}</div>` + `<div class="d">${u.desc}</div>` + `<div class="s">${isLocked ? `🔒 ${u.xp.toLocaleString()} XP` : isEquipped ? "✔ EQUIPPED" : "Tap to equip"}</div>`;
      if (!isLocked && !isEquipped) {
        card.addEventListener("click", () => {
          if (u.kind === "skin") save.skin = u.id;
          else if (u.kind === "trail") save.trail = u.id;
          else {
            save.popStyle = u.id;
            sound.popStyle = u.id;
          }
          persistSave(save);
          renderLocker();
        });
      }
      grid.appendChild(card);
    }
  };

  // Stats
  const BADGE_ICONS = ["🌱", "🚮", "🗑️", "⚙️", "☠️", "👑"];
  const renderStats = () => {
    const rows = [
      ["Matches played", String(save.matchesPlayed)],
      ["Best score", save.bestScore.toLocaleString()],
      ["Total XP", save.xp.toLocaleString()],
      ["Trash eaten", save.statTrash.toLocaleString()],
      ["Blobs eaten", String(save.statBlobsEaten)],
      ["Times eaten", String(save.statTimesEaten)],
      ["Zones cleaned", String(save.statZones)],
      ["Best combo", save.statBestCombo >= 2 ? `×${save.statBestCombo}` : "—"],
      ["Biggest blob", CLASSES[save.statBiggestClass - 1].name],
    ];
    $("stats-grid").innerHTML = rows.map(([k, v]) => `<div class="stat-card"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
    $("badges").innerHTML = LEAGUES.map((name, i) => `<div class="badge${i <= save.bestLeague ? " earned" : ""}"><span class="i">${BADGE_ICONS[i]}</span>${name}</div>`).join("");

    $("achievements").innerHTML = ACHIEVEMENTS.map((a) => {
      const earned = save.achievementsUnlocked.includes(a.id);
      return `<div class="ach-card${earned ? " earned" : ""}">` + `<div class="i">${a.icon}</div><div class="n">${a.name}</div><div class="d">${a.desc}</div>` + `</div>`;
    }).join("");
  };

  // Daily run
  const renderDaily = () => {
    const today = dayKey();
    if (save.dailyDate !== today) {
      save.dailyDate = today;
      save.dailyBestScore = 0;
      save.dailyDoneIds = [];
      persistSave(save);
    }
    $("daily-date").textContent = today;
    $("daily-streak").textContent = `🔥 ${save.dailyStreak} day${save.dailyStreak === 1 ? "" : "s"} streak`;
    $("daily-best").textContent = save.dailyBestScore > 0 ? `Best today: ${save.dailyBestScore}` : "No run yet today";
    $("daily-challenges").innerHTML = dailyChallenges(today)
      .map((c) => {
        const done = save.dailyDoneIds.includes(c.id);
        return `<div class="challenge${done ? " done" : ""}"><span class="c-check">${done ? "✔" : "○"}</span> ${c.desc}</div>`;
      })
      .join("");
  };

  const openPanel = (el: HTMLElement) => {
    home.classList.add("hidden");
    el.classList.remove("hidden");
  };
  const closePanel = (el: HTMLElement) => {
    el.classList.add("hidden");
    home.classList.remove("hidden");
  };

  // Overflow drawer behind the More button, so home stays a single button row.
  const setMoreOpen = (open: boolean) => {
    moreRow.hidden = !open;
    moreBtn.setAttribute("aria-expanded", String(open));
  };
  moreBtn.addEventListener("click", () => setMoreOpen(moreRow.hidden));

  $("open-help").addEventListener("click", () => openPanel(helpPanel));
  $("help-back").addEventListener("click", () => closePanel(helpPanel));
  $("open-settings").addEventListener("click", () => openPanel(settingsPanel));
  $("settings-back").addEventListener("click", () => closePanel(settingsPanel));
  $("open-locker").addEventListener("click", () => {
    renderLocker();
    openPanel(locker);
  });
  $("locker-back").addEventListener("click", () => closePanel(locker));
  $("open-stats").addEventListener("click", () => {
    renderStats();
    openPanel(statsPanel);
  });
  $("stats-back").addEventListener("click", () => closePanel(statsPanel));
  $("open-daily").addEventListener("click", () => {
    renderDaily();
    openPanel(dailyPanel);
  });
  $("daily-back").addEventListener("click", () => closePanel(dailyPanel));

  // Save export / import
  $("export-save").addEventListener("click", () => {
    const file = new Blob([JSON.stringify(save, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = "trashlands-save.json";
    a.click();
    URL.revokeObjectURL(url);
  });
  $("import-save").addEventListener("click", () => ($("import-file") as HTMLInputElement).click());
  $("import-file").addEventListener("change", async () => {
    const input = $("import-file") as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (typeof parsed !== "object" || !parsed) throw new Error("not an object");
      if (!window.confirm("Replace the save on this device with the imported one?")) return;
      // Copy only known fields with matching types — never trust the file shape.
      const src = parsed as Record<string, unknown>;
      for (const key of Object.keys(DEFAULT_SAVE) as (keyof SaveData)[]) {
        if (typeof src[key] === typeof DEFAULT_SAVE[key]) {
          (save as unknown as Record<string, unknown>)[key] = src[key];
        }
      }
      persistSave(save);
      sound.popStyle = unlocked(save.popStyle, save.xp) ? save.popStyle : "";
      applyAudioPrefs();
      renderMute();
      soundToggle.checked = save.sound;
      musicToggle.checked = save.music;
      shakeToggle.checked = save.shake;
      renderLadder("ladder-home", "progress-home");
      updateXp();
      renderStats();
    } catch {
      window.alert("That file doesn't look like a Trashlands save.");
    }
  });

  let game: Game | null = null;

  const setPauseUi = (paused: boolean) => {
    pauseOverlay.classList.toggle("hidden", !paused);
    pauseBtn.style.display = game?.pausable && !paused ? "flex" : "none";
    // Zen sessions can be wrapped up early from the pause menu.
    ($("finish") as HTMLButtonElement).hidden = !zenMode;
    music.setDucked(paused);
  };

  // Fullscreen on touch devices; must run inside a user-gesture handler. In-browser iPhone Safari has no element fullscreen API, so there we surface the install hint instead.
  const isStandalone = () => window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  const tryFullscreen = () => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    if (isStandalone() || document.fullscreenElement) return;
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
    void req?.()?.catch(() => {});
  };
  const isIphoneBrowser = /iP(hone|od)/.test(navigator.userAgent) && !isStandalone();
  ($("ios-hint") as HTMLElement).hidden = !isIphoneBrowser;

  // Zen, daily, or match — remembered so "Restart"/"Play Again" repeat the same mode (M5, M10).
  let zenMode = false;
  let dailyMode = false;
  /** Which mode the map picker is currently choosing a map for. */
  let pendingZen = false;

  const hideOverlays = () => {
    for (const el of [home, results, pauseOverlay, locker, statsPanel, dailyPanel, mapSelect, helpPanel, settingsPanel]) {
      el.classList.add("hidden");
    }
  };

  // Play and Zen both land here first; the map list moved off home so the menu fits a landscape phone.
  const openMapSelect = (zen: boolean) => {
    pendingZen = zen;
    $("mapselect-mode").textContent = zen ? "🧘 Zen — no clock, no rivals, just cleaning" : `🏆 League match — 2:00 · ${PLAYER_LIVES} lives · ${BOT_COUNT} rivals`;
    renderMaps();
    setMoreOpen(false);
    openPanel(mapSelect);
  };

  const startMatch = (zen: boolean) => {
    zenMode = zen;
    dailyMode = false;
    tryFullscreen();
    hideOverlays();
    game?.destroy();
    game = new Game(app, input, sound, {
      league: save.league,
      seed: (Math.random() * 0x7fffffff) >>> 0,
      shakeEnabled: save.shake,
      skin: skinSpec(save.skin, save.xp),
      trail: unlocked(save.trail, save.xp) ? save.trail : "",
      map: mapById(mapUnlocked(save.map) ? save.map : "junkyard"),
      zen,
      onEnd: showResults,
    });
    game.play();
    setPauseUi(false);
    music.play("game");
  };

  // Fixed per-day seed on the canonical map, so everyone shares today's layout and retries reuse it.
  const startDaily = () => {
    zenMode = false;
    dailyMode = true;
    tryFullscreen();
    hideOverlays();
    game?.destroy();
    game = new Game(app, input, sound, {
      league: save.league,
      seed: dailySeed(dayKey()),
      shakeEnabled: save.shake,
      skin: skinSpec(save.skin, save.xp),
      trail: unlocked(save.trail, save.xp) ? save.trail : "",
      map: mapById("junkyard"),
      zen: false,
      onEnd: showResults,
    });
    game.play();
    setPauseUi(false);
    music.play("game");
  };

  const quitToMenu = () => {
    game?.destroy();
    game = null;
    dailyMode = false;
    // Results sits after home in the DOM, so leaving it visible paints over the menu.
    hideOverlays();
    pauseBtn.style.display = "none";
    renderLadder("ladder-home", "progress-home");
    setMoreOpen(false);
    music.setDucked(false);
    music.play("main");
    home.classList.remove("hidden");
  };

  const showResults = (r: MatchResult) => {
    pauseBtn.style.display = "none";
    music.setDucked(false);
    music.play("main");
    save.matchesPlayed++;

    // Zen doesn't touch the ladder or best score; competitive matches do.
    const prevBest = save.bestScore;
    let ladder = null;
    if (!r.zen) {
      save.bestScore = Math.max(save.bestScore, r.score);
      ladder = applyPlacement(save.league, save.leaguePoints, r.placement);
      save.league = ladder.league;
      save.leaguePoints = ladder.points;
      save.bestLeague = Math.max(save.bestLeague, ladder.league);
    }

    // XP + lifetime stats (M3). Zen earns at half rate so the ladder matters.
    const gainedXp = r.zen ? Math.max(5, Math.round(r.score / 16) + r.zonesCleaned * 10) : xpForMatch(r);
    const prevXp = save.xp;
    save.xp += gainedXp;
    save.statTrash += r.trashEaten;
    save.statBlobsEaten += r.kills;
    save.statTimesEaten += PLAYER_LIVES - r.livesLeft;
    save.statZones += r.zonesCleaned;
    save.statBestCombo = Math.max(save.statBestCombo, r.bestCombo);
    save.statBiggestClass = Math.max(save.statBiggestClass, r.biggestClass);

    // Daily challenge bookkeeping (M10) — same seed all day, so retries make sense.
    let dailyBonusXp = 0;
    let dailyAllDone = false;
    if (dailyMode) {
      const today = dayKey();
      if (save.dailyDate !== today) {
        save.dailyDate = today;
        save.dailyBestScore = 0;
        save.dailyDoneIds = [];
      }
      save.dailyBestScore = Math.max(save.dailyBestScore, r.score);
      const challenges = dailyChallenges(today);
      for (const c of challenges) {
        if (!save.dailyDoneIds.includes(c.id) && c.check(r)) {
          save.dailyDoneIds.push(c.id);
          dailyBonusXp += 50;
        }
      }
      dailyAllDone = challenges.every((c) => save.dailyDoneIds.includes(c.id));
      const yesterday = prevDayKey(today);
      if (save.dailyLastStreakDate !== today) {
        save.dailyStreak = save.dailyLastStreakDate === yesterday ? save.dailyStreak + 1 : 1;
        save.dailyLastStreakDate = today;
      }
      save.xp += dailyBonusXp;
    }

    // Achievements (M11) — evaluated last so they see this match's stat updates.
    const earned = newlyEarned(save);
    for (const a of earned) save.achievementsUnlocked.push(a.id);

    persistSave(save);
    updateXp();

    $("results-xp").textContent = `⭐ +${gainedXp + dailyBonusXp} XP`;
    const dailyLine = $("results-daily");
    dailyLine.hidden = !dailyMode;
    if (dailyMode) {
      dailyLine.textContent = dailyAllDone ? `🗓️ Daily complete! 🔥 ${save.dailyStreak}-day streak` : `🗓️ Daily run · 🔥 ${save.dailyStreak}-day streak · best today ${save.dailyBestScore}`;
    }

    const achBanner = $("results-achievement");
    achBanner.hidden = earned.length === 0;
    if (earned.length > 0) {
      achBanner.textContent = `🏆 Achievement: ${earned.map((a) => `${a.icon} ${a.name}`).join(" + ")}`;
    }
    const fresh = UNLOCKS.filter((u) => u.xp > prevXp && u.xp <= save.xp);
    const banner = $("results-unlock");
    banner.hidden = fresh.length === 0;
    if (fresh.length > 0) {
      banner.textContent = `🎉 New unlock: ${fresh.map((u) => u.name).join(" + ")} — check the Locker!`;
    }

    const mins = Math.floor(r.duration / 60);
    const secs = String(r.duration % 60).padStart(2, "0");
    if (r.zen) {
      $("results-title").textContent = r.cleanedPct >= 100 ? "Sparkling clean! ✨" : "Zen session";
      $("results-sub").textContent = `${r.cleanedPct}% cleaned in ${mins}:${secs}`;
    } else {
      // Placement always shows here; the stat grid no longer carries it.
      $("results-title").textContent = r.livesLeft === 0 ? `Out of lives · ${ORDINALS[r.placement - 1]}` : `${ORDINALS[r.placement - 1]} place`;
      $("results-sub").textContent = r.score > prevBest && r.score > 0 ? `Score: ${r.score} — new best!` : `Score: ${r.score} · Best: ${save.bestScore}`;
    }

    // Six cards either way; zen swaps the competitive rows for session ones.
    const stats = [
      ["Biggest thing eaten", r.biggestLabel || "…nothing?"],
      ...(r.zen
        ? [
            ["Time", `${mins}:${secs}`],
            ["Score", String(r.score)],
          ]
        : [
            ["Blobs consumed", String(r.kills)],
            ["Best combo", r.bestCombo >= 2 ? `×${r.bestCombo}` : "—"],
          ]),
      ["Zones you cleaned", String(r.zonesCleaned)],
      ["Map cleaned", `${r.cleanedPct}%`],
      ...(r.zen ? [["Best combo", r.bestCombo >= 2 ? `×${r.bestCombo}` : "—"]] : [["Lives remaining", String(r.livesLeft)]]),
    ];
    $("results-stats").innerHTML = stats.map(([k, v]) => `<div class="stat-card"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");

    // League standing is match-only; zen hides the whole ladder block.
    $("results-league").style.display = r.zen ? "none" : "";
    $("ladder-results").style.display = r.zen ? "none" : "";
    ($("progress-results") as HTMLElement).style.display = r.zen ? "none" : "";
    if (ladder) {
      const sign = ladder.delta >= 0 ? "+" : "";
      let leagueMsg = `${sign}${ladder.delta} league pts`;
      if (ladder.promoted) leagueMsg = `⬆ Promoted to ${LEAGUES[ladder.league]}!`;
      if (ladder.demoted) leagueMsg = `⬇ Demoted to ${LEAGUES[ladder.league]} (${sign}${ladder.delta} pts)`;
      $("results-league").textContent = leagueMsg;
      renderLadder("ladder-results", "progress-results");
    }

    ($("install") as HTMLButtonElement).hidden = !(installEvent && save.matchesPlayed >= 2 && !save.installDismissed);

    results.classList.remove("hidden");
  };

  const togglePause = () => {
    if (!game?.pausable) return;
    if (game.paused) {
      game.resume();
      setPauseUi(false);
    } else {
      game.pause();
      setPauseUi(true);
    }
  };

  $("play").addEventListener("click", () => openMapSelect(false));
  $("zen").addEventListener("click", () => openMapSelect(true));
  $("mapselect-start").addEventListener("click", () => startMatch(pendingZen));
  $("mapselect-back").addEventListener("click", () => closePanel(mapSelect));
  $("daily-play").addEventListener("click", startDaily);
  $("again").addEventListener("click", () => (dailyMode ? startDaily() : startMatch(zenMode)));
  $("menu").addEventListener("click", quitToMenu);
  pauseBtn.addEventListener("click", togglePause);
  $("resume").addEventListener("click", togglePause);
  $("restart").addEventListener("click", () => (dailyMode ? startDaily() : startMatch(zenMode)));
  $("quit").addEventListener("click", quitToMenu);
  $("finish").addEventListener("click", () => {
    pauseOverlay.classList.add("hidden");
    game?.resume();
    game?.finish();
  });

  const subPanels = [locker, statsPanel, dailyPanel, mapSelect, helpPanel, settingsPanel];

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "Escape") {
      const open = subPanels.find(isOpen);
      if (open) closePanel(open);
      else togglePause();
      return;
    }
    if (e.code !== "Enter" && e.code !== "Space") return;
    // Enter/Space confirms the highlighted map; elsewhere in a sub-panel it does nothing.
    if (isOpen(mapSelect)) {
      startMatch(pendingZen);
      return;
    }
    if (subPanels.some(isOpen)) return;
    if (isOpen(pauseOverlay)) togglePause();
    // From results, repeat the last mode; from home, go pick a map.
    else if (isOpen(results)) dailyMode ? startDaily() : startMatch(zenMode);
    else if (isOpen(home)) openMapSelect(false);
  });

  // Auto-pause when the tab goes to the background mid-match.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && game?.pausable && !game.paused) {
      game.pause();
      setPauseUi(true);
    }
    // Don't keep serenading a backgrounded tab.
    music.setDucked(document.hidden || (game?.paused ?? false));
  });

  // Menu bed starts here; autoplay policy usually defers it to the first tap.
  music.play("main");

  // Debug handles (harmless in prod; stripped when we add a build flag later).
  (window as unknown as Record<string, unknown>).__app = app;
  (window as unknown as Record<string, unknown>).__game = () => game;
  (window as unknown as Record<string, unknown>).__music = music;
}

void boot();
