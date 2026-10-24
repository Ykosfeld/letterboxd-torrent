const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function crc32(buf) {
  let table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ (-1)) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function generatePng(size) {
  const width = size;
  const height = size;
  const scanlines = [];

  // Colors
  const bg = [0x14, 0x18, 0x1c, 0xff]; // Letterboxd dark #14181c
  const green = [0x00, 0xe0, 0x54, 0xff]; // Letterboxd green #00e054
  const orange = [0xff, 0x80, 0x00, 0xff]; // Letterboxd orange #ff8000
  const cyan = [0x40, 0xbc, 0xf4, 0xff]; // Letterboxd blue/cyan #40bcf4
  const white = [0xff, 0xff, 0xff, 0xff];

  const cx = width / 2;
  const cy = height / 2;
  const r = width * 0.46;

  for (let y = 0; y < height; y++) {
    const row = [0]; // Filter byte: 0 (None)
    for (let x = 0; x < width; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > r) {
        // Transparent outside rounded icon
        row.push(0, 0, 0, 0);
      } else if (dist > r - 1.5) {
        // Subtle antialiased border
        const alpha = Math.max(0, Math.min(255, Math.floor((r - dist) * 170)));
        row.push(0x2c, 0x34, 0x40, alpha);
      } else {
        // Inside dark circle
        // Let's draw 3 Letterboxd-style dots or a downward download arrow in green
        // Arrow geometry:
        // Stem: x in [cx - w/12, cx + w/12], y in [cy - h*0.25, cy + h*0.05]
        const stemW = Math.max(1, width * 0.1);
        const inStem = (Math.abs(x - cx) <= stemW) && (y >= cy - height * 0.22) && (y <= cy + height * 0.08);

        // Arrow head triangle:
        const headTopY = cy;
        const headBottomY = cy + height * 0.28;
        const inHead = (y >= headTopY) && (y <= headBottomY) && (Math.abs(x - cx) <= (headBottomY - y) * 1.0);

        // Base plate line:
        const plateY = cy + height * 0.32;
        const inPlate = (Math.abs(y - plateY) <= Math.max(1, height * 0.04)) && (Math.abs(x - cx) <= width * 0.26);

        // Letterboxd three dots at the top:
        // left dot (orange), middle dot (green), right dot (blue)
        const dotY = cy - height * 0.32;
        const dotR = Math.max(1.2, width * 0.06);
        const distL = Math.hypot(x - (cx - width * 0.18), y - dotY);
        const distM = Math.hypot(x - cx, y - dotY);
        const distR = Math.hypot(x - (cx + width * 0.18), y - dotY);

        if (distL <= dotR) {
          row.push(...orange);
        } else if (distM <= dotR) {
          row.push(...green);
        } else if (distR <= dotR) {
          row.push(...cyan);
        } else if (inStem || inHead || inPlate) {
          row.push(...green);
        } else {
          row.push(...bg);
        }
      }
    }
    scanlines.push(Buffer.from(row));
  }

  const rawData = Buffer.concat(scanlines);
  const compressed = zlib.deflateSync(rawData);

  // PNG Signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk: width(4), height(4), bitDepth(1)=8, colorType(1)=6 (RGBA), comp(1)=0, filter(1)=0, interlace(1)=0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

const outDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

[16, 48, 128].forEach(size => {
  const png = generatePng(size);
  const filePath = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Generated ${filePath} (${png.length} bytes)`);
});
