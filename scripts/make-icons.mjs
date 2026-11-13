// 生成 icons/icon{16,48,128}.png —— 仅用 node:zlib，无第三方依赖。
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const stride = size * 4 + 1; // 每行行首 filter 字节 0
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 像素绘制 ---------- */
function drawIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const set = (x, y, [r, g, b, a = 255]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const s = size / 128; // 以 128 为基准等比缩放
  const bg = [79, 70, 229];    // 靛蓝 #4F46E5
  const fg = [255, 255, 255];  // 白色花括号
  const dot = [251, 191, 36];  // 琥珀 #FBBF24

  // 圆角方形背景（简易抗锯齿）
  const r = 26 * s;
  const m = 8 * s;
  const edge = 1.5 * s;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.min(x - m, size - 1 - m - x);
      const dy = Math.min(y - m, size - 1 - m - y);
      if (dx < 0 || dy < 0) continue;
      const d = Math.hypot(Math.max(0, r - dx), Math.max(0, r - dy));
      let alpha = 0;
      if (d <= r - edge) alpha = 255;
      else if (d <= r + edge) alpha = 140;
      if (alpha > 0) set(x, y, [bg[0], bg[1], bg[2], alpha]);
    }
  }

  const t = Math.max(2, Math.round(9 * s)); // 笔画粗细
  const stem = (xBase) => {
    for (let i = 0; i < t; i++) {
      for (let j = 0; j < 64 * s + t; j++) set(xBase + i, 32 * s + j, fg);
    }
  };
  // 左花括号 {
  stem(36 * s);
  for (let i = 0; i < t; i++) {
    for (let j = 0; j < 24 * s; j++) {
      set(36 * s + j, 32 * s + i, fg);        // 上臂（向右）
      set(36 * s + j, 96 * s - t + i, fg);    // 下臂（向右）
    }
  }
  // 右花括号 }
  stem(92 * s - t);
  for (let i = 0; i < t; i++) {
    for (let j = 0; j < 24 * s; j++) {
      set(68 * s + j, 32 * s + i, fg);        // 上臂（向左）
      set(68 * s + j, 96 * s - t + i, fg);    // 下臂（向左）
    }
  }
  // 中心圆点
  const cx = 64 * s, cy = 64 * s, cr = 7 * s;
  for (let y = Math.floor(cy - cr); y <= Math.ceil(cy + cr); y++) {
    for (let x = Math.floor(cx - cr); x <= Math.ceil(cx + cr); x++) {
      if (Math.hypot(x - cx, y - cy) <= cr) set(x, y, dot);
    }
  }
  return px;
}

/* ---------- 输出 ---------- */
mkdirSync(join(root, 'icons'), { recursive: true });
for (const size of [16, 48, 128]) {
  const png = encodePng(size, drawIcon(size));
  const file = join(root, 'icons', `icon${size}.png`);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}
