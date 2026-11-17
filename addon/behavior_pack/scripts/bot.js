// The AI's body in the world: a "skyai:bot" entity with its own inventory.
import { world, system, ItemStack } from "@minecraft/server";
import { findPath } from "./pathfind.js";
import { ActionError, center, dist, fail, getProp, overworld, posStr, setProp, short, sleep } from "./util.js";

export const BOT_TYPE = "skyai:bot";
const REACH = 4.5;

/** Things that happened since the AI last heard from us (deaths, pickups). */
const pendingNews = [];
const pickups = new Map();
let botName = "Claude";

export function addNews(text) {
  pendingNews.push(text);
}

export function takeNews() {
  const news = pendingNews.splice(0);
  if (pickups.size > 0) {
    news.push("Picked up: " + [...pickups].map(([id, n]) => `${short(id)} x${n}`).join(", "));
    pickups.clear();
  }
  return news;
}

export function getIsland() {
  return getProp("skyai:island", undefined);
}

export function setBotName(name) {
  botName = String(name).slice(0, 24) || "Claude";
  setProp("skyai:botName", botName);
  const bot = findBot();
  if (bot) bot.nameTag = botName;
}

export function getBotName() {
  return botName;
}

export function loadBotName() {
  botName = getProp("skyai:botName", "Claude");
}

function findBot() {
  const id = getProp("skyai:botId", undefined);
  if (id) {
    const entity = world.getEntity(id);
    if (entity && entity.isValid) return entity;
  }
  const found = overworld().getEntities({ type: BOT_TYPE });
  if (found.length > 0) {
    setProp("skyai:botId", found[0].id);
    return found[0];
  }
  return undefined;
}

/** Remove every bot entity (used when resetting). */
export function removeBots() {
  for (const entity of overworld().getEntities({ type: BOT_TYPE })) entity.remove();
  setProp("skyai:botId", undefined);
}

/** Get the bot, spawning it at the island spawn point if it does not exist. */
export function getBot() {
  const existing = findBot();
  if (existing) return existing;
  const island = getIsland();
  if (!island) fail("There is no Skyblock island yet. Ask the player to create one from the SkyAI menu (use the compass).");
  const spawn = island.spawn;
  let bot;
  try {
    bot = overworld().spawnEntity(BOT_TYPE, { x: spawn.x + 0.5, y: spawn.y, z: spawn.z + 0.5 });
  } catch {
    fail("The island is not loaded right now. The player needs to be near the island.");
  }
  bot.nameTag = botName;
  setProp("skyai:botId", bot.id);
  return bot;
}

export function botExists() {
  return findBot() !== undefined;
}

/** The block cell the bot's feet are in. */
export function botCell(bot) {
  const l = bot.location;
  return { x: Math.floor(l.x), y: Math.round(l.y), z: Math.floor(l.z) };
}

export function eyePos(cell) {
  return { x: cell.x + 0.5, y: cell.y + 1.6, z: cell.z + 0.5 };
}

// ---------- inventory ----------

export function container(bot) {
  const inv = bot.getComponent("minecraft:inventory");
  if (!inv || !inv.container) throw new Error("bot has no inventory");
  return inv.container;
}

/** List of { slot, id, amount } for every filled slot. */
export function listInventory(bot) {
  const c = container(bot);
  const out = [];
  for (let i = 0; i < c.size; i++) {
    const item = c.getItem(i);
    if (item) out.push({ slot: i, id: item.typeId, amount: item.amount });
  }
  return out;
}

export function countWhere(bot, predicate) {
  return listInventory(bot).reduce((n, e) => (predicate(e.id) ? n + e.amount : n), 0);
}

export const countItem = (bot, id) => countWhere(bot, (other) => short(other) === short(id));

/** Remove up to `amount` items matching predicate. Returns the list of {id, amount} removed. */
export function removeWhere(bot, predicate, amount) {
  const c = container(bot);
  const removed = [];
  let left = amount;
  for (let i = 0; i < c.size && left > 0; i++) {
    const item = c.getItem(i);
    if (!item || !predicate(item.typeId)) continue;
    const take = Math.min(left, item.amount);
    if (take === item.amount) {
      c.setItem(i, undefined);
    } else {
      item.amount -= take;
      c.setItem(i, item);
    }
    removed.push({ id: item.typeId, amount: take });
    left -= take;
  }
  return removed;
}

export const removeItem = (bot, id, amount) => removeWhere(bot, (other) => short(other) === short(id), amount);

/** Add items; anything that does not fit is dropped at the bot's feet. Returns true if all fit. */
export function giveItem(bot, id, amount) {
  const typeId = id.includes(":") ? id : "minecraft:" + id;
  let left = amount;
  let allFit = true;
  while (left > 0) {
    const stack = new ItemStack(typeId, 1);
    const n = Math.min(left, stack.maxAmount);
    stack.amount = n;
    const overflow = container(bot).addItem(stack);
    if (overflow) {
      allFit = false;
      bot.dimension.spawnItem(overflow, bot.location);
    }
    left -= n;
  }
  return allFit;
}

