# Trashlands — Product Requirements Document

**Version:** 0.2 (Draft)
**Date:** 2026-07-10
**Status:** Approved direction — single-player PWA

---

## 1. Overview

### 1.1 Concept

Trashlands is a fast-paced, single-player arcade game in the spirit of *hole.io*, with a twist borrowed from *Katamari Damacy*: the player controls a **blob of dirt** that rolls around a trash-strewn arena, absorbing everything smaller than itself. The more you collect, the bigger you get — and the bigger you get, the bigger the things you can swallow, up to and including the AI-controlled rival blobs that fill each match.

### 1.2 Elevator pitch

> You're a sentient dirt ball in a world drowning in garbage. Roll, collect, grow. Eat a soda can. Then a trash bag. Then a dumpster. Then a car. Then the other blobs. Two minutes on the clock, three lives, seven bot rivals — top the leaderboard to climb the league ladder, and leave the map cleaner than you found it.

### 1.3 Product decisions (locked)

| Decision | Choice |
|---|---|
| Player model | **Single-player only**, forever. Rivals are AI bots. No netcode, no accounts, no servers. |
| Distribution | **Progressive Web App** — installable, fully playable offline, all data stored locally. |
| Visuals | **2D top-down** (hole.io-style), with stuck-trash sprites orbiting the blob for the Katamari feel. |
| Stack | **PixiJS + TypeScript + Vite.** Custom lightweight game loop; simple circle-based physics (no heavy engine). |
| Art | **CC0 asset packs** (Kenney.nl-style) for trash, props, and tiles. Swappable for custom art later. |
| Devices | **Desktop and mobile equally.** Responsive layout, mouse-follow + WASD on desktop, floating virtual joystick on touch. |
| Difficulty | **League ladder** — win matches to climb leagues with smarter bots and denser maps. |
| Death rule | **Lives system** — 3 lives per match; being eaten costs a life and some score. |
| v1 scope | **Bare loop** — everything else lands in post-v1 milestones (§7). |
| Monetization | None. No ads, no purchases. |

### 1.4 Goals

- The instantly-legible "consume and grow" loop: zero tutorial required, fun within 10 seconds.
- **Ship v1 fast**, then grow the game through frequent, small milestones.
- 2–3 minute matches designed for "one more round" replayability.
- A real PWA: install to home screen/dock, launch offline, instant load.

### 1.5 Non-goals

- Multiplayer of any kind (including leaderboard servers) — permanently out of scope.
- Monetization, ads, analytics beyond local stats.
- User-generated content / level editor.
- Narrative campaign.

---

## 2. Core gameplay

### 2.1 The loop

1. **Roll** your dirt blob around the arena (mouse-follow/WASD on desktop, virtual joystick on touch).
2. **Collect** any object of your size class or below — objects visibly stick to your surface, then absorb into your mass.
3. **Grow** through size classes, unlocking bigger targets.
4. **Compete** against 7 AI bots that play by identical rules — they grow, hunt, and can eat you.
5. **Win** by having the highest score when the 2:00 timer expires. Placement determines league points (§2.7).

### 2.2 Growth & size classes

| Class | Blob feels like | Example objects |
|---|---|---|
| 1 | Dust bunny | Bottle caps, cigarette butts, gum, wrappers |
| 2 | Soccer ball | Cans, bottles, food containers, shoes |
| 3 | Beach ball | Trash bags, tires, traffic cones, mailboxes |
| 4 | Boulder | Dumpsters, park benches, vending machines, scooters |
| 5 | Wrecking ball | Cars, food trucks, small sheds, billboards |
| 6 | Landslide | Buses, houses, cranes — and everything else |

Growth is logarithmic: early pickups grow you fast; later classes require proportionally more mass. Keeps the early game snappy and prevents a runaway leader from becoming untouchable at 0:30.

### 2.3 Movement feel

- The blob has light **momentum**: bigger blobs accelerate slower but bulldoze; small blobs are nimble.
- Recently collected objects **visibly ride on the blob's surface** as orbiting sprites for a few seconds before absorbing — the signature visual.
- Camera zooms out smoothly as the blob grows.

### 2.4 Player vs. bots

- A blob can consume another blob **at least one full size class smaller**.
- Near-equal blobs bounce off each other and each knock loose a few surface objects the other can steal — skirmishes, not instant deaths.
- **Lives:** the player starts each match with **3 lives**. Being eaten costs one life plus 25% of current score; respawn after 3s at a size scaled to match progress. Losing all 3 lives ends your match early (final score stands, spectate or skip to results).
- Bots have effectively infinite respawns but respawn small — eating a bot is always tempo-positive.

### 2.5 Bots (the heart of single-player)

Bots are named personas with distinct, readable behaviors:

- **Grazer** — farms dense trash zones, avoids conflict.
- **Hunter** — prioritizes eating smaller blobs, including you.
- **Sweeper** — methodically clears zones for set bonuses.
- **Opportunist** — steals contested zones and wounded targets.

Each league (§2.7) tunes bot reaction time, route quality, aggression, and persona mix. Bots run behind the same input interface as the player — one simulation, two drivers.

