// A small stand-in for the parts of "@minecraft/server" the add-on uses, so
// the add-on's logic can be run and tested outside the game. One game tick is
// one millisecond here. Liquids do not flow, except for a crude cobblestone
// generator rule (see setType).
const TICK_MS = 1;
const key = (p) => `${p.x},${p.y},${p.z}`;
const NOT_BLOCKS = /^(stick|.*_pickaxe|.*_axe|.*_shovel|.*_hoe|.*_sword|bucket|coal|charcoal|apple|wheat_seeds|bone_meal)$/;

function signal() {
  const subs = [];
  return { subscribe: (cb) => (subs.push(cb), cb), fire: (event) => subs.forEach((cb) => cb(event)) };
}

export class ItemStack {
  constructor(typeId, amount = 1) {
    if (!/^[a-z0-9_]+:[a-z0-9_]+$/.test(typeId) || typeId === "minecraft:planks") throw new Error(`Invalid item ${typeId}`);
    this.typeId = typeId;
    this.amount = amount;
    this.nameTag = undefined;
    this.keepOnDeath = false;
    const s = typeId.replace("minecraft:", "");
    const tool = /_(pickaxe|axe|shovel|hoe|sword)$/.test(s) || s === "shears";
    this.maxAmount = tool || /bucket$/.test(s) ? 1 : 64;
    this._durability = tool ? { damage: 0, maxDurability: s.startsWith("wooden") ? 59 : 131 } : undefined;
  }
  getComponent(name) {
    return name === "minecraft:durability" ? this._durability : undefined;
  }
  clone() {
    const c = new ItemStack(this.typeId, this.amount);
    c.nameTag = this.nameTag;
    if (this._durability) c._durability = { ...this._durability };
    return c;
  }
}

class Container {
  constructor(size) {
    this.size = size;
    this.slots = new Array(size).fill(undefined);
    this.isValid = true;
  }
  get emptySlotsCount() {
    return this.slots.filter((s) => !s).length;
  }
  getItem(i) {
    return this.slots[i]?.clone();
  }
  setItem(i, stack) {
    this.slots[i] = stack ? stack.clone() : undefined;
  }
  addItem(stack) {
    let left = stack.amount;
    for (const s of this.slots) {
      if (left > 0 && s && s.typeId === stack.typeId && s.amount < s.maxAmount) {
        const n = Math.min(left, s.maxAmount - s.amount);
        s.amount += n;
        left -= n;
      }
    }
    for (let i = 0; i < this.size && left > 0; i++) {
      if (!this.slots[i]) {
        const c = stack.clone();
        c.amount = Math.min(left, c.maxAmount);
        this.slots[i] = c;
        left -= c.amount;
      }
    }
    if (left === 0) return undefined;
    const rest = stack.clone();
    rest.amount = left;
    return rest;
  }
}

export class BlockPermutation {
  constructor(typeId, states = {}) {
    this.type = { id: typeId };
    this.states = states;
  }
  static resolve(typeId, states = {}) {
    const s = typeId.replace("minecraft:", "");
    if (NOT_BLOCKS.test(s)) throw new Error(`Invalid block ${typeId}`);
    return new BlockPermutation(typeId, { ...defaultStates(s), ...states });
  }
  getState(name) {
    return this.states[name];
  }
  withState(name, value) {
    return new BlockPermutation(this.type.id, { ...this.states, [name]: value });
  }
}

function defaultStates(s) {
  if (s === "water" || s === "lava") return { liquid_depth: 0 };
  if (s === "wheat") return { growth: 0 };
  return {};
}

class Block {
  constructor(dimension, pos) {
    this.dimension = dimension;
    this.x = pos.x;
    this.y = pos.y;
    this.z = pos.z;
  }
  get _data() {
    return this.dimension.blocks.get(key(this));
  }
  get typeId() {
    return this._data?.typeId ?? "minecraft:air";
  }
  get isAir() {
    return this.typeId === "minecraft:air";
  }
  get isLiquid() {
    return /water|lava/.test(this.typeId);
  }
  get permutation() {
    return new BlockPermutation(this.typeId, this._data?.states ?? {});
  }
  setType(typeId) {
    this.setPermutation(BlockPermutation.resolve(typeId));
  }
  setPermutation(perm) {
    const id = perm.type.id;
    const k = key(this);
    if (id === "minecraft:air") {
      this.dimension.blocks.delete(k);
      this.dimension._regrow(this);
      return;
    }
    const data = { typeId: id, states: { ...perm.states } };
    if (/chest|barrel/.test(id)) data.container = new Container(27);
    this.dimension.blocks.set(k, data);
    this.dimension._lavaCheck(this);
  }
  getComponent(name) {
    return name === "minecraft:inventory" && this._data?.container ? { container: this._data.container } : undefined;
  }
  getItemStack(amount = 1) {
    return new ItemStack(this.typeId, amount);
  }
}

