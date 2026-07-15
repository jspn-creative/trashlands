// Generates the PWA icons (public/icons/*.png) with zero dependencies:
// a minimal PNG encoder + a parametric drawing of the dirt blob.
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

// ---- drawing ----

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (c) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];

/** Draw the icon: green ground, brown dirt blob with blotches + highlight. */
function drawIcon(size, blobScale) {
  const px = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const R = size * blobScale;
  const rng = mulberry32(1337);

  const bgTop = hex(0x9be86f);
  const bgBot = hex(0x55803c);
  const dirt = hex(0x6f4e27);
  const rim = hex(0x4a3418);
  const blotch = hex(0x55391c);
  const fleck = hex(0x8a6a3f);

  const blotches = [];
  for (let i = 0; i < 8; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = (0.12 + rng() * 0.5) * R;
    blotches.push({
      x: c + Math.cos(ang) * dist,
      y: c + Math.sin(ang) * dist,
      r: (0.12 + rng() * 0.16) * R,
      col: blotch,
    });
  }
  for (let i = 0; i < 6; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = (0.2 + rng() * 0.55) * R;
    blotches.push({
      x: c + Math.cos(ang) * dist,
      y: c + Math.sin(ang) * dist,
      r: (0.04 + rng() * 0.05) * R,
      col: fleck,
    });
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // vertical green gradient background (full bleed for maskable)
      const t = y / size;
      let r = bgTop[0] + (bgBot[0] - bgTop[0]) * t;
      let g = bgTop[1] + (bgBot[1] - bgTop[1]) * t;
      let b = bgTop[2] + (bgBot[2] - bgTop[2]) * t;

      const d = Math.hypot(x - c, y - c);
      if (d < R) {
        if (d > R * 0.92) {
          [r, g, b] = rim;
        } else {
          [r, g, b] = dirt;
          for (const bl of blotches) {
            if (Math.hypot(x - bl.x, y - bl.y) < bl.r) [r, g, b] = bl.col;
          }
          // soft top-left highlight
          const hd = Math.hypot(x - (c - R * 0.28), y - (c - R * 0.32));
          if (hd < R * 0.34) {
            r += (255 - r) * 0.1;
            g += (255 - g) * 0.1;
            b += (255 - b) * 0.1;
          }
        }
      }

      px[i] = Math.round(r);
      px[i + 1] = Math.round(g);
      px[i + 2] = Math.round(b);
      px[i + 3] = 255;
    }
  }
  return px;
}

mkdirSync(OUT, { recursive: true });
const targets = [
  ["icon-192.png", 192, 0.4],
  ["icon-512.png", 512, 0.4],
  ["icon-maskable-512.png", 512, 0.32], // safe-zone padding for maskable
  ["apple-touch-icon.png", 180, 0.4],
];
for (const [name, size, scale] of targets) {
  writeFileSync(join(OUT, name), encodePng(size, drawIcon(size, scale)));
  console.log(`wrote public/icons/${name}`);
}