### 2.6 Scoring

- Points per object scale with size class.
- **Combo multiplier** *(post-v1, M2)*: rapid consecutive pickups build up to ×5, decaying after ~2s idle.
- **Zone-clean bonuses** *(post-v1, M2)*: clearing a marked zone ("the picnic area") grants a bonus and a "ZONE CLEANED!" flourish.
- Eating a bot grants points proportional to its size.

### 2.7 League ladder (difficulty & progression spine)

- Leagues, in order: **Compost → Curbside → Landfill → Scrapheap → Wasteland → Trashlord**.
- Finish top 3 in a match to earn league points; enough points promotes you. Bottom finishes can demote (never below Compost).
- Each league raises bot skill, map density, and hazard presence, and awards its own cosmetic badge *(cosmetics post-v1)*.
- Current league is the headline stat on the home screen.
- v1 ships with the first two leagues; more leagues arrive with content milestones.

### 2.8 Match structure

- **2:00 rounds**, player + 7 bots.
- Live leaderboard (top 5 + your rank); current leader wears a garbage crown.
- Results screen: placement, score, league points earned/lost, biggest object eaten, blobs consumed, lives remaining.

---

## 3. World & theme

### 3.1 Setting & tone

The Trashlands: a once-lovely world buried in garbage. Bright, cartoonish, comedic — trash is chunky, colorful, satisfying to pop into your blob. Never grim, never preachy.

### 3.2 The cleanup fantasy *(post-v1, M2)*

As trash is collected, the ground beneath is revealed **clean and green** — grass, flowers, sparkling pavement. By match end a good arena looks transformed. A "% cleaned" stat feeds achievements. This is the identity hole.io lacks: destruction mechanics, restoration feeling.

### 3.3 Maps

- **v1: Junkyard Park** — city park + overflowing landfill, balanced density, no hazards. The canonical arena.
- **M4: Boardwalk Dump** — beach & pier; waves periodically sweep shoreline trash (and small blobs); seagulls steal surface objects from idle blobs.
- **M6: The Deep End** *(underwater)* — sunken seabed; drifting currents carry trash and blobs across lanes; jellyfish sting mass loose on contact.
- **M7: Junk Orbit** *(space)* — an orbital scrapyard; low-traction drift movement; asteroid fly-throughs and a UFO tractor beam that abducts loose trash.
- **M9: Scrap City** — dense downtown; richest large-object spawns; compactor-truck hazard.
- Trash trickles back into cleaned areas (garbage trucks spill, litterbugs toss) so maps never fully starve.

---

## 4. PWA & technical requirements

### 4.1 PWA requirements

- **Installable:** valid manifest (icons, theme color, `display: standalone`), custom in-game install prompt after the player finishes their second match (not on first load).
- **Offline-first:** service worker precaches the entire game; after first visit, the game loads and plays with zero connectivity. Updates download in the background and apply on next launch ("New version ready" toast).
- **Persistence:** all saves (league, stats, settings, unlocks) in IndexedDB with localStorage fallback. Export/import save as a JSON file (settings screen) so players can back up or move devices — this replaces any server-side account.
- **Orientation:** playable in both orientations; landscape recommended on phones via a gentle rotate hint, never a hard block.
- **Payload:** < 5 MB initial load; playable in < 3 s on broadband, < 8 s on 4G.

### 4.2 Engine & architecture

- **PixiJS v8 + TypeScript + Vite** (with `vite-plugin-pwa` for the service worker/manifest).
- Custom fixed-timestep game loop; rendering interpolated and decoupled from simulation.
- **Physics:** hand-rolled circle-vs-circle and circle-vs-AABB collision — no physics engine dependency. Objects are static until disturbed; spatial hash grid for broad-phase.
- **Performance:** 60fps with ~500 active objects on a 3-year-old phone; off-screen culling and object sleeping.
- Simulation is deterministic given a seed — enables replayable daily-challenge seeds later (§7 M7) and makes bugs reproducible.

### 4.3 Controls

- **Desktop:** blob steers toward mouse cursor (primary) or WASD/arrows. Space = power-up (when they exist).
- **Touch:** floating virtual joystick, thumb anywhere; second-thumb tap = power-up.
- One-input game at its core: contact does all collecting.

### 4.4 UX & accessibility

- HUD: timer (top left), mini-leaderboard (top right), size-class progress bar (bottom center), lives as small blob icons.
- No tutorial screens: first-ever match seeds dense class-1 trash near the player and delays bot aggression 20s; contextual one-line tips on first occurrences.
- Colorblind-safe blob identity colors; toggles for screen-shake/flash; audio optional (many mobile sessions are muted).

---

## 5. Game feel checklist (v1 must-haves)

- Distinct *plop/crunch/squish* audio per size class.
- Pickup pop animation + score number flying to the HUD.
- Smooth camera zoom as the blob grows.
- Screen-shake (toggleable) when consuming class-4+ objects or blobs.
- Stuck-trash sprites orbiting the blob before absorbing.

---

## 6. v1 definition (the cut line)

