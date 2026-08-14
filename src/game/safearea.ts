/** Reads CSS env(safe-area-inset-*) so canvas-drawn HUD elements can dodge the notch and home indicator. env() isn't reachable from JS, so a hidden element's padding is set to the insets and read back. */

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const ZERO: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

let probe: HTMLDivElement | null = null;
let cached: SafeAreaInsets = ZERO;

function createProbe(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.position = "fixed";
  el.style.left = "0";
  el.style.top = "0";
  el.style.visibility = "hidden";
  el.style.pointerEvents = "none";
  // Padding resolves env() into real px that getComputedStyle can read.
  el.style.paddingTop = "env(safe-area-inset-top, 0px)";
  el.style.paddingRight = "env(safe-area-inset-right, 0px)";
  el.style.paddingBottom = "env(safe-area-inset-bottom, 0px)";
  el.style.paddingLeft = "env(safe-area-inset-left, 0px)";
  document.body.appendChild(el);
  return el;
}

function measure(): SafeAreaInsets {
  if (typeof document === "undefined") return ZERO;
  if (!probe) probe = createProbe();
  const cs = getComputedStyle(probe);
  return {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}

function recompute(): void {
  cached = measure();
}

if (typeof window !== "undefined") {
  // Insets swap on rotation, but getComputedStyle forces a layout flush, so recompute here rather than per frame.
  window.addEventListener("resize", recompute);
  window.addEventListener("orientationchange", recompute);
  recompute();
}

/** Cached safe-area insets in px; all zeros on desktop / unsupported browsers. */
export function safeArea(): SafeAreaInsets {
  return cached;
}
