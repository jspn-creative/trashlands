import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { CLASSES, PLAYER_LIVES } from "./config";
import { safeArea } from "./safearea";

const FONT = ["Baloo 2", "Verdana", "sans-serif"];
const BAR_H = 16;
const LB_ROW_H = 24;
const LB_ROWS = 6; // top 5 + the player's own row when outside the top 5
/** Below this width the HUD compacts: leaderboard drops below the timer, bar narrows. */
const NARROW = 640;

export interface LeaderboardRow {
  name: string;
  score: number;
  isPlayer: boolean;
  rank: number;
}

/** Combo tier colors, ×2 → ×5 (matches popup colors in game.ts). */
export const COMBO_COLORS: Record<number, number> = {
  2: 0xffd36b,
  3: 0xffa94d,
  4: 0xff7f50,
  5: 0xff5b4d,
};

export class Hud {
  readonly container = new Container();
  private readonly scorePanel: Graphics;
  private readonly scoreText: Text;
  private readonly timerPanel: Graphics;
  private readonly timerText: Text;
  private readonly classText: Text;
  private readonly announceText: Text;
  private readonly barG: Graphics;
  private readonly livesG: Graphics;
  private readonly comboText: Text;
  private readonly comboBar: Graphics;
  private readonly zenText: Text;
  private readonly buffsText: Text;
  private lastBuffs = "";
  private lastCombo = 1;
  private lastZenPct = -1;
  private readonly lbPanel: Graphics;
  private readonly lbTexts: Text[] = [];
  private lastScore = -1;
  private lastTopY = -1;
  private lastInsetLeft = -1;
  private lastClass = -1;
  private lastTime = -1;
  private lastLives = -1;
  private announceAge = 0;
  private announceDur = 0;

