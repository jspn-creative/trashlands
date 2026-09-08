import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import { Blob } from "./blob";
import { BotDriver, Persona } from "./bots";
import { Camera } from "./camera";
import { CleanupLayer } from "./cleanup";
import {
  BOT_COUNT,
  classForMass,
  classProgress,
  COMBO_WINDOW,
  comboMult,
  MATCH_TIME,
  PLAYER_LIVES,
  START_MASS,
  STEP,
  WORLD_SIZE,
} from "./config";
import { GoldenDeps, GoldenDumpster } from "./golden";
import { buildHazard, Hazard } from "./hazards";
import { COMBO_COLORS, Hud, LeaderboardRow } from "./hud";
import { Input } from "./input";
import { botTuning, BotTuning, MAX_LEAGUE } from "./league";
import { MapSpec, SHORE } from "./maps";
import { PowerupField, PowerupPickup } from "./powerups";
import { Rng } from "./rng";
import { Sound } from "./sound";
import { CLASS_LABELS, TrashField, TrashItem, Zone } from "./trash";
import { SkinSpec } from "./unlocks";

interface Popup {
  text: Text;
  age: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  dur: number;
  r: number;
  color: number;
}

/** Accent color per trash class for eat-puffs. */
const PARTICLE_COLORS = [0xe8c97a, 0x8fd0e8, 0x9aa3c9, 0x8fbf8f];

const POPUP_STYLE = new TextStyle({
  fontFamily: ["Baloo 2", "Verdana", "sans-serif"],
  fontSize: 20,
  fontWeight: "800",
  fill: 0xfff3b0,
  stroke: { color: 0x2f2418, width: 4 },
});

const LABEL_STYLE = new TextStyle({
  fontFamily: ["Baloo 2", "Verdana", "sans-serif"],
  fontSize: 13.5,
  fontWeight: "600",
  fill: 0xf2e9e4,
  stroke: { color: 0x2f2418, width: 3 },
});

const BOT_ROSTER: { name: string; color: number; persona: Persona }[] = [
  { name: "Binny", color: 0x5b8dd9, persona: "grazer" },
  { name: "Rusty", color: 0xb0563c, persona: "hunter" },
  { name: "Sludge", color: 0x4fae9e, persona: "grazer" },
  { name: "Gunk", color: 0x8a63c9, persona: "hunter" },
  { name: "Musty", color: 0xa8a83f, persona: "grazer" },
  { name: "Scrappy", color: 0x3fae7a, persona: "sweeper" },
  { name: "Whiff", color: 0x6e7f4a, persona: "hunter" },
];
/** Second-league-and-up alternate for Crusty — swapped in once Opportunist unlocks. */
const OPPORTUNIST: { name: string; color: number; persona: Persona } = {
  name: "Snatch",
  color: 0xe08a2c,
  persona: "opportunist",
};

/**
 * Bot variety ramps with league so Compost/Curbside stay simple (grazers and
 * hunters only — the league you're supposed to win), Sweepers show up once
 * bots get sharp enough to work a zone, and Opportunists arrive at the top
 * tiers to punish anyone leaving a zone half-finished (PRD M8). The roster is
 * always 7 long — new personas swap in for an existing slot, never appended
 * past what BOT_COUNT actually iterates.
 */
function rosterForLeague(league: number): { name: string; color: number; persona: Persona }[] {
  return BOT_ROSTER.map((r, i) => {
    if (r.persona === "sweeper" && league < 2) {
      return { name: "Crusty", color: 0xd9709c, persona: "grazer" as Persona };
    }
    if (i === 4 && league >= 3) return OPPORTUNIST; // takes Musty's slot
    // Trashlord (M11): elite roster — the last two grazers sharpen up too, so
    // there's nowhere easy left to farm once you've reached the top league.
    if (league >= MAX_LEAGUE && r.persona === "grazer") {
      if (i === 0) return { name: r.name, color: r.color, persona: "hunter" as Persona };
      if (i === 2) return { name: r.name, color: r.color, persona: "opportunist" as Persona };
    }
    return r;
  });
}

export interface MatchOptions {
  league: number;
  seed: number;
  shakeEnabled: boolean;
  /** Equipped cosmetics (M3). */
  skin: SkinSpec;
  trail: string;
  /** Arena to play (M4). */
  map: MapSpec;
  /** Zen mode (M5): no timer, no lives, no bots, no hazards — just cleaning. */
  zen: boolean;
  onEnd: (result: MatchResult) => void;
}

export interface MatchResult {
  placement: number;
  score: number;
  kills: number;
  livesLeft: number;
  /** "" if nothing was eaten. */
  biggestLabel: string;
  /** Best combo multiplier reached (1 if never chained). */
  bestCombo: number;
  /** Percent of all trash on the map that got eaten (by anyone), 0–100. */
  cleanedPct: number;
  /** Cleanup zones the player personally finished. */
  zonesCleaned: number;
  /** Trash items the player personally ate (lifetime stats). */
  trashEaten: number;
  /** Player's final size class this match (lifetime stats). */
  biggestClass: number;
  /** Seconds the session ran (zen results show this). */
  duration: number;
  /** True when the session was zen mode. */
  zen: boolean;
  rows: LeaderboardRow[];
}

/** Per-zone world visuals: dashed ring + name + live remaining count. */
interface ZoneView {
  zone: Zone;
  container: Container;
  count: Text;
  lastRemaining: number;
}

