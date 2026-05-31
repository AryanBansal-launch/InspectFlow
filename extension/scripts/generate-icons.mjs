// Generates the extension's PNG icons at build time using only Node built-ins.
// Produces a simple "inspect frame" mark: an indigo rounded square with a
// white corner-bracket frame, evoking the DevTools element-inspect cursor.
import zlib from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "icons");
const SIZES = [16, 32, 48, 128];

const BG = [99, 102, 241, 255]; // indigo-500
const FG = [255, 255, 255, 255]; // white frame
const TRANSPARENT = [0, 0, 0, 0];

/** Builds a PNG chunk with its CRC. */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** Encodes an RGBA pixel buffer into a PNG (8-bit, color type 6). */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (none)
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Renders the icon for a given size into an RGBA buffer. */
function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b, a]) => {
    const i = (y * size + x) * 4;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = a;
  };

  const radius = Math.max(2, Math.round(size * 0.18));
  const margin = Math.round(size * 0.14); // frame inset
  const thickness = Math.max(1, Math.round(size * 0.09));
  const armLen = Math.round(size * 0.22); // corner bracket arm length

  const inRoundedSquare = (x, y) => {
    const min = 0;
    const max = size - 1;
    const dxLeft = radius - x;
    const dxRight = x - (max - radius);
    const dyTop = radius - y;
    const dyBottom = y - (max - radius);
    const cx = dxLeft > 0 ? radius : dxRight > 0 ? max - radius : x;
    const cy = dyTop > 0 ? radius : dyBottom > 0 ? max - radius : y;
    const corner =
      (dxLeft > 0 || dxRight > 0) && (dyTop > 0 || dyBottom > 0);
    if (!corner) return x >= min && x <= max && y >= min && y <= max;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };

  const onCornerBracket = (x, y) => {
    const lo = margin;
    const hi = size - 1 - margin;
    const nearLeft = x >= lo && x < lo + thickness;
    const nearRight = x <= hi && x > hi - thickness;
    const nearTop = y >= lo && y < lo + thickness;
    const nearBottom = y <= hi && y > hi - thickness;
    const withinTopArmsY = y >= lo && y <= lo + armLen;
    const withinBottomArmsY = y <= hi && y >= hi - armLen;
    const withinLeftArmsX = x >= lo && x <= lo + armLen;
    const withinRightArmsX = x <= hi && x >= hi - armLen;

    // Top-left corner
    if ((nearTop && withinLeftArmsX) || (nearLeft && withinTopArmsY)) return true;
    // Top-right corner
    if ((nearTop && withinRightArmsX) || (nearRight && withinTopArmsY)) return true;
    // Bottom-left corner
    if ((nearBottom && withinLeftArmsX) || (nearLeft && withinBottomArmsY)) return true;
    // Bottom-right corner
    if ((nearBottom && withinRightArmsX) || (nearRight && withinBottomArmsY)) return true;
    return false;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRoundedSquare(x, y)) {
        set(x, y, TRANSPARENT);
      } else if (onCornerBracket(x, y)) {
        set(x, y, FG);
      } else {
        set(x, y, BG);
      }
    }
  }
  return buf;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = encodePng(size, size, renderIcon(size));
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, png);
  // eslint-disable-next-line no-console
  console.log(`wrote ${file} (${png.length} bytes)`);
}
