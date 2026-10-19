'use strict';
/* 生成应用图标 build/icon.png（512x512，纯 Node 实现，无第三方依赖） */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const SS = 3;                 // 超采样倍数
const W = SIZE * SS;

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function lerp(a, b, t) { return a + (b - a) * t; }
function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }

const TOP = hex('#a78bfa');
const BOTTOM = hex('#4c1d95');
const BAR = [255, 255, 255];

function roundedRect(x, y, left, top, w, h, r) {
  if (x < left || x > left + w || y < top || y > top + h) return false;
  const dx = Math.min(Math.max(x, left + r), left + w - r);
  const dy = Math.min(Math.max(y, top + r), top + h - r);
  const dist = Math.hypot(x - dx, y - dy);
  return dist <= r;
}

const big = new Float64Array(W * W * 4);

// 背景圆角方块
const pad = Math.round(W * 0.055);
const radius = Math.round(W * 0.21);
for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (!roundedRect(x, y, pad, pad, W - pad * 2, W - pad * 2, radius)) continue;
    const t = (y - pad) / (W - pad * 2);
    big[i] = lerp(TOP[0], BOTTOM[0], t);
    big[i + 1] = lerp(TOP[1], BOTTOM[1], t);
    big[i + 2] = lerp(TOP[2], BOTTOM[2], t);
    big[i + 3] = 255;
  }
}

// 三条“剧本行”白条
const bars = [
  { x: pad + W * 0.115, y: W * 0.30, w: W * 0.50, h: W * 0.062, alpha: 0.95 },
  { x: pad + W * 0.115, y: W * 0.42, w: W * 0.60, h: W * 0.062, alpha: 0.80 },
  { x: pad + W * 0.115, y: W * 0.54, w: W * 0.38, h: W * 0.062, alpha: 0.62 }
];
bars.forEach((b) => {
  const r = b.h / 2;
  for (let y = Math.floor(b.y); y < b.y + b.h; y++) {
    for (let x = Math.floor(b.x); x < b.x + b.w; x++) {
      if (!roundedRect(x, y, b.x, b.y, b.w, b.h, r)) continue;
      const i = (y * W + x) * 4;
      const a = b.alpha;
      big[i] = lerp(big[i], BAR[0], a);
      big[i + 1] = lerp(big[i + 1], BAR[1], a);
      big[i + 2] = lerp(big[i + 2], BAR[2], a);
      big[i + 3] = 255;
    }
  }
});

// 右下角“AI 星芒”
const cx = W * 0.735;
const cy = W * 0.705;
const R = W * 0.105;
for (let y = Math.floor(cy - R); y <= cy + R; y++) {
  for (let x = Math.floor(cx - R); x <= cx + R; x++) {
    const dx = Math.abs(x - cx);
    const dy = Math.abs(y - cy);
    const d = Math.pow(dx, 0.62) + Math.pow(dy, 0.62);
    const lim = Math.pow(R, 0.62);
    if (d > lim) continue;
    const a = Math.min(1, (lim - d) / (lim * 0.35)) * 0.96;
    const i = (y * W + x) * 4;
    big[i] = lerp(big[i], 255, a);
    big[i + 1] = lerp(big[i + 1], 245, a);
    big[i + 2] = lerp(big[i + 2], 200, a);
    big[i + 3] = 255;
  }
}

// 下采样
const out = Buffer.alloc(SIZE * SIZE * 4);
const n = SS * SS;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
        r += big[i]; g += big[i + 1]; b += big[i + 2]; a += big[i + 3];
      }
    }
    const o = (y * SIZE + x) * 4;
    out[o] = Math.round(r / n);
    out[o + 1] = Math.round(g / n);
    out[o + 2] = Math.round(b / n);
    out[o + 3] = Math.round(a / n);
  }
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  out.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'icon.png');
fs.writeFileSync(outPath, png);
console.log('ICON_OK ' + outPath + ' ' + png.length + ' bytes');