export class Game {
  private readonly root = new Container();
  private readonly world = new Container();
  private readonly popupLayer = new Container();
  private readonly labelLayer = new Container();
  readonly player: Blob;
  private readonly blobs: Blob[] = [];
  private readonly bots: BotDriver[] = [];
  private readonly botLabels = new Map<Blob, Text>();
  private readonly crown: Graphics;
  private readonly field: TrashField;
  private readonly camera: Camera;
  private readonly hud = new Hud();
  private readonly reticle: Graphics;
  private readonly joystick: Graphics;
  private readonly rng: Rng;
  private readonly tuning: BotTuning;

  private readonly cleanup: CleanupLayer;
  private readonly zoneViews: ZoneView[] = [];
  private readonly hazards: Hazard[] = [];
  private readonly powerups: PowerupField | null = null;
  private readonly golden: GoldenDumpster | null = null;

  private playing = false;
  private over = false;
  paused = false;
  private elapsed = 0;
  private timeLeft = MATCH_TIME;
  private lives = PLAYER_LIVES;
  private lastWholeSec = MATCH_TIME;
  private biggestCls = 0;
  private rivalEaten = false;
  private bestCombo = 1;
  private trashEaten = 0;
  private playerTrash = 0;
  private playerZones = 0;
  private zenMilestone = 0;
  private trailTimer = 0;
  private accumulator = 0;
  private readonly popups: Popup[] = [];
  private readonly particles: Particle[] = [];
  private readonly particleG = new Graphics();
  private readonly ringG = new Graphics();
  private ringPhase = 0;
  private readonly queryBuf: TrashItem[] = [];
  private readonly tick = (t: { deltaMS: number }) => this.frame(t.deltaMS / 1000);

  constructor(
    private readonly app: Application,
    private readonly input: Input,
    private readonly sound: Sound,
    private readonly opts: MatchOptions,
  ) {
    this.rng = new Rng(opts.seed);
    this.tuning = botTuning(opts.league);

    this.world.addChild(opts.map.buildGround(this.rng));
    this.cleanup = new CleanupLayer(app.renderer, this.rng);
    this.world.addChild(this.cleanup.container);

    const trashLayer = new Container();
    this.field = new TrashField(
      app.renderer,
      trashLayer,
      this.rng,
      opts.map.zoneNames,
      opts.map.spawnMaxX,
    );

    const zoneLayer = new Container();
    for (const zone of this.field.zones) {
      const view = buildZoneView(zone);
      this.zoneViews.push(view);
      zoneLayer.addChild(view.container);
    }
    this.world.addChild(zoneLayer);

    this.player = new Blob(this.rng, {
      name: "You",
      color: opts.skin.base,
      isPlayer: true,
      x: WORLD_SIZE / 2,
      y: WORLD_SIZE / 2,
      accent: opts.skin.accent,
    });
    // Low-traction maps (Junk Orbit): everyone skids, players and bots alike.
    if (opts.map.drift) this.player.traction = 0.4;
    this.blobs.push(this.player);

    const blobLayer = new Container();
    blobLayer.addChild(this.player.container);
    // Zen is a solo cleanup — no rivals, no hazards, no clock (M5).
    const roster = rosterForLeague(opts.league);
    for (let i = 0; i < (opts.zen ? 0 : BOT_COUNT); i++) {
      const spec = roster[i % roster.length];
      const ang = (i / BOT_COUNT) * Math.PI * 2 + this.rng.range(-0.3, 0.3);
      const dist = this.rng.range(1250, 1800);
      const bot = new Blob(this.rng, {
        name: spec.name,
        color: spec.color,
        isPlayer: false,
        x: WORLD_SIZE / 2 + Math.cos(ang) * dist,
        y: WORLD_SIZE / 2 + Math.sin(ang) * dist,
      });
      bot.speedMult = this.tuning.speedMult;
      if (opts.map.drift) bot.traction = 0.4;
      this.blobs.push(bot);
      this.bots.push(new BotDriver(bot, spec.persona, new Rng(opts.seed + 31 * (i + 1))));
      blobLayer.addChild(bot.container);

      const label = new Text({ text: spec.name, style: LABEL_STYLE.clone() });
      label.anchor.set(0.5, 1);
      this.botLabels.set(bot, label);
      this.labelLayer.addChild(label);
    }

    // Power-ups (M8) — same "solo cleanup, nothing else" rule as hazards/bots for zen.
    if (!opts.zen) {
      this.powerups = new PowerupField(app.renderer, opts.map.spawnMaxX, this.rng);
      this.world.addChild(this.powerups.container);
    }

    // Golden Dumpster (M9) — once-per-match map-wide event, Scrap City only.
    let goldenDeps: GoldenDeps | null = null;
    if (!opts.zen && opts.map.goldenDumpster) {
      goldenDeps = {
        blobs: this.blobs,
        field: this.field,
        rng: this.rng,
        sound: this.sound,
        camera: null as unknown as Camera, // set right after camera creation below
        popup: (msg: string, x: number, y: number, color?: number) => this.spawnPopup(msg, x, y, color),
        announce: (msg: string, dur?: number) => this.hud.announce(msg, dur),
        nearPlayer: (x: number, y: number) => this.nearPlayer(x, y),
      };
      this.golden = new GoldenDumpster(goldenDeps, MATCH_TIME);
      this.world.addChild(this.golden.container);
    }

    this.crown = buildCrown();
    this.world.addChild(
      trashLayer,
      this.ringG,
      blobLayer,
      this.particleG,
      this.crown,
      this.labelLayer,
      this.popupLayer,
    );

    // Map hazards (M4). Water floods over blobs; the gull flies over everything.
    const hazardDeps = {
      blobs: this.blobs,
      field: this.field,
      rng: this.rng,
      sound: this.sound,
      camera: null as unknown as Camera, // set right after camera creation below
      shore: SHORE,
      popup: (msg: string, x: number, y: number, color?: number) =>
        this.spawnPopup(msg, x, y, color),
      announce: (msg: string, dur?: number) => this.hud.announce(msg, dur),
      nearPlayer: (x: number, y: number) => this.nearPlayer(x, y),
    };
    if (!opts.zen) {
      for (const kind of opts.map.hazards) {
        const hazard = buildHazard(kind, hazardDeps);
        this.hazards.push(hazard);
        this.world.addChild(hazard.container);
      }
    }

    this.camera = new Camera(
      this.player.x,
      this.player.y,
      Camera.zoomForRadius(this.player.radius, Math.min(app.screen.width, app.screen.height)),
    );
    this.camera.shakeEnabled = opts.shakeEnabled;
    hazardDeps.camera = this.camera;
    if (goldenDeps) goldenDeps.camera = this.camera;
    this.reticle = buildReticle();
    this.joystick = new Graphics();
    this.joystick.visible = false;

    this.root.addChild(this.world, this.joystick, this.reticle, this.hud.container);
    app.stage.addChild(this.root);
    app.ticker.add(this.tick);
  }

