// Prototype for design §5.6 (bundle icons): this machine has no ImageMagick,
// no PIL and no sharp, so the Tauri bundle icons have to be emitted byte-wise.
// This proves a dependency-free PNG writer (zlib + CRC32) produces a file
// `file(1)` recognises, and that a Vista-style ICO with a PNG payload can be
// assembled the same way. Writes into the system temp dir, not the repo.
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** size x size RGBA PNG; pixel(x,y) -> [r,g,b,a]. */
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO containing PNG entries (Vista+ format). */
function ico(entries) {
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header[e] = size >= 256 ? 0 : size;
    header[e + 1] = size >= 256 ? 0 : size;
    header[e + 2] = 0; header[e + 3] = 0;
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.data)]);
}

// A CDU screen: dark bezel, green screen block.
const face = (x, y, size) => {
  const m = Math.round(size * 0.14);
  const inside = x >= m && y >= m && x < size - m && y < size * 0.62;
  return inside ? [0x28, 0xe0, 0x6e, 0xff] : [0x2e, 0x30, 0x33, 0xff];
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msfslogger-icon-'));
for (const size of [32, 128, 256, 512]) {
  fs.writeFileSync(path.join(dir, `${size}.png`), png(size, face));
}
fs.writeFileSync(path.join(dir, 'icon.ico'), ico([
  { size: 32, data: png(32, face) },
  { size: 128, data: png(128, face) },
  { size: 256, data: png(256, face) },
]));
console.log(dir);
