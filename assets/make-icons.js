const zlib = require("zlib"), fs = require("fs");

// minimal PNG writer: signature, IHDR, IDAT, IEND
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xFFFFFFFF;
  for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) { const [r, g, b] = pixel(x, y); raw[o++] = r; raw[o++] = g; raw[o++] = b; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// a chunky checkmark, drawn as two thick strokes on a 16-unit grid
const ACCENT = [0xC4, 0x24, 0x30], INK = [0xF7, 0xF8, 0xF9];
// The mark is drawn on a 16-unit grid. Two constraints fight each other: it must sit
// inside the maskable safe zone (a 40%-radius circle) so launchers never crop it, and
// the diagonal must terminate on a full 2-cell tip rather than a 1-cell nub. Search
// stroke width and scale together for the largest mark that satisfies both.
const BASE = [[3.2, 8.4, 6.4, 11.4], [6.4, 11.4, 12.8, 4.6]];
function distSeg(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  let t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function cells(segs, half) {
  const on = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
    if (segs.some(s => distSeg(x + 0.5, y + 0.5, s) < half)) on.push([x, y]);
  return on;
}
const reach = on => Math.max(...on.flatMap(([x, y]) =>
  [[0,0],[1,0],[0,1],[1,1]].map(([ox, oy]) => Math.hypot(x + ox - 8, y + oy - 8)))) / 16;
function cleanTip(on) {
  const top = Math.min(...on.map(c => c[1]));
  return on.filter(c => c[1] === top).length >= 2;   // a 2-cell terminus, not a nub
}
// Prefer the longest mark, not the fattest: maximising cell count just yields a blob.
let best = null;
for (let half = 1.20; half <= 1.70; half += 0.05) {
  for (let k = 0.95; k >= 0.50; k -= 0.01) {
    const segs = BASE.map(s => s.map(v => 8 + (v - 8) * k));
    const on = cells(segs, half * k);
    if (reach(on) > 0.4 || !cleanTip(on)) continue;
    if (!best || k > best.k) best = { segs, half: half * k, on, k, hw: half };
    break;
  }
}
if (!best) throw new Error("no icon geometry satisfies both constraints");
const segs = best.segs, half = best.half;
console.log("scale " + best.k.toFixed(2) + ", stroke " + best.hw.toFixed(2) +
            " -> " + best.on.length + " cells, reach " + (reach(best.on) * 100).toFixed(1) +
            "% (limit 40%), clean tip: " + cleanTip(best.on));

function draw(size) {
  const cell = size / 16;
  return (x, y) => {
    // sample at cell centre so the mark stays crisp and pixel-aligned
    const gx = Math.floor(x / cell) + 0.5, gy = Math.floor(y / cell) + 0.5;
    return segs.some(s => distSeg(gx, gy, s) < half) ? INK : ACCENT;
  };
}
for (const size of [192, 512]) {
  const buf = png(size, draw(size));
  fs.writeFileSync("C:/Users/thori/Documents/games-list/assets/icon-" + size + ".png", buf);
  console.log("icon-" + size + ".png  " + buf.length + " bytes");
}