  /** Called by the home/results screen; starts the clock. */
  play(): void {
    this.playing = true;
    this.sound.unlock();
    if (this.opts.zen) {
      this.sound.startAmbient();
      this.hud.announce("BREATHE IN… CLEAN UP", 2);
    } else {
      this.hud.announce("GO!", 1.1);
    }
  }

  /** Zen only: wrap up early and collect the session results. */
  finish(): void {
    this.endMatch();
  }

  /** True while a pausable match is running. */
  get pausable(): boolean {
    return this.playing && !this.over;
  }

  pause(): void {
    if (this.pausable) this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.accumulator = 0;
  }

  destroy(): void {
    this.sound.stopAmbient();
    this.app.ticker.remove(this.tick);
    this.app.stage.removeChild(this.root);
    // Trash textures are cached module-wide; sprites must not destroy them.
    this.root.destroy({ children: true, texture: false });
    this.cleanup.destroyTexture();
  }

  private frame(dt: number): void {
    if (this.paused) {
      this.render(0);
      return;
    }
    // Fixed-timestep sim; cap catch-up so a background tab doesn't spiral.
    this.accumulator = Math.min(this.accumulator + dt, 0.25);
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      if (this.playing && !this.over) this.step(STEP);
    }
    this.render(dt);
  }

  private step(dt: number): void {
    this.elapsed += dt;

    if (this.opts.zen) {
      // No clock pressure; the session ends when the map is spotless.
      if (this.trashEaten >= this.field.items.length) {
        this.hud.announce("SPARKLING CLEAN! ✨", 3);
        this.endMatch();
        return;
      }
    } else {
      this.timeLeft -= dt;
      const whole = Math.ceil(this.timeLeft);
      if (whole !== this.lastWholeSec) {
        this.lastWholeSec = whole;
        if (whole > 0 && whole <= 3) this.sound.tick();
      }
      if (this.timeLeft <= 0) {
        this.endMatch();
        return;
      }
    }

    // Respawns.
    for (const b of this.blobs) {
      if (b.alive) continue;
      b.respawnIn -= dt;
      if (b.respawnIn <= 0) this.respawn(b);
    }

    // Steering + movement.
    this.player.update(dt, this.steerDir());
    const botCtx = {
      blobs: this.blobs,
      field: this.field,
      tuning: this.tuning,
      elapsed: this.elapsed,
      buf: this.queryBuf,
      golden:
        this.golden && this.golden.active
          ? { active: true, x: this.golden.x, y: this.golden.y }
          : undefined,
    };
    for (const driver of this.bots) {
      driver.blob.update(dt, driver.update(dt, botCtx));
    }

    // Trash: eat or collide, per blob.
    for (const b of this.blobs) {
      if (b.alive) this.trashPass(b);
      if (b.alive && b.magnetTime > 0) this.magnetPull(b, dt);
    }

    // Blob-vs-blob.
    for (let i = 0; i < this.blobs.length; i++) {
      for (let j = i + 1; j < this.blobs.length; j++) {
        this.blobPair(this.blobs[i], this.blobs[j]);
        if (this.over) return;
      }
    }

    // Map hazards (waves, seagulls) run inside the fixed-timestep sim.
    for (const hazard of this.hazards) hazard.step(dt);

    // Golden Dumpster (M9): tick the event and check for a claim this frame.
    if (this.golden) this.golden.step(dt, this.elapsed);

    // Power-ups (M8): tick the field, then check every live blob against
    // every live pickup — the pool is tiny (≤4), so a flat scan is cheap.
    if (this.powerups) {
      this.powerups.step(dt);
      for (const b of this.blobs) {
        if (!b.alive) continue;
        for (const p of this.powerups.active()) {
          if (Math.hypot(b.x - p.x, b.y - p.y) < b.radius + 20) this.takePowerup(b, p);
        }
      }
    }
  }

  /** Magnet buff: nearby edible trash creeps toward the blob each frame. */
  private magnetPull(blob: Blob, dt: number): void {
    const cls = classForMass(blob.mass);
    this.field.queryCircle(blob.x, blob.y, 320, this.queryBuf);
    for (const item of this.queryBuf) {
      if (item.cls > cls) continue;
      const dx = blob.x - item.x;
      const dy = blob.y - item.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) continue;
      const step = Math.min(dist - 4, 420 * dt);
      this.field.moveItem(item, item.x + (dx / dist) * step, item.y + (dy / dist) * step);
    }
  }

  private takePowerup(blob: Blob, p: PowerupPickup): void {
    this.powerups!.take(p);
    const involvesPlayer = blob.isPlayer || this.nearPlayer(p.x, p.y);

    if (p.kind === "magnet") {
      blob.magnetTime = 8;
      if (involvesPlayer) this.sound.magnetOn();
      if (blob.isPlayer) this.spawnPopup("MAGNET!", blob.x, blob.y - blob.radius - 20, 0xd94f4f);
    } else if (p.kind === "turbo") {
      blob.turboTime = 6;
      if (involvesPlayer) this.sound.turboOn();
      if (blob.isPlayer) this.spawnPopup("TURBO!", blob.x, blob.y - blob.radius - 20, 0xf2c14e);
    } else if (p.kind === "shield") {
      blob.shieldTime = 6;
      if (involvesPlayer) this.sound.shieldOn();
      if (blob.isPlayer) this.spawnPopup("SHIELDED!", blob.x, blob.y - blob.radius - 20, 0x7ee0ff);
    } else {
      // Shrink Ray: an instant strike at the current leader — a comeback
      // tool with teeth, no aiming needed (contact does everything, PRD §4.3).
      let leader: Blob | null = null;
      for (const o of this.blobs) {
        if (!o.alive || o === blob) continue;
        if (!leader || o.score > leader.score) leader = o;
      }
      if (leader && leader.score > blob.score) {
        const cls = Math.max(1, classForMass(leader.mass) - 1);
        const lost = leader.mass * 0.22;
        leader.setMass(leader.mass - lost);
        for (let i = 0; i < 3; i++) {
          const ang = this.rng.range(0, Math.PI * 2);
          const d = leader.radius + this.rng.range(50, 140);
          this.field.spawn(cls, leader.x + Math.cos(ang) * d, leader.y + Math.sin(ang) * d, this.rng);
        }
        this.burst(leader.x, leader.y, 16, 0xb06bd9, leader.radius);
        if (leader.isPlayer || involvesPlayer) this.sound.shrinkZap();
        if (leader.isPlayer) {
          this.spawnPopup("SHRUNK!", leader.x, leader.y - leader.radius - 20, 0xb06bd9);
        }
        if (blob.isPlayer) {
          this.spawnPopup(`SHRUNK ${leader.name.toUpperCase()}!`, blob.x, blob.y - blob.radius - 20, 0xb06bd9);
        }
      } else if (blob.isPlayer) {
        this.spawnPopup("NO ONE TO SHRINK", blob.x, blob.y - blob.radius - 20, 0xb06bd9);
      }
    }
  }

  private trashPass(blob: Blob): void {
    const cls = classForMass(blob.mass);
    this.field.queryCircle(blob.x, blob.y, blob.radius + 80, this.queryBuf);

    for (const item of this.queryBuf) {
      // Too-big trash never blocks — blobs simply roll past/over it.
      if (item.cls > cls) continue;
      const dx = item.x - blob.x;
      const dy = item.y - blob.y;
      const dist = Math.hypot(dx, dy);
      // Edible: absorb once mostly enveloped.
      if (dist < blob.radius + item.radius * 0.3) {
        this.absorbTrash(blob, item, Math.atan2(dy, dx));
      }
    }
  }

  private absorbTrash(blob: Blob, item: TrashItem, worldAngle: number): void {
    const prevMult = comboMult(blob.combo);
    blob.absorb(item.mass, item.sprite.texture, worldAngle);
    // Bots' combos cap per league; the player can always chain to ×5.
    const mult = blob.isPlayer
      ? comboMult(blob.combo)
      : Math.min(this.tuning.comboCap, comboMult(blob.combo));
    const points = item.points * mult;
    blob.score += points;

    if (blob.isPlayer) {
      this.sound.pop(item.cls, mult);
      if (item.cls >= 4) this.camera.shake(8);
      this.spawnPopup(`+${points}`, item.x, item.y - item.radius, COMBO_COLORS[mult]);
      if (mult > prevMult) {
        this.sound.comboUp(mult);
        this.spawnPopup(`COMBO ×${mult}!`, blob.x, blob.y - blob.radius - 30, COMBO_COLORS[mult], 1.25);
      }
      if (mult > this.bestCombo) this.bestCombo = mult;
      if (item.cls > this.biggestCls) this.biggestCls = item.cls;
      this.playerTrash++;
    } else if (this.nearPlayer(item.x, item.y)) {
      this.sound.pop(item.cls);
    }
    this.burst(item.x, item.y, 4 + item.cls * 2, PARTICLE_COLORS[item.cls - 1], item.radius);

    // The ground under eaten trash comes back clean (PRD §3.2).
    this.trashEaten++;
    this.cleanup.clean(item.x, item.y, item.radius * 2.2 + 46);
    this.cleanup.maybeFlower(item.x, item.y, this.rng);

    // Zen milestones: a gentle cheer at every quarter of the map.
    if (this.opts.zen) {
      const pct = Math.floor((100 * this.trashEaten) / this.field.items.length);
      if (pct >= this.zenMilestone + 25 && pct < 100) {
        this.zenMilestone = Math.floor(pct / 25) * 25;
        this.hud.announce(`${this.zenMilestone}% CLEAN`, 1.4);
      }
    }

    const cleared = this.field.remove(item);
    if (cleared) this.zoneCleaned(cleared, blob);
  }

  /** A zone just lost its last piece of trash — pay out and celebrate. */
  private zoneCleaned(zone: Zone, blob: Blob): void {
    blob.score += zone.bonus;
    this.cleanup.clean(zone.x, zone.y, zone.radius * 1.05);
    this.cleanup.flowerBurst(zone.x, zone.y, zone.radius, this.rng);
    this.burst(zone.x, zone.y, 26, 0x9be86f, zone.radius * 0.5);

    if (blob.isPlayer) {
      this.playerZones++;
      this.sound.zoneClear();
      this.camera.shake(6);
      this.hud.announce(`${zone.name.toUpperCase()} CLEANED!  +${zone.bonus}`, 2);
      this.spawnPopup(`+${zone.bonus}`, zone.x, zone.y, 0x9be86f, 1.4);
    } else {
      if (this.nearPlayer(zone.x, zone.y)) this.sound.zoneClear();
      this.spawnPopup(`${blob.name} cleaned ${zone.name}`, zone.x, zone.y, 0xd8e8c9);
    }
  }

  private blobPair(a: Blob, b: Blob): void {
    if (!a.alive || !b.alive) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= a.radius + b.radius) return;

    const clsA = classForMass(a.mass);
    const clsB = classForMass(b.mass);

    // Predator vs. prey: no bounce — the smaller blob gets rolled over and
    // swallowed once mostly enveloped. (Bouncing here would push the victim
    // out before the swallow threshold could ever be reached.) A Trash
    // Shield (M8) blocks the swallow exactly like post-respawn invuln.
    if (clsA >= clsB + 1 && b.invuln <= 0 && b.shieldTime <= 0) {
      if (dist < a.radius + b.radius * 0.25) this.eatBlob(a, b);
      return;
    }
    if (clsB >= clsA + 1 && a.invuln <= 0 && a.shieldTime <= 0) {
      if (dist < b.radius + a.radius * 0.25) this.eatBlob(b, a);
      return;
    }

    // Near-equal: bounce apart (heavier blob budges less).
    if (dist < 0.001) return;
    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = a.radius + b.radius - dist;
    const total = a.mass + b.mass;
    a.x -= nx * overlap * (b.mass / total);
    a.y -= ny * overlap * (b.mass / total);
    b.x += nx * overlap * (a.mass / total);
    b.y += ny * overlap * (a.mass / total);

    const relV = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (relV > 0) {
      const bounce = relV * 1.4;
      a.vx -= nx * bounce * (b.mass / total);
      a.vy -= ny * bounce * (b.mass / total);
      b.vx += nx * bounce * (a.mass / total);
      b.vy += ny * bounce * (a.mass / total);

      // Hard skirmishes knock a few objects loose for either side to steal.
      if (relV > 240) {
        if (a.isPlayer || b.isPlayer) {
          this.sound.bounce();
          this.camera.shake(5);
        }
        this.shed(a, nx, ny);
        this.shed(b, -nx, -ny);
      }
    }
  }

  /** Drop 1–2 surface objects near a skirmish (PRD §2.4). */
  private shed(blob: Blob, awayX: number, awayY: number): void {
    if (blob.shedCooldown > 0 || blob.mass < 45) return;
    blob.shedCooldown = 1.5;
    const cls = Math.max(1, classForMass(blob.mass) - 1);
    const n = this.rng.int(1, 2);
    for (let i = 0; i < n; i++) {
      const ang = Math.atan2(awayY, awayX) + this.rng.range(-1.1, 1.1);
      const d = blob.radius + this.rng.range(50, 130);
      this.field.spawn(cls, blob.x - Math.cos(ang) * d, blob.y - Math.sin(ang) * d, this.rng);
    }
    blob.setMass(blob.mass * 0.97);
  }

  private eatBlob(eater: Blob, victim: Blob): void {
    const points = Math.round(victim.mass);
    eater.score += points;
    eater.kills++;
    eater.grow(victim.mass * 0.5);

    const involvesPlayer = eater.isPlayer || victim.isPlayer;
    if (involvesPlayer || this.nearPlayer(victim.x, victim.y)) this.sound.eatBlob();

    if (eater.isPlayer) {
      this.camera.shake(12);
      this.rivalEaten = true;
      this.spawnPopup(`+${points} ATE ${victim.name.toUpperCase()}!`, victim.x, victim.y);
    }
    this.burst(victim.x, victim.y, 18, victim.color, victim.radius);

    if (victim.isPlayer) {
      this.lives--;
      this.sound.death();
      this.camera.shake(16);
      victim.score = Math.floor(victim.score * 0.75);
      if (this.lives <= 0) {
        victim.kill(999);
        this.hud.announce("OUT OF LIVES!", 2);
        this.endMatch();
        return;
      }
      this.hud.announce(`EATEN BY ${eater.name.toUpperCase()}! −25% score`, 2.4);
      victim.kill(3);
    } else {
      victim.kill(3);
    }
  }

  private respawn(blob: Blob): void {
    // Pick the candidate spot farthest from anything that could eat us.
    const cls = classForMass(
      blob.isPlayer ? Math.max(START_MASS, blob.mass * 0.35) : START_MASS,
    );
    let bestX = WORLD_SIZE / 2;
    let bestY = WORLD_SIZE / 2;
    let bestDist = -1;
    for (let i = 0; i < 14; i++) {
      const x = this.rng.range(300, WORLD_SIZE - 300);
      const y = this.rng.range(300, WORLD_SIZE - 300);
      let nearest = Infinity;
      for (const o of this.blobs) {
        if (o === blob || !o.alive) continue;
        if (classForMass(o.mass) < cls + 1) continue;
        nearest = Math.min(nearest, Math.hypot(o.x - x, o.y - y));
      }
      if (nearest > bestDist) {
        bestDist = nearest;
        bestX = x;
        bestY = y;
      }
    }

    if (blob.isPlayer) {
      // Respawn scaled to progress so a death stings but isn't a reset.
      blob.respawnAt(bestX, bestY, Math.max(START_MASS, blob.mass * 0.35));
      this.hud.announce("BACK IN!", 1);
    } else {
      // Bots come back small — eating one is always tempo-positive.
      const progress = this.elapsed / MATCH_TIME;
      blob.respawnAt(bestX, bestY, START_MASS * (1 + 5 * progress));
    }
  }

  private endMatch(): void {
    if (this.over) return;
    this.over = true;
    this.sound.stopAmbient();
    if (!this.opts.zen) this.sound.whistle();
    const result = this.buildResult();
    window.setTimeout(() => this.opts.onEnd(result), 1100);
  }

  private buildResult(): MatchResult {
    const rows = this.leaderboard(this.blobs.length);
    const placement = rows.find((r) => r.isPlayer)?.rank ?? this.blobs.length;
    let biggestLabel = "";
    if (this.rivalEaten) biggestLabel = "A Rival Blob";
    else if (this.biggestCls > 0) biggestLabel = CLASS_LABELS[this.biggestCls - 1];
    return {
      placement,
      score: this.player.score,
      kills: this.player.kills,
      livesLeft: Math.max(0, this.lives),
      biggestLabel,
      bestCombo: this.bestCombo,
      cleanedPct: Math.round((100 * this.trashEaten) / Math.max(1, this.field.items.length)),
      zonesCleaned: this.playerZones,
      trashEaten: this.playerTrash,
      biggestClass: classForMass(this.player.mass),
      duration: Math.round(this.elapsed),
      zen: this.opts.zen,
      rows,
    };
  }

  private leaderboard(maxRows: number): LeaderboardRow[] {
    const sorted = [...this.blobs].sort((a, b) => b.score - a.score);
    const rows: LeaderboardRow[] = sorted.map((b, i) => ({
      name: b.name,
      score: b.score,
      isPlayer: b.isPlayer,
      rank: i + 1,
    }));
    if (rows.length <= maxRows) return rows;
    const top = rows.slice(0, maxRows - 1);
    const player = rows.find((r) => r.isPlayer)!;
    return top.includes(player) ? rows.slice(0, maxRows) : [...top, player];
  }

  private nearPlayer(x: number, y: number): boolean {
    return Math.hypot(x - this.camera.x, y - this.camera.y) < 900;
  }

  private steerDir(): { x: number; y: number } | null {
    if (!this.playing || this.over || !this.player.alive) return null;
    const joy = this.input.joyDir();
    if (joy) return joy;
    const keyDir = this.input.keyDir();
    if (keyDir) return keyDir;
    if (!this.input.pointerActive || this.input.lastPointerType !== "mouse") return null;

    const target = this.camera.screenToWorld(
      this.input.pointerX,
      this.input.pointerY,
      this.app.screen.width,
      this.app.screen.height,
    );
    const dx = target.x - this.player.x;
    const dy = target.y - this.player.y;
    const dist = Math.hypot(dx, dy);
    // Proportional steering: dead on the blob = stop, then thrust ramps up
    // to full over ~2.5 radii so fine positioning near the blob is easy.
    const dead = this.player.radius * 0.5;
    if (dist < dead) return null;
    const thrust = Math.min(1, (dist - dead) / (this.player.radius * 2.5));
    return { x: (dx / dist) * thrust, y: (dy / dist) * thrust };
  }

  /** Puff of colored dust when something gets eaten. */
  private burst(x: number, y: number, n: number, color: number, spread: number): void {
    if (this.particles.length > 160) return;
    for (let i = 0; i < n; i++) {
      const ang = this.rng.range(0, Math.PI * 2);
      const speed = this.rng.range(40, 170);
      this.particles.push({
        x: x + this.rng.range(-spread, spread) * 0.4,
        y: y + this.rng.range(-spread, spread) * 0.4,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        age: 0,
        dur: this.rng.range(0.25, 0.5),
        r: this.rng.range(2.5, 6),
        color: this.rng.next() < 0.55 ? color : 0xd8c690,
      });
    }
  }

  private spawnPopup(msg: string, x: number, y: number, color?: number, size = 1): void {
    if (this.popups.length > 24) return;
    const text = new Text({ text: msg, style: POPUP_STYLE.clone() });
    if (color !== undefined) text.style.fill = color;
    text.anchor.set(0.5);
    text.position.set(x, y);
    // Counter-scale so popups read the same size at any zoom.
    text.scale.set(size / this.camera.zoom);
    this.popupLayer.addChild(text);
    this.popups.push({ text, age: 0 });
  }

  private render(dt: number): void {
    this.camera.update(
      dt,
      this.player.x,
      this.player.y,
      Camera.zoomForRadius(
        this.player.radius,
        Math.min(this.app.screen.width, this.app.screen.height),
      ),
    );
    this.camera.apply(this.world, this.app.screen.width, this.app.screen.height);
    const invZoom = 1 / this.camera.zoom;

    // Off-screen culling (M11 perf pass, PRD §4.2): skip drawing trash well
    // outside the camera's view — cheap CPU scan, real savings on big maps.
    const viewHalfW = (this.app.screen.width * invZoom) / 2 + 200;
    const viewHalfH = (this.app.screen.height * invZoom) / 2 + 200;
    this.field.cull(
      this.camera.x - viewHalfW,
      this.camera.y - viewHalfH,
      this.camera.x + viewHalfW,
      this.camera.y + viewHalfH,
    );

    // Apply this frame's cleanup-reveal stamps in one batch.
    this.cleanup.flush();

    // Zone rings: live "N left" counter; cleaned zones fade away.
    for (const v of this.zoneViews) {
      if (v.zone.cleaned) {
        v.container.alpha -= dt * 0.9;
        if (v.container.alpha <= 0) v.container.visible = false;
        continue;
      }
      if (v.zone.remaining !== v.lastRemaining) {
        v.lastRemaining = v.zone.remaining;
        v.count.text = `${v.zone.remaining} left`;
      }
    }

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.age += dt;
      if (p.age >= 0.8) {
        p.text.destroy();
        this.popups.splice(i, 1);
        continue;
      }
      p.text.y -= 46 * invZoom * dt;
      p.text.alpha = 1 - p.age / 0.8;
    }

    // Cosmetic trail behind the player (render-only, M3 unlockables).
    if (this.opts.trail && this.player.alive && !this.paused) {
      const speed = Math.hypot(this.player.vx, this.player.vy);
      this.trailTimer -= dt;
      if (speed > 60 && this.trailTimer <= 0) {
        this.trailTimer = 0.05;
        const back = Math.atan2(-this.player.vy, -this.player.vx);
        const bx = this.player.x + Math.cos(back) * this.player.radius * 0.9;
        const by = this.player.y + Math.sin(back) * this.player.radius * 0.9;
        if (this.opts.trail === "slime") {
          this.particles.push({
            x: bx + this.rng.range(-6, 6),
            y: by + this.rng.range(-6, 6),
            vx: 0,
            vy: 0,
            age: 0,
            dur: 0.6,
            r: this.player.radius * this.rng.range(0.22, 0.34),
            color: this.rng.next() < 0.6 ? 0x86c74a : 0x6aa838,
          });
        } else if (this.opts.trail === "confetti") {
          for (let i = 0; i < 2; i++) {
            this.particles.push({
              x: bx + this.rng.range(-14, 14),
              y: by + this.rng.range(-14, 14),
              vx: this.rng.range(-30, 30),
              vy: this.rng.range(-40, -10),
              age: 0,
              dur: 0.55,
              r: this.rng.range(2.5, 5),
              color: this.rng.pick([0xff6b6b, 0xffd166, 0x6bcb77, 0x5b8dd9, 0xc77dff]),
            });
          }
        } else {
          for (let i = 0; i < 2; i++) {
            this.particles.push({
              x: bx + this.rng.range(-14, 14),
              y: by + this.rng.range(-14, 14),
              vx: this.rng.range(-20, 20),
              vy: this.rng.range(-20, 20),
              age: 0,
              dur: 0.5,
              r: this.rng.range(2, 4.5),
              color: this.rng.next() < 0.5 ? 0xffffff : 0xffe9a8,
            });
          }
        }
      }
    }

    // Eat-puff particles (render-only).
    this.particleG.clear();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.dur) {
        this.particles.splice(i, 1);
        continue;
      }
      const t = p.age / p.dur;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      this.particleG.circle(p.x, p.y, p.r * (1 - t)).fill({ color: p.color, alpha: 0.85 * (1 - t) });
    }

    // Edibility rings: green = you can eat it, red = it can eat you.
    // Bot name labels tint to match; constant screen size, riding above each blob.
    this.ringPhase += dt * 4;
    const pulse = 1 + Math.sin(this.ringPhase) * 0.045;
    const myCls = classForMass(this.player.mass);
    // Darken trash the player isn't big enough to eat yet.
    this.field.setPlayerClass(myCls);
    this.ringG.clear();
    for (const [bot, label] of this.botLabels) {
      label.visible = bot.alive;
      if (!bot.alive) continue;
      label.position.set(bot.x, bot.y - bot.radius - 8 * invZoom);
      label.scale.set(invZoom);

      const cls = classForMass(bot.mass);
      let ringColor = 0;
      if (this.player.alive && cls <= myCls - 1) ringColor = 0x8fe86f;
      else if (this.player.alive && cls >= myCls + 1) ringColor = 0xff5b4d;
      label.style.fill = ringColor === 0 ? 0xf2e9e4 : ringColor;
      if (ringColor === 0) continue;

      const r = (bot.radius + 9 * invZoom) * (ringColor === 0xff5b4d ? pulse : 1);
      this.ringG
        .circle(bot.x, bot.y, r)
        .fill({ color: ringColor, alpha: 0.1 })
        .stroke({ width: 4.5 * invZoom, color: ringColor, alpha: 0.85 });
    }

    // Garbage crown for the current leader.
    let leader: Blob | null = null;
    for (const b of this.blobs) {
      if (b.alive && b.score > 0 && (!leader || b.score > leader.score)) leader = b;
    }
    this.crown.visible = !!leader;
    if (leader) {
      const labelPad = leader.isPlayer ? 6 : 26;
      this.crown.position.set(leader.x, leader.y - leader.radius - labelPad * invZoom);
      this.crown.scale.set(invZoom);
    }

    // Mouse reticle / touch joystick.
    this.reticle.visible =
      this.playing &&
      !this.over &&
      !this.paused &&
      this.input.pointerActive &&
      this.input.lastPointerType === "mouse";
    if (this.reticle.visible) {
      this.reticle.position.set(this.input.pointerX, this.input.pointerY);
    }
    this.joystick.visible = this.playing && !this.over && !this.paused && this.input.joyActive;
    if (this.joystick.visible) {
      const dx = this.input.joyX - this.input.joyOriginX;
      const dy = this.input.joyY - this.input.joyOriginY;
      const len = Math.hypot(dx, dy);
      const cl = Math.min(len, 70);
      const kx = len > 0.01 ? (dx / len) * cl : 0;
      const ky = len > 0.01 ? (dy / len) * cl : 0;
      this.joystick
        .clear()
        .circle(this.input.joyOriginX, this.input.joyOriginY, 70)
        .fill({ color: 0x2f2418, alpha: 0.18 })
        .stroke({ width: 3, color: 0xffffff, alpha: 0.4 })
        .circle(this.input.joyOriginX + kx, this.input.joyOriginY + ky, 32)
        .fill({ color: 0xffffff, alpha: 0.45 })
        .stroke({ width: 3, color: 0x2f2418, alpha: 0.5 });
    }

    const zen = this.opts.zen;
    this.hud.update(
      dt,
      this.player.score,
      classForMass(this.player.mass),
      classProgress(this.player.mass),
      // Zen shows time elapsed instead of a countdown.
      zen ? this.elapsed : this.timeLeft,
      Math.max(0, this.lives),
      comboMult(this.player.combo),
      this.player.comboTimer / COMBO_WINDOW,
      // Narrow screens get top 3 + you; wide screens top 5 + you.
      zen ? [] : this.leaderboard(this.app.screen.width < 640 ? 4 : 6),
      this.app.screen.width,
      this.app.screen.height,
      zen ? Math.floor((100 * this.trashEaten) / this.field.items.length) : -1,
      this.player.magnetTime,
      this.player.turboTime,
      this.player.shieldTime,
    );
  }
}

