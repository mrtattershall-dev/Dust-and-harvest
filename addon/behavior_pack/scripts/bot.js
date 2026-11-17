// The AI's body: a simulated player. It is a real Player entity created by
// the server (health, hunger, inventory, survival rules, appears in the
// player list) that is driven by this script instead of a network client.
import { world, system, GameMode, ItemStack } from "@minecraft/server";
import { spawnSimulatedPlayer } from "@minecraft/server-gametest";
import { findPath } from "./pathfind.js";
import { center, dist, fail, getProp, overworld, posStr, setProp, short, sleep } from "./util.js";

export const REACH = 4.5;

/** @type {import("@minecraft/server-gametest").SimulatedPlayer | undefined} */
let bot;
let botName = "Claude";
let respawning = false;
const pendingNews = [];

export function addNews(text) {
  pendingNews.push(text);
}
export function takeNews() {
  return pendingNews.splice(0);
}

export const getIsland = () => getProp("skyai:island", undefined);
export const getBotName = () => botName;
export const isBot = (entity) => bot !== undefined && entity.id === bot.id;

export function setBotName(name) {
  const clean = String(name).replace(/[^A-Za-z0-9_ ]/g, "").slice(0, 16) || "Claude";
  if (clean === botName) return;
  botName = clean;
  setProp("skyai:botName", botName);
  // The name is fixed when a player is created, so re-create the bot under the new name.
  if (bot && bot.isValid) {
    saveInventory();
    const at = bot.location;
    bot.disconnect();
    bot = undefined;
    spawnBot(at);
  }
}

export function loadBotName() {
  botName = getProp("skyai:botName", "Claude");
}

// ---------- inventory persistence ----------
// A simulated player is not saved with the world, so its inventory and
// position are stored in world data and restored when it is re-created.

export function saveInventory() {
  if (!bot || !bot.isValid || respawning) return;
  const c = container(bot);
  const items = [];
  for (let i = 0; i < c.size; i++) {
    const item = c.getItem(i);
    if (!item) continue;
    const durability = item.getComponent("minecraft:durability");
    items.push({ s: i, id: item.typeId, n: item.amount, d: durability ? durability.damage : 0 });
  }
  const l = bot.location;
  setProp("skyai:bot", { items, at: { x: l.x, y: l.y, z: l.z } });
}

function restoreInventory(player, saved) {
  const c = container(player);
  for (const entry of saved.items ?? []) {
    try {
      const stack = new ItemStack(entry.id, entry.n);
      const durability = stack.getComponent("minecraft:durability");
      if (durability && entry.d) durability.damage = entry.d;
      c.setItem(entry.s, stack);
    } catch {
      // item no longer exists in this game version
    }
  }
}

function spawnBot(at) {
  const island = getIsland();
  if (!island) fail("There is no island yet.");
  const saved = getProp("skyai:bot", undefined);
  const where = at ?? saved?.at ?? { x: island.spawn.x + 0.5, y: island.spawn.y, z: island.spawn.z + 0.5 };
  try {
    bot = spawnSimulatedPlayer({ dimension: overworld(), x: where.x, y: where.y, z: where.z }, botName, GameMode.Survival);
  } catch (e) {
    fail(`Could not create the AI player: ${e}`);
  }
  bot.setSpawnPoint({ dimension: overworld(), x: island.spawn.x, y: island.spawn.y, z: island.spawn.z });
  if (saved) restoreInventory(bot, saved);
  return bot;
}

/** The AI's player, created on first use. */
export function getBot() {
  if (bot && bot.isValid) return bot;
  if (respawning) fail("You are dead and respawning. Try again in a moment.");
  return spawnBot();
}

export const botExists = () => bot !== undefined && bot.isValid;

/** The block cell the bot's feet are in. */
export function botCell(player) {
  const l = player.location;
  return { x: Math.floor(l.x), y: Math.floor(l.y + 0.3), z: Math.floor(l.z) };
}

export const eyePos = (cell) => ({ x: cell.x + 0.5, y: cell.y + 1.6, z: cell.z + 0.5 });

// ---------- inventory ----------

export function container(player) {
  const inv = player.getComponent("minecraft:inventory");
  if (!inv || !inv.container) throw new Error("player has no inventory");
  return inv.container;
}

/** List of { slot, id, amount } for every filled slot. */
export function listInventory(player) {
  const c = container(player);
  const out = [];
  for (let i = 0; i < c.size; i++) {
    const item = c.getItem(i);
    if (item) out.push({ slot: i, id: item.typeId, amount: item.amount });
  }
  return out;
}

/** Totals per item id (short names). */
export function inventoryTotals(player) {
  const totals = {};
  for (const e of listInventory(player)) totals[short(e.id)] = (totals[short(e.id)] ?? 0) + e.amount;
  return totals;
}

export function countWhere(player, predicate) {
  return listInventory(player).reduce((n, e) => (predicate(e.id) ? n + e.amount : n), 0);
}
export const countItem = (player, id) => countWhere(player, (other) => short(other) === short(id));

/** Remove up to `amount` items matching predicate. */
export function removeWhere(player, predicate, amount) {
  const c = container(player);
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
    left -= take;
  }
  return amount - left;
}

/** Add items; anything that does not fit is dropped at the bot's feet. */
export function giveItem(player, id, amount) {
  const typeId = id.includes(":") ? id : "minecraft:" + id;
  let left = amount;
  while (left > 0) {
    const stack = new ItemStack(typeId, 1);
    const n = Math.min(left, stack.maxAmount);
    stack.amount = n;
    const overflow = container(player).addItem(stack);
    if (overflow) player.dimension.spawnItem(overflow, player.location);
    left -= n;
  }
}

