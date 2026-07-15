/**
 * Keyboard + pointer state. Mouse steers via follow-the-cursor; touch uses a
 * floating virtual joystick (thumb-down anywhere sets the stick's origin).
 */
export class Input {
  readonly keys = new Set<string>();

  // Mouse-follow state (screen coords).
  pointerX = 0;
  pointerY = 0;
  pointerActive = false;
  /** "mouse" | "touch" — which reticle/joystick visual to show. */
  lastPointerType = "mouse";

  // Floating joystick state (screen coords).
  joyActive = false;
  joyOriginX = 0;
  joyOriginY = 0;
  joyX = 0;
  joyY = 0;
  private joyPointerId = -1;

  constructor(target: HTMLElement, onFirstInteraction: () => void) {
    let interacted = false;
    const interact = () => {
      if (!interacted) {
        interacted = true;
        onFirstInteraction();
      }
    };

    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      interact();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.endJoy();
    });

    target.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") {
        if (e.pointerId === this.joyPointerId) {
          this.joyX = e.clientX;
          this.joyY = e.clientY;
        }
        return;
      }
      this.lastPointerType = "mouse";
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
      this.pointerActive = true;
    });
    target.addEventListener("pointerdown", (e) => {
      interact();
      if (e.pointerType === "touch") {
        this.lastPointerType = "touch";
        if (!this.joyActive) {
          this.joyActive = true;
          this.joyPointerId = e.pointerId;
          this.joyOriginX = e.clientX;
          this.joyOriginY = e.clientY;
          this.joyX = e.clientX;
          this.joyY = e.clientY;
        }
        return;
      }
      this.lastPointerType = "mouse";
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
      this.pointerActive = true;
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId === this.joyPointerId) this.endJoy();
    };
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  private endJoy(): void {
    this.joyActive = false;
    this.joyPointerId = -1;
  }

  /** Joystick steering vector (length 0..1), or null when the thumb is up. */
  joyDir(): { x: number; y: number } | null {
    if (!this.joyActive) return null;
    const dx = this.joyX - this.joyOriginX;
    const dy = this.joyY - this.joyOriginY;
    const len = Math.hypot(dx, dy);
    if (len < 8) return null; // tiny deadzone
    const mag = Math.min(1, len / 70);
    return { x: (dx / len) * mag, y: (dy / len) * mag };
  }

  /** WASD/arrow direction, or null if no movement keys are held. */
  keyDir(): { x: number; y: number } | null {
    let x = 0;
    let y = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) y -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) y += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    if (x === 0 && y === 0) return null;
    const len = Math.hypot(x, y);
    return { x: x / len, y: y / len };
  }
}