/** Big, high-contrast steering reticle drawn in place of the system cursor. */
function buildReticle(): Graphics {
  const g = new Graphics();
  g.circle(0, 0, 15).stroke({ width: 7, color: 0x2f2418, alpha: 0.9 });
  g.circle(0, 0, 15).stroke({ width: 3.5, color: 0xffffff });
  for (const [tx, ty] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    g.moveTo(tx * 19, ty * 19)
      .lineTo(tx * 27, ty * 27)
      .stroke({ width: 7, color: 0x2f2418, alpha: 0.9 });
    g.moveTo(tx * 19, ty * 19)
      .lineTo(tx * 27, ty * 27)
      .stroke({ width: 3.5, color: 0xffffff });
  }
  g.circle(0, 0, 3.5).fill(0x2f2418);
  g.circle(0, 0, 2).fill(0xffffff);
  g.visible = false;
  return g;
}

/** Dashed ring, name banner, and remaining-count for a cleanup zone. */
function buildZoneView(zone: Zone): ZoneView {
  const container = new Container();
  container.position.set(zone.x, zone.y);

  const ring = new Graphics();
  const segments = 26;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / segments * 0.55;
    ring
      .moveTo(Math.cos(a0) * zone.radius, Math.sin(a0) * zone.radius)
      .arc(0, 0, zone.radius, a0, a1)
      .stroke({ width: 6, color: 0xf6efe4, alpha: 0.38 });
  }
  ring.circle(0, 0, zone.radius).fill({ color: 0xf6efe4, alpha: 0.045 });

  const name = new Text({
    text: zone.name.toUpperCase(),
    style: new TextStyle({
      fontFamily: ["Baloo 2", "Verdana", "sans-serif"],
      fontSize: 30,
      fontWeight: "800",
      letterSpacing: 2,
      fill: 0xf6efe4,
      stroke: { color: 0x2f2418, width: 5 },
    }),
  });
  // Centered labels stay visible while you're inside the zone; they render
  // under the trash layer, so a full zone half-hides them until you clean it.
  name.anchor.set(0.5, 1);
  name.position.set(0, -4);
  name.alpha = 0.66;

  const count = new Text({
    text: `${zone.remaining} left`,
    style: new TextStyle({
      fontFamily: ["Baloo 2", "Verdana", "sans-serif"],
      fontSize: 20,
      fontWeight: "600",
      fill: 0xd8e8c9,
      stroke: { color: 0x2f2418, width: 4 },
    }),
  });
  count.anchor.set(0.5, 0);
  count.position.set(0, 2);
  count.alpha = 0.66;

  container.addChild(ring, name, count);
  return { zone, container, count, lastRemaining: zone.remaining };
}

/** Garbage crown for the score leader (anchor at bottom-center). */
function buildCrown(): Graphics {
  const g = new Graphics();
  g.poly([-16, 0, -16, -12, -8, -4, 0, -16, 8, -4, 16, -12, 16, 0])
    .fill(0xf2c14e)
    .stroke({ width: 2.5, color: 0x8f6b1d });
  g.circle(-8, -3, 2).fill(0xd94f4f);
  g.circle(8, -3, 2).fill(0x5b8dd9);
  g.visible = false;
  g.pivot.set(0, 2);
  return g;
}