export function giveStack(bot, stack) {
  const overflow = container(bot).addItem(stack);
  if (overflow) bot.dimension.spawnItem(overflow, bot.location);
}

export function inventoryText(bot) {
  const totals = new Map();
  for (const e of listInventory(bot)) totals.set(e.id, (totals.get(e.id) ?? 0) + e.amount);
  if (totals.size === 0) return "empty";
  return [...totals].map(([id, n]) => `${short(id)} x${n}`).join(", ");
}

/** Wear down the tool in a slot by one use; it breaks when used up. */
export function damageTool(bot, slot) {
  const c = container(bot);
  const item = c.getItem(slot);
  if (!item) return;
  const durability = item.getComponent("minecraft:durability");
  if (!durability) return;
  if (durability.damage + 1 >= durability.maxDurability) {
    c.setItem(slot, undefined);
    addNews(`Your ${short(item.typeId)} broke.`);
  } else {
    durability.damage += 1;
    c.setItem(slot, item);
  }
}

// ---------- movement ----------

function face(bot, target) {
  try {
    bot.teleport(bot.location, { facingLocation: target });
  } catch {
    // facing is cosmetic
  }
}

export function lookAtBlock(bot, pos) {
  face(bot, center(pos));
}

/** Walk the bot along a path of cells, a few small steps per block. */
async function walk(bot, path) {
  for (const cell of path) {
    if (!bot.isValid) fail("You died while moving.");
    const from = bot.location;
    const to = { x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 };
    const look = { x: to.x, y: to.y + 1.6, z: to.z };
    const steps = 3;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const y = to.y >= from.y ? to.y : i === steps ? to.y : from.y;
      bot.teleport({ x: from.x + (to.x - from.x) * t, y, z: from.z + (to.z - from.z) * t }, { facingLocation: look });
      await sleep(1);
      if (!bot.isValid) fail("You died while moving.");
    }
  }
}

/** Walk to the cell that satisfies isGoal and is nearest. */
export async function walkTo(bot, isGoal, target, failMessage) {
  const start = botCell(bot);
  const path = findPath(bot.dimension, start, isGoal, (p) => Math.max(0, dist(p, target) - REACH));
  if (path === undefined) fail(failMessage);
  await walk(bot, path);
  return path.length;
}

/**
 * Make sure the bot can reach a block: walk closer if needed. `avoid` lists
 * cells the bot must not stand in (e.g. where a block is about to be placed).
 */
export async function approach(bot, pos, avoid = []) {
  const target = center(pos);
  const blocked = (cell) => avoid.some((a) => a.x === cell.x && a.z === cell.z && (a.y === cell.y || a.y === cell.y + 1));
  const ok = (cell) => dist(eyePos(cell), target) <= REACH && !blocked(cell);
  if (ok(botCell(bot))) return 0;
  return walkTo(bot, ok, pos, `Cannot get within reach of ${posStr(pos)}: there is no walkable path. Build a bridge or staircase toward it first.`);
}

// ---------- background jobs ----------

/** Pick up item drops near the bot. */
function collectItems() {
  const bot = findBot();
  if (!bot) return;
  let items;
  try {
    items = bot.dimension.getEntities({ type: "minecraft:item", location: bot.location, maxDistance: 2.5 });
  } catch {
    return;
  }
  for (const entity of items) {
    const stack = entity.getComponent("minecraft:item")?.itemStack;
    if (!stack) continue;
    const amount = stack.amount;
    const overflow = container(bot).addItem(stack);
    const taken = amount - (overflow?.amount ?? 0);
    if (taken > 0) pickups.set(stack.typeId, (pickups.get(stack.typeId) ?? 0) + taken);
    if (!overflow) {
      entity.remove();
    } else if (taken > 0) {
      const at = entity.location;
      entity.remove();
      bot.dimension.spawnItem(overflow, at);
    }
  }
}

export function startBotJobs() {
  system.runInterval(() => {
    try {
      collectItems();
    } catch {
      // keep the interval alive
    }
  }, 10);

  world.afterEvents.entityDie.subscribe((event) => {
    if (event.deadEntity.typeId !== BOT_TYPE) return;
    const cause = event.damageSource?.cause ?? "unknown";
    setProp("skyai:botId", undefined);
    addNews(`YOU DIED (cause: ${cause}). Everything you were carrying is gone. You respawned at the island spawn point.`);
    world.sendMessage(`§6${botName} died (${cause}).`);
  });
}

export { ActionError, REACH };
