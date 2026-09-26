// Generate a placeholder profile avatar as a PNG buffer — used by seedLocal to
// give every seeded athlete a distinct, "random"-looking picture so the demo comp
// shows a full board of profile cards
// (Competitor / brackets `profile` / VS / SVO overlays) offline, no assets needed.
//
// The look is a GitHub-style identicon: a horizontally-mirrored 5×5 block pattern
// in a saturated hue over a matching tint. Everything is derived from a seed
// string (the athlete name), so the same athlete always gets the same avatar —
// idempotent, matching the content-hashed photo keys the upload path produces.
// Pure Node built-ins (zlib for the IDAT deflate); no image library.

import { deflateSync } from 'node:zlib';

// FNV-1a → 32-bit; small, stable, good enough to spread names across the palette.
const hash32 = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

// mulberry32 PRNG — a deterministic per-seed stream for the block pattern.
const mulberry32 = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const hslToRgb = (h, s, l) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(h / 60) % 6];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
};

// CRC-32 (IEEE) for PNG chunks. Table built once at module load.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), out.length - 4);
  return out;
};

/**
 * Return a PNG Buffer for a placeholder avatar derived from `seed`.
 * @param {string} seed — stable input (an athlete name); same seed → same image.
 * @param {number} [size=420] — square edge in px.
 */
export const generateAvatarPng = (seed, size = 420) => {
  const h = hash32(seed);
  const rand = mulberry32(h);

  const hue = h % 360;
  const fg = hslToRgb(hue, 0.62, 0.5);
  const bg = hslToRgb(hue, 0.28, 0.92);

  // 5×5 blocks, left three columns random then mirrored → symmetric identicon.
  const GRID = 5;
  const margin = Math.round(size * 0.12);
  const cell = Math.floor((size - 2 * margin) / GRID);
  const filled = [];
  for (let r = 0; r < GRID; r++) {
    const row = [];
    for (let c = 0; c < Math.ceil(GRID / 2); c++) row[c] = rand() > 0.5;
    for (let c = 0; c < GRID; c++) filled.push(row[Math.min(c, GRID - 1 - c)]);
  }

  // Raw RGB scanlines, each prefixed with filter byte 0.
  const rowBytes = size * 3;
  const raw = Buffer.alloc((rowBytes + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0; // filter: none
    const gr = Math.floor((y - margin) / cell);
    for (let x = 0; x < size; x++) {
      const gc = Math.floor((x - margin) / cell);
      const inGrid = gr >= 0 && gr < GRID && gc >= 0 && gc < GRID;
      const [rr, gg, bb] = inGrid && filled[gr * GRID + gc] ? fg : bg;
      const p = rowStart + 1 + x * 3;
      raw[p] = rr;
      raw[p + 1] = gg;
      raw[p + 2] = bb;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  // 10..12 = compression / filter / interlace = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};
