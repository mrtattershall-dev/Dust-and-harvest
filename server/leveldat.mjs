// Reads and edits a Bedrock world's level.dat (little-endian NBT with an
// 8-byte header). Used by setup to switch on what the AI teammate needs:
// the Beta APIs experiment, cheats, and an empty (void) flat world.
import fs from "node:fs";

const T = { END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6, BYTES: 7, STRING: 8, LIST: 9, COMPOUND: 10, INTS: 11, LONGS: 12 };

function reader(buf) {
  let o = 0;
  const str = () => {
    const n = buf.readUInt16LE(o);
    o += 2;
    const s = buf.toString("utf8", o, o + n);
    o += n;
    return s;
  };
  const payload = (type) => {
    switch (type) {
      case T.BYTE: return buf.readInt8(o++);
      case T.SHORT: { const v = buf.readInt16LE(o); o += 2; return v; }
      case T.INT: { const v = buf.readInt32LE(o); o += 4; return v; }
      case T.LONG: { const v = buf.readBigInt64LE(o); o += 8; return v; }
      case T.FLOAT: { const v = buf.readFloatLE(o); o += 4; return v; }
      case T.DOUBLE: { const v = buf.readDoubleLE(o); o += 8; return v; }
      case T.BYTES: { const n = buf.readInt32LE(o); o += 4; const v = Buffer.from(buf.subarray(o, o + n)); o += n; return v; }
      case T.STRING: return str();
      case T.LIST: {
        const of = buf.readUInt8(o++);
        const n = buf.readInt32LE(o);
        o += 4;
        const items = [];
        for (let i = 0; i < n; i++) items.push(payload(of));
        return { of, items };
      }
      case T.COMPOUND: {
        const out = {};
        for (;;) {
          const t = buf.readUInt8(o++);
          if (t === T.END) return out;
          const name = str();
          out[name] = { type: t, value: payload(t) };
        }
      }
      case T.INTS: { const n = buf.readInt32LE(o); o += 4; const v = []; for (let i = 0; i < n; i++) { v.push(buf.readInt32LE(o)); o += 4; } return v; }
      case T.LONGS: { const n = buf.readInt32LE(o); o += 4; const v = []; for (let i = 0; i < n; i++) { v.push(buf.readBigInt64LE(o)); o += 8; } return v; }
      default: throw new Error(`Unknown NBT tag ${type} at ${o}`);
    }
  };
  return { payload, str, skip: (n) => (o += n), u8: () => buf.readUInt8(o++) };
}

function write(type, value, out) {
  const num = (size, fn) => { const b = Buffer.alloc(size); fn(b); out.push(b); };
  const str = (s) => { const b = Buffer.from(s, "utf8"); num(2, (x) => x.writeUInt16LE(b.length)); out.push(b); };
  switch (type) {
    case T.BYTE: return num(1, (b) => b.writeInt8(value));
    case T.SHORT: return num(2, (b) => b.writeInt16LE(value));
    case T.INT: return num(4, (b) => b.writeInt32LE(value));
    case T.LONG: return num(8, (b) => b.writeBigInt64LE(BigInt(value)));
    case T.FLOAT: return num(4, (b) => b.writeFloatLE(value));
    case T.DOUBLE: return num(8, (b) => b.writeDoubleLE(value));
    case T.BYTES: num(4, (b) => b.writeInt32LE(value.length)); return void out.push(value);
    case T.STRING: return str(value);
    case T.LIST:
      num(1, (b) => b.writeUInt8(value.of));
      num(4, (b) => b.writeInt32LE(value.items.length));
      for (const item of value.items) write(value.of, item, out);
      return;
    case T.COMPOUND:
      for (const [name, tag] of Object.entries(value)) {
        num(1, (b) => b.writeUInt8(tag.type));
        str(name);
        write(tag.type, tag.value, out);
      }
      return num(1, (b) => b.writeUInt8(0));
    case T.INTS: num(4, (b) => b.writeInt32LE(value.length)); for (const v of value) num(4, (b) => b.writeInt32LE(v)); return;
    case T.LONGS: num(4, (b) => b.writeInt32LE(value.length)); for (const v of value) num(8, (b) => b.writeBigInt64LE(BigInt(v))); return;
    default: throw new Error(`Unknown NBT tag ${type}`);
  }
}

export function readLevelDat(file) {
  const buf = fs.readFileSync(file);
  const version = buf.readInt32LE(0);
  const r = reader(buf.subarray(8));
  if (r.u8() !== T.COMPOUND) throw new Error("level.dat does not start with a compound tag");
  const rootName = r.str();
  return { version, rootName, root: r.payload(T.COMPOUND) };
}

export function writeLevelDat(file, { version, rootName, root }) {
  const out = [Buffer.from([T.COMPOUND])];
  const name = Buffer.from(rootName, "utf8");
  const len = Buffer.alloc(2);
  len.writeUInt16LE(name.length);
  out.push(len, name);
  write(T.COMPOUND, root, out);
  const body = Buffer.concat(out);
  const header = Buffer.alloc(8);
  header.writeInt32LE(version, 0);
  header.writeInt32LE(body.length, 4);
  fs.writeFileSync(file, Buffer.concat([header, body]));
}

const byte = (v) => ({ type: T.BYTE, value: v ? 1 : 0 });

/** Apply the settings the AI teammate needs. */
export function configureWorld(file, { voidWorld = true } = {}) {
  const dat = readLevelDat(file);
  const root = dat.root;
  // Beta APIs experiment (needed for the simulated player and for HTTP from scripts).
  const experiments = root.experiments?.value ?? {};
  experiments.gametest = byte(1);
  experiments.experiments_ever_used = byte(1);
  experiments.saved_with_toggled_experiments = byte(1);
  root.experiments = { type: T.COMPOUND, value: experiments };
  root.cheatsEnabled = byte(1);
  root.commandsEnabled = byte(1);
  if (voidWorld) {
    root.Generator = { type: T.INT, value: 2 }; // flat
    root.FlatWorldLayers = {
      type: T.STRING,
      value: JSON.stringify({ biome_id: 1, block_layers: [{ block_name: "minecraft:air", count: 1 }], encoding_version: 6, structure_options: null, world_version: "version.post_1_18" }),
    };
    root.spawnMobs = root.spawnMobs ?? byte(1);
  }
  writeLevelDat(file, dat);
}

function plain(tag) {
  if (tag.type === T.COMPOUND) return Object.fromEntries(Object.entries(tag.value).map(([k, v]) => [k, plain(v)]));
  if (tag.type === T.LIST) return tag.value.items.map((v) => plain({ type: tag.value.of, value: v }));
  if (typeof tag.value === "bigint") return tag.value.toString();
  if (Buffer.isBuffer(tag.value)) return `<${tag.value.length} bytes>`;
  return tag.value;
}

if (process.argv[1] && process.argv[1].endsWith("leveldat.mjs")) {
  const [, , command, file] = process.argv;
  if (command === "show") console.log(JSON.stringify(plain({ type: T.COMPOUND, value: readLevelDat(file).root }), null, 1));
  else if (command === "configure") { configureWorld(file); console.log("configured", file); }
  else if (command === "roundtrip") { const before = fs.readFileSync(file); const d = readLevelDat(file); writeLevelDat(file + ".tmp", d); console.log(before.equals(fs.readFileSync(file + ".tmp")) ? "roundtrip identical" : "ROUNDTRIP DIFFERS"); fs.rmSync(file + ".tmp"); }
  else console.log("usage: node leveldat.mjs show|configure|roundtrip <level.dat>");
}
