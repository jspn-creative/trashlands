import { Container } from "pixi.js";
import { clamp } from "./config";

/** Smoothed follow-camera; zooms out as the blob grows. Supports screen-shake. */
export class Camera {
  x: number;
  y: number;
  zoom: number;
  /** Set false via settings to disable shake (accessibility). */
  shakeEnabled = true;
  private shakeAmp = 0;

  constructor(x: number, y: number, zoom: number) {
    this.x = x;
    this.y = y;
    this.zoom = zoom;
  }

  /**
   * Zoom for the blob's size, scaled down on small screens so phones see a
   * comparable slice of the world instead of a claustrophobic close-up.
   * On phones the early-game zoom is additionally capped so at least ~470
   * world units fit across the short axis — you can see food and threats
   * from the first second, not after you've already grown.
   */
  static zoomForRadius(radius: number, screenMin: number): number {
    const cap = screenMin < 640 ? screenMin / 470 : 2.2;
    const fit = clamp(screenMin / 900, 0.52, 1);
    return clamp(Math.pow(64 / radius, 0.8) * fit, 0.3, cap);
  }

  shake(amount: number): void {
    if (this.shakeEnabled) this.shakeAmp = Math.min(this.shakeAmp + amount, 26);
  }

  update(dt: number, targetX: number, targetY: number, targetZoom: number): void {
    const posBlend = 1 - Math.exp(-5 * dt);
    const zoomBlend = 1 - Math.exp(-2.5 * dt);
    this.x += (targetX - this.x) * posBlend;
    this.y += (targetY - this.y) * posBlend;
    this.zoom += (targetZoom - this.zoom) * zoomBlend;
    this.shakeAmp *= Math.exp(-7 * dt);
  }

  apply(world: Container, screenW: number, screenH: number): void {
    // Shake is render-only jitter; the simulation never sees it.
    const sx = this.shakeAmp > 0.3 ? (Math.random() * 2 - 1) * this.shakeAmp : 0;
    const sy = this.shakeAmp > 0.3 ? (Math.random() * 2 - 1) * this.shakeAmp : 0;
    world.scale.set(this.zoom);
    world.position.set(
      screenW / 2 - this.x * this.zoom + sx,
      screenH / 2 - this.y * this.zoom + sy,
    );
  }

  screenToWorld(sx: number, sy: number, screenW: number, screenH: number): { x: number; y: number } {
    return {
      x: this.x + (sx - screenW / 2) / this.zoom,
      y: this.y + (sy - screenH / 2) / this.zoom,
    };
  }
}
