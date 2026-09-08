// Generates the PWA icons (public/icons/*.png) with zero dependencies:
// a minimal PNG encoder + a rasterization of the favicon.svg dirt-blob mascot
// (green square, brown blob, white eyes, smile). Keep this in sync with
// public/favicon.svg or Home Screen icons will drift from the tab favicon.
// Run: node scripts/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

// ---- minimal PNG encoder (RGBA, 8-bit) ----

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // scanlines, each prefixed with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- drawing (mirrors public/favicon.svg, viewBox 0 0 64 64) ----

const hex = (c) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];

const GREEN = hex(0x9be86f);
const DIRT = hex(0x6f4e27);
const RIM = hex(0x4a3418);
const BLOTCH = hex(0x55391c);
const FLECK = hex(0x8a6a3f);
const DARK = hex(0x2f2418);
const WHITE = [255, 255, 255];

const EYES = [25.7, 38.9]; // cx pair; cy 25.4, rx 4.7, ry 5.7
const PUPILS = [
  [26.7, 26.3],
  [39.9, 26.3],
]; // r 2.4
const GLINTS = [
  [27.5, 25.4],
  [40.7, 25.4],
]; // r 0.8

// Smile path M28.2,35.5 c2.9,2.5 5.9,2.5 8.8,0 as a cubic.
const SMILE = [28.2, 35.5, 31.1, 38.0, 34.1, 38.0, 37.0, 35.5];
const SMILE_PTS = (() => {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = SMILE;
  const pts = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const mt = 1 - t;
    pts.push([
      mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
      mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
    ]);
  }
  return pts;
})();

function smileDist(gx, gy) {
  let m = Infinity;
  for (const [px, py] of SMILE_PTS) {
    const d = Math.hypot(gx - px, gy - py);
    if (d < m) m = d;
  }
  return m;
}

/**
 * Rasterize the mascot. `zoom` shrinks the artwork toward the center —
 * 1 for regular icons, 0.8 for the maskable safe zone. Background is a
 * full-bleed square (OSes apply their own masking; no transparency).
 */
function drawIcon(size, zoom) {
  const SS = 2; // supersample factor for smooth edges
  const W = size * SS;
  const S = ((W / 64) * zoom);
  const off = (W - 64 * S) / 2;
  const big = Buffer.alloc(W * W * 4);

  for (let y = 0; y < W; y++) {
    const gy = (y + 0.5 - off) / S;
    for (let x = 0; x < W; x++) {
      const gx = (x + 0.5 - off) / S;
      let r = GREEN[0];
      let g = GREEN[1];
      let b = GREEN[2];

      // soft ground shadow under the blob (black, ~10%)
      const ex = (gx - 33.3) / 23.9;
      const ey = (gy - 55.6) / 4.4;
      if (ex * ex + ey * ey < 1) {
        r = Math.round(r * 0.9);
        g = Math.round(g * 0.9);
        b = Math.round(b * 0.9);
      }

      // blob disc: r 23.9 + 1.5px centered stroke ring
      const d = Math.hypot(gx - 32, gy - 30.4);
      if (d <= 25.4) {
        if (d >= 22.4) {
          r = RIM[0];
          g = RIM[1];
          b = RIM[2];
        } else {
          r = DIRT[0];
          g = DIRT[1];
          b = DIRT[2];
          // translucent dirt blotches (SVG opacity .3)
          if (Math.hypot(gx - 23.2, gy - 39.2) < 5.7 || Math.hypot(gx - 42.1, gy - 35.5) < 4.4) {
            r = Math.round(r * 0.7 + BLOTCH[0] * 0.3);
            g = Math.round(g * 0.7 + BLOTCH[1] * 0.3);
            b = Math.round(b * 0.7 + BLOTCH[2] * 0.3);
          }
          // light flecks
          if (Math.hypot(gx - 38.3, gy - 45.5) < 2.5 || Math.hypot(gx - 19.4, gy - 27.9) < 1.9) {
            r = FLECK[0];
            g = FLECK[1];
            b = FLECK[2];
          }
          // eyes: white fill + 1.5px rim stroke
          let eyeFill = false;
          let eyeStroke = false;
          for (const cx of EYES) {
            const q = Math.sqrt(((gx - cx) / 4.7) ** 2 + ((gy - 25.4) / 5.7) ** 2);
            if (q < 1) eyeFill = true;
            if (Math.abs(q - 1) * 4.7 <= 0.75) eyeStroke = true;
          }
          if (eyeStroke) {
            r = RIM[0];
            g = RIM[1];
            b = RIM[2];
          } else if (eyeFill) {
            r = WHITE[0];
            g = WHITE[1];
            b = WHITE[2];
          }
          // pupils + glints
          for (const [px, py] of PUPILS) {
            if (Math.hypot(gx - px, gy - py) < 2.4) {
              r = DARK[0];
              g = DARK[1];
              b = DARK[2];
            }
          }
          for (const [px, py] of GLINTS) {
            if (Math.hypot(gx - px, gy - py) < 0.8) {
              r = WHITE[0];
              g = WHITE[1];
              b = WHITE[2];
            }
          }
          // smile: 3px stroke around the cubic
          if (gx > 26 && gx < 39.2 && gy > 33.8 && gy < 39.7 && smileDist(gx, gy) <= 1.5) {
            r = RIM[0];
            g = RIM[1];
            b = RIM[2];
          }
        }
      }

      const i = (y * W + x) * 4;
      big[i] = Math.round(r);
      big[i + 1] = Math.round(g);
      big[i + 2] = Math.round(b);
      big[i + 3] = 255;
    }
  }

  // box-downsample to the target size
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * W + (x * SS + dx)) * 4;
          r += big[i];
          g += big[i + 1];
          b += big[i + 2];
        }
      }
      const o = (y * size + x) * 4;
      const n = SS * SS;
      px[o] = Math.round(r / n);
      px[o + 1] = Math.round(g / n);
      px[o + 2] = Math.round(b / n);
      px[o + 3] = 255;
    }
  }
  return px;
}

mkdirSync(OUT, { recursive: true });
const targets = [
  ["icon-192.png", 192, 1],
  ["icon-512.png", 512, 1],
  ["icon-maskable-512.png", 512, 0.8], // padding keeps the face inside the mask safe zone
  ["apple-touch-icon.png", 180, 1],
];
for (const [name, size, zoom] of targets) {
  writeFileSync(join(OUT, name), encodePng(size, drawIcon(size, zoom)));
  console.log(`wrote public/icons/${name}`);
}