v1 is the **bare loop, done well**:

- One map (Junkyard Park), full size-class ladder, logarithmic growth.
- 7 bots with at least 2 personas (Grazer, Hunter).
- 2:00 timer, 3-lives rule, scoring, results screen.
- League ladder with the first two leagues (Compost, Curbside).
- Installable, offline-capable PWA with IndexedDB persistence.
- Desktop + touch controls, responsive HUD, game-feel checklist (§5) complete.

**Explicitly not in v1:** combos, zones, cleanup-reveal visuals, power-ups, hazards, extra maps, cosmetics/XP, daily challenges, extra modes. All scheduled below.

---

## 7. Milestones

Small, frequent, each independently shippable. v1 = M0 + M1. Meta progression (the chosen retention priority) lands early at M3.

| # | Milestone | Contents | Exit criteria |
|---|---|---|---|
| **M0** | **Rolling prototype** | Blob, one flat map, static trash, pickup + growth + camera zoom, desktop controls. | It feels good to roll and eat for 60 seconds. |
| **M1** | **v1 — Bare loop** *(ship!)* | Junkyard Park, size classes, 2 bot personas, timer, lives, scoring, results, leagues 1–2, PWA shell (installable + offline), touch controls, audio/juice checklist. | Installed on a phone, played offline, 3 straight "one more round" matches. |
| **M2** | **Juice & scoring depth** | Combo multiplier, zone-clean bonuses, cleanup-reveal ground visuals, improved pickup/consume effects. | Median session grows vs. v1 baseline. |
| **M3** | **Meta progression** | XP per match, unlockable blob skins (mud, compost, glitter-sludge, lava, snowball), trails, consume-sound variants, league badges. Cosmetic only. Local stats page (lifetime trash eaten, biggest blob, etc.). | First unlock reachable in ~3 matches; save export/import works. |
| **M4** | **Map 2 + hazards** | Boardwalk Dump; wave and seagull hazards; hazard framework (mass-shedding on contact, hits big blobs proportionally harder — the comeback mechanic). League 3 (Landfill) gates the new map. | New map + league playable end-to-end. |
| **M5** | **Zen mode + level select** | No timer, no lives, no bots, no hazards — clean the map to 100% at your own pace with ambient audio. Level select: play any unlocked map in either mode. Session results (time, % cleaned); reduced XP so the ladder still matters. | A zen session runs start-to-results on every unlocked map. |
| **M6** | **The Deep End** *(underwater)* | Seabed arena; current hazard (drifts trash and blobs across lanes) + jellyfish hazard (contact sting sheds mass, comeback-scaled). League 4 (Scrapheap) gates the map. | New map + league playable end-to-end. |
| **M7** | **Junk Orbit** *(space)* | Orbital scrapyard arena; low-traction drift movement; asteroid + UFO tractor-beam hazards. League 5 (Wasteland) gates the map. | New map + league playable end-to-end. |
| **M8** | **Bots 2.0 & power-ups** | Sweeper + Opportunist personas; per-league bot tuning pass; power-up pickups: Magnet, Turbo, Trash Shield, Shrink Ray. | Bots visibly distinct; each power-up creates a story. |
| **M9** | **Scrap City + Golden Trash** | Scrap City + compactor hazard; Golden Dumpster event (once per match, map-wide ping, guaranteed brawl); gated by Trashlord. | Full league ladder tension from mid-game events. |
| **M10** | **Dailies** | **Daily seeded run** (same deterministic seed each day, personal-best tracking + streaks); 3 rotating daily challenges. | A reason to open the game every day, offline. |
| **M11** | **Trashlord polish** | Final league (Trashlord) with elite bots; achievements; performance/battery pass; app-icon & splash polish; optional custom art swap begins. | "Feature complete" — future work is content drops. |
| **M12** | **More unlockables** | A second wave of cosmetics past the M3 set: Confetti Trail, Rust Bucket skin, Clang Pops sound, Golden Blob skin (a nod to M9's Golden Dumpster). Same XP-threshold unlock model, no new systems. | Every league-capped player still has a reason to keep playing for XP. |

Cadence intent: M0–M1 as fast as possible; M2+ sized so each is a small, shippable release (days-to-a-couple-weeks of scope, not months).

---

## 8. Success metrics (all measured locally, shown on the stats page)

| Metric | Target |
|---|---|
| First-session matches played | ≥ 3 |
| Match completion rate | ≥ 90% |
| PWA install rate (of players reaching 2+ matches) | ≥ 20% |
| Median frame rate on mid-range phone | ≥ 55fps |
| Cold load, repeat visit (offline) | < 2s |

---

## 9. Open questions

1. Exact growth-curve and league-point constants — tune during M0/M1 playtests.
2. Should demotion exist at all, or is the ladder promote-only? (Current spec: demotion possible, floor at Compost — revisit after M1 feedback.)
3. Spectate-after-3rd-death vs. straight to results — playtest both in M1.
4. Name check: "Trashlands" appears as a zone name in Borderlands 3; likely fine for an unrelated title, but do a quick trademark search before any public launch page.
