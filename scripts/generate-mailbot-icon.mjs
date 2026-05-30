import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const outDir = path.resolve("assets");
const outPath = path.join(outDir, "mailbot.icns");

function buildIcns() {
  const entries = [
    ["ic10", 1024],
    ["ic09", 512],
    ["ic08", 256],
    ["ic07", 128],
    ["icp6", 64],
    ["icp5", 32],
    ["icp4", 16]
  ].map(([type, size]) => {
    const png = createPng(Number(size));
    const header = Buffer.alloc(8);
    header.write(String(type), 0, 4, "ascii");
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });

  const totalLength = entries.reduce((sum, entry) => sum + entry.length, 8);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(totalLength, 4);
  return Buffer.concat([header, ...entries]);
}

function createPng(size) {
  const bytesPerPixel = 4;
  const rowLength = size * bytesPerPixel + 1;
  const raw = Buffer.alloc(rowLength * size);

  for (let y = 0; y < size; y += 1) {
    raw[y * rowLength] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = y * rowLength + 1 + x * bytesPerPixel;
      const pixel = drawPixel(x / (size - 1), y / (size - 1));
      raw[offset] = pixel[0];
      raw[offset + 1] = pixel[1];
      raw[offset + 2] = pixel[2];
      raw[offset + 3] = pixel[3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function drawPixel(x, y) {
  const margin = 0.05;
  const radius = 0.18;
  const inside = roundedRect(x, y, margin, margin, 1 - margin, 1 - margin, radius);
  if (!inside) return [0, 0, 0, 0];

  const bg = [0, 116, 96, 255];
  const border = edgeDistance(x, y, margin, 1 - margin) < 0.035;
  const m =
    segmentDistance(x, y, 0.28, 0.74, 0.28, 0.27) < 0.047 ||
    segmentDistance(x, y, 0.28, 0.27, 0.5, 0.57) < 0.05 ||
    segmentDistance(x, y, 0.5, 0.57, 0.72, 0.27) < 0.05 ||
    segmentDistance(x, y, 0.72, 0.27, 0.72, 0.74) < 0.047;

  if (m) return [255, 255, 255, 255];
  if (border) return [61, 255, 217, 255];
  return bg;
}

function roundedRect(x, y, left, top, right, bottom, radius) {
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function edgeDistance(x, y, min, max) {
  return Math.min(x - min, y - min, max - x, max - y);
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, buildIcns(), "binary");
console.log(outPath);
