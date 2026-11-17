// Builds dist/SkyAI-Skyblock.mcaddon (behavior pack + resource pack in one
// file that Minecraft opens directly) and generates the pack images.
// No dependencies: includes a tiny PNG writer and ZIP writer.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------- PNG ----------
function png(width, height, pixels) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body) >>> 0, body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function canvas(width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  const rect = (x, y, w, h, hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        pixels.set([r, g, b, 255], (yy * width + xx) * 4);
      }
    }
  };
  return { rect, toPng: () => png(width, height, pixels) };
}

const CLAY = "#D97757";
const CLAY_DARK = "#B85F42";
const CREAM = "#F3EADB";
const INK = "#2B2A28";
const SLATE = "#4A4845";

function botSkin() {
  const c = canvas(64, 64);
  // Box-UV regions: a cube of size (w,h,d) at (u,v) covers (2d+2w) x (d+h).
  const box = (u, v, w, h, d, color) => c.rect(u, v, 2 * d + 2 * w, d + h, color);
  box(0, 0, 8, 8, 8, CREAM); // head
  box(16, 16, 8, 12, 4, CLAY); // body
  box(40, 16, 4, 12, 4, CLAY_DARK); // right arm
  box(32, 48, 4, 12, 4, CLAY_DARK); // left arm
  box(0, 16, 4, 12, 4, SLATE); // right leg
  box(16, 48, 4, 12, 4, SLATE); // left leg
  // Face (head front is at 8,8, 8x8): two eyes and a small smile.
  c.rect(9, 11, 2, 2, INK);
  c.rect(13, 11, 2, 2, INK);
  c.rect(10, 14, 4, 1, CLAY);
  c.rect(8, 8, 8, 1, CLAY); // hair band
  // Chest spark (body front is at 20,20, 8x12).
  c.rect(23, 23, 2, 6, CREAM);
  c.rect(21, 25, 6, 2, CREAM);
  // Hands
  c.rect(44, 30, 4, 2, CREAM);
  c.rect(36, 62, 4, 2, CREAM);
  return c.toPng();
}

function packIcon() {
  const c = canvas(128, 128);
  c.rect(0, 0, 128, 128, "#1E2A44"); // night sky
  c.rect(20, 18, 2, 2, CREAM);
  c.rect(96, 30, 2, 2, CREAM);
  c.rect(60, 12, 2, 2, CREAM);
  c.rect(28, 76, 72, 8, "#5DA343"); // grass
  c.rect(28, 84, 72, 14, "#8A5A3C"); // dirt
  c.rect(36, 98, 56, 8, "#6E452C");
  c.rect(40, 50, 6, 26, "#6B4A2B"); // trunk
  c.rect(28, 32, 30, 22, "#3F8A35"); // leaves
  c.rect(70, 52, 14, 10, CREAM); // bot head
  c.rect(73, 55, 2, 2, INK);
  c.rect(79, 55, 2, 2, INK);
  c.rect(70, 62, 14, 14, CLAY); // bot body
  return c.toPng();
}

// ---------- ZIP (deflate) ----------
function zip(entries) {
  const files = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name);
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    files.push(local, nameBuf, compressed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(compressed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, centralBuf, end]);
}

function collect(dir, prefix) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    const name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...collect(full, name));
    else out.push({ name, data: fs.readFileSync(full) });
  }
  return out;
}

// ---------- build ----------
const bp = path.join(root, "addon/behavior_pack");
const rp = path.join(root, "addon/resource_pack");
fs.mkdirSync(path.join(rp, "textures/entity"), { recursive: true });
fs.writeFileSync(path.join(rp, "textures/entity/skyai_bot.png"), botSkin());
const icon = packIcon();
fs.writeFileSync(path.join(bp, "pack_icon.png"), icon);
fs.writeFileSync(path.join(rp, "pack_icon.png"), icon);

// Every JSON file must parse - a broken one makes Minecraft ignore the pack.
for (const file of [...collect(bp, "bp"), ...collect(rp, "rp")]) {
  if (file.name.endsWith(".json")) JSON.parse(file.data.toString("utf8"));
}

const entries = [...collect(bp, "SkyAI_BP"), ...collect(rp, "SkyAI_RP")];
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const outFile = path.join(root, "dist/SkyAI-Skyblock.mcaddon");
fs.writeFileSync(outFile, zip(entries));
console.log(`Wrote ${path.relative(root, outFile)} (${entries.length} files, ${fs.statSync(outFile).size} bytes)`);