let nextEntityId = 1;
class Entity {
  constructor(dimension, typeId, location) {
    this.id = String(-1000 - nextEntityId++);
    this.dimension = dimension;
    this.typeId = typeId;
    this.location = { ...location };
    this.nameTag = "";
    this.isValid = true;
    this._tags = new Set();
    this._inventory = typeId === "skyai:bot" || typeId === "minecraft:player" ? new Container(36) : undefined;
    this._itemStack = undefined;
    this._health = 20;
    dimension.entities.add(this);
  }
  teleport(location) {
    this.location = { x: location.x, y: location.y, z: location.z };
  }
  getComponent(name) {
    if (name === "minecraft:inventory") return this._inventory ? { container: this._inventory } : undefined;
    if (name === "minecraft:health") return { currentValue: this._health, effectiveMax: 20 };
    if (name === "minecraft:item") return this._itemStack ? { itemStack: this._itemStack } : undefined;
    return undefined;
  }
  addTag(tag) {
    this._tags.add(tag);
    return true;
  }
  removeTag(tag) {
    return this._tags.delete(tag);
  }
  getTags() {
    return [...this._tags];
  }
  remove() {
    this.isValid = false;
    this.dimension.entities.delete(this);
  }
  kill() {
    this.remove();
    world.afterEvents.entityDie.fire({ deadEntity: this, damageSource: { cause: "void" } });
  }
  applyDamage(amount) {
    this._health -= amount;
    if (this._health <= 0) this.kill();
    return true;
  }
  sendMessage(text) {
    world.messages.push(String(text));
  }
  setSpawnPoint() {}
}

class Dimension {
  constructor() {
    this.id = "minecraft:overworld";
    this.blocks = new Map();
    this.entities = new Set();
  }
  getBlock(pos) {
    if (pos.y < -64 || pos.y > 319) return undefined;
    return new Block(this, { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
  }
  setBlockType(pos, typeId) {
    this.getBlock(pos).setType(typeId);
  }
  runCommand() {
    return { successCount: 1 };
  }
  spawnEntity(typeId, location) {
    return new Entity(this, typeId, location);
  }
  spawnItem(stack, location) {
    const e = new Entity(this, "minecraft:item", location);
    e._itemStack = stack.clone();
    return e;
  }
  getEntities(options = {}) {
    return [...this.entities].filter((e) => {
      if (options.type && e.typeId !== options.type) return false;
      if (options.location && options.maxDistance !== undefined) {
        const d = Math.hypot(e.location.x - options.location.x, e.location.y - options.location.y, e.location.z - options.location.z);
        if (d > options.maxDistance) return false;
      }
      return true;
    });
  }
  // Crude cobblestone generator: an empty cell with lava on one side (x) and
  // water on the other becomes cobblestone.
  _between(block) {
    const at = (dx) => this.blocks.get(key({ x: block.x + dx, y: block.y, z: block.z }))?.typeId ?? "";
    const water = (d) => at(d).includes("water") || (at(d) === "" && at(2 * d).includes("water"));
    return (at(1).includes("lava") && water(-1)) || (at(-1).includes("lava") && water(1));
  }
  _lavaCheck(block) {
    for (const dx of [-1, 1]) {
      const cell = this.getBlock({ x: block.x + dx, y: block.y, z: block.z });
      if (cell.isAir && this._between(cell)) this.blocks.set(key(cell), { typeId: "minecraft:cobblestone", states: {} });
    }
  }
  _regrow(block) {
    if (!this._between(block)) return;
    setTimeout(() => {
      if (block.isAir) this.blocks.set(key(block), { typeId: "minecraft:cobblestone", states: {} });
    }, 20 * TICK_MS);
  }
}

const dimension = new Dimension();
const properties = new Map();

export const world = {
  messages: [],
  afterEvents: { worldLoad: signal(), entityDie: signal(), playerSpawn: signal(), itemUse: signal() },
  getDimension: () => dimension,
  getAllPlayers: () => dimension.getEntities({ type: "minecraft:player" }),
  getPlayers: () => dimension.getEntities({ type: "minecraft:player" }),
  getEntity: (id) => [...dimension.entities].find((e) => e.id === id),
  sendMessage: (text) => world.messages.push(String(text)),
  getDynamicProperty: (name) => properties.get(name),
  setDynamicProperty: (name, value) => (value === undefined ? properties.delete(name) : properties.set(name, value)),
  getTimeOfDay: () => 1000,
};

const timers = new Set();
export const system = {
  afterEvents: { scriptEventReceive: signal() },
  runTimeout: (cb, ticks = 1) => setTimeout(cb, Math.max(1, ticks) * TICK_MS),
  runInterval: (cb, ticks = 1) => {
    const t = setInterval(cb, Math.max(1, ticks) * TICK_MS);
    timers.add(t);
    return t;
  },
  run: (cb) => setTimeout(cb, TICK_MS),
};

// Gravity for the bot: it falls while there is nothing under its feet, and dies in the void.
system.runInterval(() => {
  for (const e of [...dimension.entities]) {
    if (e.typeId !== "skyai:bot") continue;
    const below = dimension.getBlock({ x: e.location.x, y: Math.round(e.location.y) - 1, z: e.location.z });
    if (!below) e.kill();
    else if (below.isAir || below.isLiquid) e.location.y -= 1;
  }
}, 2);

/** Test controls. */
export const testing = {
  dimension,
  addPlayer(name, location) {
    const p = new Entity(dimension, "minecraft:player", location);
    p.nameTag = name;
    p.name = name;
    return p;
  },
  scriptEvent: (id, message, sourceEntity) => system.afterEvents.scriptEventReceive.fire({ id, message, sourceEntity }),
  stop: () => timers.forEach((t) => clearInterval(t)),
};