export function inventoryText(player) {
  const totals = Object.entries(inventoryTotals(player));
  return totals.length ? totals.map(([id, n]) => `${id} x${n}`).join(", ") : "empty";
}

/** Describe what changed between two inventoryTotals() snapshots. */
export function diffText(before, after) {
  const gained = [];
  const lost = [];
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const d = (after[id] ?? 0) - (before[id] ?? 0);
    if (d > 0) gained.push(`${id} x${d}`);
    if (d < 0) lost.push(`${id} x${-d}`);
  }
  return { gained, lost };
}

/** Put the item in a slot into the hand. Returns the hotbar slot used. */
export function holdSlot(player, slot) {
  const c = container(player);
  let hotbar = slot;
  if (slot > 8) {
    hotbar = 0;
    for (let i = 0; i < 9; i++) {
      if (!c.getItem(i)) {
        hotbar = i;
        break;
      }
    }
    c.swapItems(slot, hotbar, c);
  }
  player.selectedSlotIndex = hotbar;
  return hotbar;
}

/** Hold the first stack of an item. Returns the hotbar slot, or undefined if the bot has none. */
export function holdItem(player, id) {
  const entry = listInventory(player).find((e) => short(e.id) === short(id));
  return entry ? holdSlot(player, entry.slot) : undefined;
}

// ---------- movement ----------

const horizontal = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Walk along a path of cells using the player's own legs. */
async function walk(player, path) {
  if (path.length === 0) return;
  const points = path.map((c) => ({ x: c.x + 0.5, y: c.y, z: c.z + 0.5 }));
  const goal = points[points.length - 1];
  const arrived = () => horizontal(player.location, goal) < 0.4 && Math.abs(player.location.y - goal.y) < 1.1;

  player.navigateToLocations(points, 1);
  let last = player.location;
  let still = 0;
  const limit = path.length * 16 + 60;
  for (let t = 0; t < limit; t += 2) {
    await sleep(2);
    if (!player.isValid) fail("You died while moving.");
    if (arrived()) break;
    const now = player.location;
    still = dist(now, last) < 0.02 ? still + 2 : 0;
    last = now;
    if (still >= 30) break;
  }
  player.stopMoving();
  if (arrived()) return;

  // Navigation gave up: finish the route one step at a time.
  for (const point of points) {
    if (horizontal(player.location, point) < 0.4 && Math.abs(player.location.y - point.y) < 1.1) continue;
    if (point.y > player.location.y + 0.5) player.jump();
    player.moveToLocation(point, { faceTarget: true });
    for (let t = 0; t < 40; t += 2) {
      await sleep(2);
      if (!player.isValid) fail("You died while moving.");
      if (horizontal(player.location, point) < 0.35 && Math.abs(player.location.y - point.y) < 1.1) break;
    }
  }
  player.stopMoving();
  if (!arrived()) {
    const c = botCell(player);
    fail(`Got stuck while walking; now at ${posStr(c)} instead of ${posStr(path[path.length - 1])}.`);
  }
}

/** Walk to the nearest cell that satisfies isGoal. Returns the number of blocks walked. */
export async function walkTo(player, isGoal, target, failMessage) {
  const start = botCell(player);
  const path = findPath(player.dimension, start, isGoal, (p) => Math.max(0, dist(p, target) - REACH));
  if (path === undefined) fail(failMessage);
  await walk(player, path);
  return path.length;
}

/**
 * Make sure the bot can reach a block, walking closer if needed.
 * `avoid` lists cells the bot must not stand in; `within` is the reach to use.
 */
export async function approach(player, pos, avoid = [], within = REACH) {
  const target = center(pos);
  const blocked = (cell) => avoid.some((a) => a.x === cell.x && a.z === cell.z && (a.y === cell.y || a.y === cell.y + 1));
  const ok = (cell) => dist(eyePos(cell), target) <= within && !blocked(cell);
  if (ok(botCell(player))) return 0;
  return walkTo(player, ok, pos, `Cannot get within reach of ${posStr(pos)}: there is no walkable path. Build a bridge or staircase toward it first.`);
}

// ---------- lifecycle ----------

export function startBotJobs() {
  system.runInterval(() => {
    try {
      saveInventory();
    } catch {
      // keep the interval alive
    }
  }, 100);

  world.afterEvents.entityDie.subscribe((event) => {
    if (!bot || event.deadEntity.id !== bot.id) return;
    const cause = event.damageSource?.cause ?? "unknown";
    const dead = bot;
    respawning = true;
    setProp("skyai:bot", undefined);
    addNews(`YOU DIED (cause: ${cause}). What you carried was dropped where you died (gone for good if that was the void). You respawned at the island spawn point with an empty inventory.`);
    system.runTimeout(() => {
      // Replace the dead player with a fresh one at the island spawn point.
      try {
        if (dead.isValid) dead.disconnect();
      } catch {
        // already gone
      }
      bot = undefined;
      system.runTimeout(() => {
        respawning = false;
        setProp("skyai:bot", undefined);
        try {
          const island = getIsland();
          spawnBot({ x: island.spawn.x + 0.5, y: island.spawn.y, z: island.spawn.z + 0.5 });
        } catch {
          // re-created on next use
        }
      }, 20);
    }, 30);
  });
}