  constructor() {
    const big = new TextStyle({
      fontFamily: FONT,
      fontSize: 27,
      fontWeight: "800",
      fill: 0xffffff,
      stroke: { color: 0x2f2418, width: 5 },
    });
    const small = new TextStyle({
      fontFamily: FONT,
      fontSize: 15.5,
      fontWeight: "600",
      fill: 0xf2e9e4,
      stroke: { color: 0x2f2418, width: 3.5 },
    });

    this.scorePanel = new Graphics();
    this.scoreText = new Text({ text: "0", style: big });
    this.scoreText.position.set(26, 12);

    this.timerPanel = new Graphics();
    this.timerText = new Text({ text: "2:00", style: big.clone() });
    this.timerText.anchor.set(0.5, 0);

    this.classText = new Text({ text: "", style: small });
    this.classText.anchor.set(0.5, 0);

    this.announceText = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: FONT,
        fontSize: 44,
        fontWeight: "800",
        fill: 0xfff3b0,
        stroke: { color: 0x2f2418, width: 8 },
        align: "center",
        wordWrap: true,
        wordWrapWidth: 600,
        breakWords: false,
        dropShadow: { distance: 4, angle: Math.PI / 2, alpha: 0.35, blur: 2 },
      }),
    });
    this.announceText.anchor.set(0.5);
    this.announceText.visible = false;

    this.lbPanel = new Graphics();
    for (let i = 0; i < LB_ROWS; i++) {
      const t = new Text({ text: "", style: small.clone() });
      t.anchor.set(1, 0);
      this.lbTexts.push(t);
    }

    this.barG = new Graphics();
    this.livesG = new Graphics();

    this.comboText = new Text({ text: "", style: big.clone() });
    this.comboText.style.fontSize = 30;
    this.comboText.anchor.set(0.5);
    this.comboText.visible = false;
    this.comboBar = new Graphics();

    this.zenText = new Text({ text: "", style: small.clone() });
    this.zenText.anchor.set(0.5, 0);
    this.zenText.visible = false;

    this.buffsText = new Text({ text: "", style: small.clone() });
    this.buffsText.position.set(14, 106);
    this.buffsText.visible = false;

    this.container.addChild(
      this.scorePanel,
      this.scoreText,
      this.timerPanel,
      this.timerText,
      this.classText,
      this.barG,
      this.livesG,
      this.buffsText,
      this.comboBar,
      this.comboText,
      this.zenText,
      this.lbPanel,
      ...this.lbTexts,
      this.announceText,
    );
  }

  /** Center-screen flash message ("GO!", "EATEN!", …). */
  announce(text: string, dur = 1.6): void {
    this.announceText.text = text;
    this.announceText.visible = true;
    this.announceAge = 0;
    this.announceDur = dur;
  }

  update(
    dt: number,
    score: number,
    cls: number,
    progress: number,
    timeLeft: number,
    lives: number,
    comboMult: number,
    comboFrac: number,
    rows: LeaderboardRow[],
    screenW: number,
    screenH: number,
    /** ≥ 0 switches the HUD to zen: count-up clock, no lives, % cleaned. */
    zenPct = -1,
    /** Player's active power-up timers (M8); 0 = inactive. */
    magnetTime = 0,
    turboTime = 0,
    shieldTime = 0,
  ): void {
    const zenMode = zenPct >= 0;
    // Clear the notch, plus a flat 8px bump; the inset is 0 on desktop, so there that bump is the only change.
    const inset = safeArea();
    const topY = inset.top + 8;

    // The pill only needs rebuilding when its width or origin moves, and rotating changes the inset.
    if (score !== this.lastScore || topY !== this.lastTopY || inset.left !== this.lastInsetLeft) {
      this.lastScore = score;
      this.lastTopY = topY;
      this.lastInsetLeft = inset.left;
      this.scoreText.text = String(score);
      this.scoreText.position.set(26 + inset.left, topY + 12);
      this.scorePanel
        .clear()
        .roundRect(12 + inset.left, topY + 10, this.scoreText.width + 30, 42, 21)
        .fill({ color: 0x2f2418, alpha: 0.55 });
    }

    const secs = zenMode ? Math.floor(timeLeft) : Math.max(0, Math.ceil(timeLeft));
    if (secs !== this.lastTime) {
      this.lastTime = secs;
      this.timerText.text = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
      this.timerText.style.fill = !zenMode && secs <= 10 ? 0xff6b5b : 0xffffff;
    }
    this.timerText.position.set(screenW / 2, topY + 12);
    this.timerPanel
      .clear()
      .roundRect(screenW / 2 - 52, topY + 10, 104, 42, 21)
      .fill({ color: 0x2f2418, alpha: 0.55 });

    const narrow = screenW < NARROW;

    if (cls !== this.lastClass) {
      this.lastClass = cls;
      const next = cls < CLASSES.length ? `  →  ${CLASSES[cls].name}` : "  ·  MAX SIZE";
      this.classText.text = `${CLASSES[cls - 1].name}${next}`;
    }
    const barW = narrow ? Math.min(230, screenW - 170) : 260;
    const barX = (screenW - barW) / 2;
    const barY = screenH - 38 - inset.bottom;
    this.classText.position.set(screenW / 2, screenH - 66 - inset.bottom);
    this.barG
      .clear()
      .roundRect(barX, barY, barW, BAR_H, BAR_H / 2)
      .fill({ color: 0x2f2418, alpha: 0.66 })
      .roundRect(barX, barY, barW, BAR_H, BAR_H / 2)
      .stroke({ width: 2.5, color: 0xf2e9e4, alpha: 0.28 })
      .roundRect(
        barX + 3,
        barY + 3,
        Math.max(BAR_H - 6, (barW - 6) * progress),
        BAR_H - 6,
        (BAR_H - 6) / 2,
      )
      .fill(0x9be86f);

    if (lives !== this.lastLives) {
      this.lastLives = lives;
      this.livesG.clear();
      for (let i = 0; i < PLAYER_LIVES; i++) {
        const x = 32 + i * 32;
        if (i < lives) {
          // Mini blob face.
          this.livesG
            .circle(x, 0, 12)
            .fill(0x6f4e27)
            .stroke({ width: 3, color: 0x4a3418 })
            .circle(x - 4, -2, 2.6)
            .fill(0xffffff)
            .circle(x + 4, -2, 2.6)
            .fill(0xffffff)
            .circle(x - 4, -1.6, 1.3)
            .fill(0x2f2418)
            .circle(x + 4, -1.6, 1.3)
            .fill(0x2f2418);
        } else {
          this.livesG.circle(x, 0, 12).stroke({ width: 3, color: 0x2f2418, alpha: 0.5 });
        }
      }
    }
    // Lives live under the score pill so they never collide with the bottom bar.
    this.livesG.position.set(inset.left, topY + 76);
    this.livesG.visible = !zenMode;

    // Active power-up timers, one row under lives.
    const parts: string[] = [];
    if (magnetTime > 0) parts.push(`🧲${Math.ceil(magnetTime)}s`);
    if (turboTime > 0) parts.push(`⚡${Math.ceil(turboTime)}s`);
    if (shieldTime > 0) parts.push(`🛡${Math.ceil(shieldTime)}s`);
    const buffsStr = parts.join("  ");
    this.buffsText.visible = buffsStr.length > 0;
    if (buffsStr !== this.lastBuffs) {
      this.lastBuffs = buffsStr;
      this.buffsText.text = buffsStr;
    }
    this.buffsText.position.set(14 + inset.left, topY + 106);

    // Zen: cleaning progress rides under the timer pill.
    this.zenText.visible = zenMode;
    if (zenMode && zenPct !== this.lastZenPct) {
      this.lastZenPct = zenPct;
      this.zenText.text = `${zenPct}% cleaned`;
    }
    if (zenMode) this.zenText.position.set(screenW / 2, topY + 58);

    // Combo meter: ×N above the class bar with a draining chain-timer ring.
    const showCombo = comboMult >= 2 && comboFrac > 0;
    this.comboText.visible = showCombo;
    this.comboBar.clear();
    if (showCombo) {
      if (comboMult !== this.lastCombo) {
        this.lastCombo = comboMult;
        this.comboText.text = `×${comboMult}`;
        this.comboText.style.fill = COMBO_COLORS[comboMult] ?? 0xffd36b;
      }
      const cy = screenH - 104 - inset.bottom;
      this.comboText.position.set(screenW / 2, cy);
      // Little pop when the tier changes, settling back to 1.
      const s = 1 + Math.max(0, comboFrac - 0.82) * 1.6;
      this.comboText.scale.set(s);
      const w = 64;
      this.comboBar
        .roundRect(screenW / 2 - w / 2, cy + 20, w, 6, 3)
        .fill({ color: 0x2f2418, alpha: 0.6 })
        .roundRect(screenW / 2 - w / 2, cy + 20, Math.max(6, w * comboFrac), 6, 3)
        .fill(COMBO_COLORS[comboMult] ?? 0xffd36b);
    } else {
      this.lastCombo = 1;
    }

    // On narrow screens the leaderboard drops below the timer pill. Pinned top-right, so it needs both insets.
    const lbW = narrow ? 164 : 200;
    const lbY = (narrow ? 62 : 10) + inset.top + 8;
    let visible = 0;
    for (let i = 0; i < LB_ROWS; i++) {
      const t = this.lbTexts[i];
      const row = rows[i];
      if (!row) {
        t.visible = false;
        continue;
      }
      visible++;
      t.visible = true;
      t.text = `${row.rank}. ${row.isPlayer ? "You" : row.name}   ${row.score}`;
      if (row.isPlayer) t.style.fill = 0x9be86f;
      t.position.set(screenW - 26 - inset.right, lbY + 8 + i * LB_ROW_H);
    }
    this.lbPanel.clear();
    if (visible > 0) {
      this.lbPanel
        .roundRect(screenW - lbW - 14 - inset.right, lbY, lbW, visible * LB_ROW_H + 16, 14)
        .fill({ color: 0x2f2418, alpha: 0.55 });
    }

    if (this.announceText.visible) {
      this.announceAge += dt;
      const a = this.announceAge;
      if (a >= this.announceDur) {
        this.announceText.visible = false;
      } else {
        // Responsive headings: shrink and wrap on narrow screens so long
        // notices like "VOLLEYBALL COURT CLEANED! +200" fit on phones.
        const targetSize = screenW < 380 ? 28 : screenW < NARROW ? 34 : 44;
        const targetWrap = Math.max(280, screenW - 48);
        const aStyle = this.announceText.style;
        if (aStyle.fontSize !== targetSize) {
          aStyle.fontSize = targetSize;
          aStyle.stroke = {
            color: 0x2f2418,
            width: Math.max(5, Math.round(targetSize * 0.18)),
          };
          aStyle.lineHeight = Math.round(targetSize * 1.12);
        }
        if (aStyle.wordWrapWidth !== targetWrap) {
          aStyle.wordWrap = true;
          aStyle.wordWrapWidth = targetWrap;
        }
        this.announceText.position.set(screenW / 2, screenH * 0.34);
        this.announceText.alpha = Math.min(1, (this.announceDur - a) / 0.4);
        this.announceText.scale.set(Math.min(1, 0.7 + a * 3));
      }
    }
  }
}
