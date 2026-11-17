// Everything the AI can do with its player. Routine work (walking, timing,
// collecting, verifying) is done here in plain code; the AI model only decides
// what to do. Every result is built from what actually happened in the world
// (inventory and block checks after the action), not from what was intended.
import { world, BlockPermutation, Direction, ItemStack } from "@minecraft/server";
import {
  blockForItem, isLavaId, isLiquidId, isReplaceableId, isSource, isStandableId, isUnbreakable, isWaterId, miningPlan, plantRuleError,
} from "./blocks.js";
import {
  approach, botCell, container, countItem, countWhere, diffText, eyePos, getBot, getBotName, getIsland, giveItem, holdItem,
  holdSlot, inventoryText, inventoryTotals, isBot, listInventory, REACH, removeWhere, saveInventory, setBotName, takeNews, walkTo,
} from "./bot.js";
import { describeIngredients, getRecipe, matchesIngredient, recipeNames } from "./recipes.js";
import { add, center, dist, fail, posStr, setProp, short, sleep, toPos, ActionError } from "./util.js";

/** Thrown when an action is risky enough that the human must approve it first. */
export class ApprovalNeeded extends Error {}

function blockAt(bot, pos) {
  let block;
  try {
    block = bot.dimension.getBlock(pos);
  } catch {
    block = undefined;
  }
  if (!block) fail(`${posStr(pos)} is not loaded or outside the world.`);
  return block;
}

function typeAt(bot, pos) {
  try {
    return bot.dimension.getBlock(pos)?.typeId ?? "minecraft:air";
  } catch {
    return "minecraft:air";
  }
}

function attribute(bot, id) {
  const c = bot.getComponent(id);
  return c ? Math.round(c.currentValue) : undefined;
}

function statusLine(bot) {
  const c = botCell(bot);
  return `You are at ${posStr(c)}, health ${attribute(bot, "minecraft:health") ?? "?"}/20, hunger ${attribute(bot, "minecraft:player.hunger") ?? "?"}/20. Inventory: ${inventoryText(bot)}.`;
}

function positionsFrom(args, max) {
  const list = Array.isArray(args.positions) && args.positions.length > 0 ? args.positions.map(toPos) : [toPos(args)];
  if (list.length > max) fail(`Too many positions at once (max ${max}).`);
  return list;
}

const NEIGHBORS = [
  { d: [0, -1, 0], face: Direction.Up },
  { d: [1, 0, 0], face: Direction.West },
  { d: [-1, 0, 0], face: Direction.East },
  { d: [0, 0, 1], face: Direction.North },
  { d: [0, 0, -1], face: Direction.South },
  { d: [0, 1, 0], face: Direction.Down },
];

const samePos = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;

// ---------- safety checks that need the human's approval ----------

function touchesLiquid(bot, pos) {
  for (const n of NEIGHBORS) {
    const id = typeAt(bot, add(pos, n.d[0], n.d[1], n.d[2]));
    if (isLiquidId(id)) return isLavaId(id) ? "lava" : "water";
  }
  return undefined;
}

function saplingsAvailable(bot) {
  if (countWhere(bot, (id) => short(id).endsWith("_sapling")) > 0) return true;
  const c = botCell(bot);
  for (let dx = -10; dx <= 10; dx++) {
    for (let dy = -4; dy <= 6; dy++) {
      for (let dz = -10; dz <= 10; dz++) {
        if (short(typeAt(bot, add(c, dx, dy, dz))).endsWith("_sapling")) return true;
      }
    }
  }
  return false;
}

function checkMineRisk(bot, pos, typeId, approved) {
  if (approved) return;
  const island = getIsland();
  const s = short(typeId);
  const liquid = touchesLiquid(bot, pos);
  if (liquid && !samePos(island?.generator?.cobble, pos)) {
    throw new ApprovalNeeded(`mine the ${s} at ${posStr(pos)}, which is touching ${liquid}. Breaking it could let the ${liquid} escape or ruin the cobblestone generator`);
  }
  if (/_log$/.test(s) && !saplingsAvailable(bot)) {
    throw new ApprovalNeeded(`cut the ${s} at ${posStr(pos)} while we have no sapling to replant. If the leaves drop no sapling, we lose wood forever`);
  }
}

// ---------- observe ----------

function describeBlock(block) {
  const s = short(block.typeId);
  if (isLiquidId(block.typeId)) return (isWaterId(block.typeId) ? "water" : "lava") + (isSource(block) ? "(source)" : "(flowing)");
  if (["wheat", "carrots", "potatoes", "beetroot"].includes(s)) {
    try {
      return `${s}(growth ${block.permutation.getState("growth")}/7)`;
    } catch {
      return s;
    }
  }
  return s;
}

/** Compress block positions into runs: "y=64: z=0 x=0..5; z=1 x=0..5". */
function compressPositions(list) {
  list.sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
  const layers = [];
  let layerY;
  let rows = [];
  let run;
  const flushRun = () => {
    if (run) rows.push(`z=${run.z} x=${run.x0 === run.x1 ? run.x0 : `${run.x0}..${run.x1}`}`);
    run = undefined;
  };
  const flushLayer = () => {
    flushRun();
    if (rows.length > 0) layers.push(`y=${layerY}: ${rows.join("; ")}`);
    rows = [];
  };
  for (const p of list) {
    if (p.y !== layerY) {
      flushLayer();
      layerY = p.y;
    }
    if (run && run.z === p.z && run.x1 === p.x - 1) {
      run.x1 = p.x;
    } else {
      flushRun();
      run = { z: p.z, x0: p.x, x1: p.x };
    }
  }
  flushLayer();
  return layers.join(" | ");
}

function landmarksText() {
  const island = getIsland();
  if (!island) return "";
  const parts = [`spawn ${posStr(island.spawn)}`, `main chest ${posStr(island.chest)}`];
  if (island.generator) {
    parts.push(`cobblestone generator: the cobblestone forms at ${posStr(island.generator.cobble)}${island.generator.stand ? `, mine it standing at ${posStr(island.generator.stand)}` : ""} (water source ${posStr(island.generator.water)}, lava source ${posStr(island.generator.lava)} - never break the blocks around them)`);
  }
  for (const [name, p] of Object.entries(island.marks ?? {})) parts.push(`${name} ${posStr(p)}`);
  return `Known places: ${parts.join("; ")}.`;
}

function observe(bot, args) {
  const radius = Math.min(Math.max(Number(args.radius) || 7, 2), 12);
  const vertical = Math.min(radius, 6);
  const c = botCell(bot);
  const byType = new Map();
  let total = 0;
  for (let y = c.y - vertical; y <= c.y + vertical; y++) {
    for (let x = c.x - radius; x <= c.x + radius; x++) {
      for (let z = c.z - radius; z <= c.z + radius; z++) {
        let block;
        try {
          block = bot.dimension.getBlock({ x, y, z });
        } catch {
          continue;
        }
        if (!block || block.isAir) continue;
        const name = describeBlock(block);
        if (!byType.has(name)) byType.set(name, []);
        byType.get(name).push({ x, y, z });
        total++;
      }
    }
  }
  const lines = [statusLine(bot)];
  const marks = landmarksText();
  if (marks) lines.push(marks);
  const time = world.getTimeOfDay();
  lines.push(`Time: ${time < 12000 ? "day" : "night"} (${time}). Standing on: ${short(typeAt(bot, add(c, 0, -1, 0)))}.`);
  lines.push(`Blocks within ${radius} (x east, y up, z south). Everything not listed is air/void:`);
  if (total === 0) lines.push("  (none - nothing but void nearby!)");
  for (const [name, list] of byType) lines.push(`  ${name} [${list.length}]: ${compressPositions(list)}`);

  const entities = [];
  try {
    for (const e of bot.dimension.getEntities({ location: bot.location, maxDistance: 24 })) {
      if (isBot(e)) continue;
      const l = e.location;
      const where = `(${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)})`;
      if (e.typeId === "minecraft:item") {
        const stack = e.getComponent("minecraft:item")?.itemStack;
        entities.push(`dropped item ${stack ? short(stack.typeId) + " x" + stack.amount : "?"} at ${where}`);
      } else if (e.typeId === "minecraft:player") {
        entities.push(`player ${/** @type {any} */ (e).name ?? "?"} at ${where}`);
      } else {
        entities.push(`${short(e.typeId)} id=${e.id} at ${where}`);
      }
    }
  } catch {
    // ignore
  }
  lines.push(entities.length ? `Entities: ${entities.slice(0, 20).join("; ")}` : "Entities: none nearby.");
  return lines.join("\n");
}

// ---------- move ----------

async function moveTo(bot, args) {
  const target = toPos(args);
  const isGoal = (cell) => cell.x === target.x && cell.z === target.z && Math.abs(cell.y - target.y) <= 1;
  const steps = await walkTo(bot, isGoal, target, `No walkable path to ${posStr(target)}. You can only walk on solid blocks, step up 1 and drop down up to 3. Place blocks to build a bridge or stairs.`);
  return `Walked ${steps} blocks.`;
}

async function comeToPlayer(bot, args) {
  const players = world.getAllPlayers().filter((p) => !isBot(p));
  const target = args.name ? players.find((p) => p.name.toLowerCase() === String(args.name).toLowerCase()) : players[0];
  if (!target) fail("No human player is online.");
  const l = target.location;
  const near = { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) };
  const steps = await walkTo(bot, (cell) => dist(cell, near) <= 2.5, near, `No walkable path to ${target.name} at ${posStr(near)}.`);
  bot.lookAtEntity(target);
  return `Walked ${steps} blocks to ${target.name}.`;
}

// ---------- mine ----------

/** After breaking a block, walk to pick up drops that did not land next to us. */
async function collectDrops(bot, pos) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(8);
    let items;
    try {
      items = bot.dimension.getEntities({ type: "minecraft:item", location: center(pos), maxDistance: 3.5 });
    } catch {
      return;
    }
    items = items.filter((e) => e.location.y > pos.y - 3);
    if (items.length === 0) return;
    const item = items[0].location;
    const cell = { x: Math.floor(item.x), y: Math.floor(item.y), z: Math.floor(item.z) };
    try {
      // Drops are only picked up from the same level, so stand level with the item and next to it.
      await walkTo(bot, (c) => Math.abs(c.x - cell.x) <= 1 && Math.abs(c.z - cell.z) <= 1 && c.y === cell.y, cell, "unreachable");
    } catch (e) {
      if (!(e instanceof ActionError) || !bot.isValid) throw e;
      return; // the drop is somewhere we cannot walk to
    }
  }
}

async function mineOne(bot, pos, approved, stay = false) {
  const block = blockAt(bot, pos);
  if (block.isAir) return `${posStr(pos)}: already empty`;
  if (isLiquidId(block.typeId)) return `${posStr(pos)}: is ${describeBlock(block)}; liquids cannot be mined`;
  if (isUnbreakable(block.typeId)) return `${posStr(pos)}: ${short(block.typeId)} cannot be broken`;
  checkMineRisk(bot, pos, block.typeId, approved);

  // Stand close (so drops are picked up), and never on the block being mined.
  const standingOn = [add(pos, 0, 1, 0)];
  try {
    if (!stay || dist(eyePos(botCell(bot)), center(pos)) > REACH) await approach(bot, pos, standingOn, 3.2);
  } catch (e) {
    if (!(e instanceof ActionError) || !bot.isValid) throw e;
    try {
      await approach(bot, pos, standingOn);
    } catch (e2) {
      if (!(e2 instanceof ActionError) || !bot.isValid) throw e2;
      await approach(bot, pos);
    }
  }
  const cell = botCell(bot);
  if (cell.x === pos.x && cell.z === pos.z && pos.y === cell.y - 1) {
    let support = false;
    for (let d = 2; d <= 4; d++) if (isStandableId(typeAt(bot, add(cell, 0, -d, 0)))) support = true;
    if (!support) return `${posStr(pos)}: refused - that is the block you are standing on and there is only void below it`;
  }

  const plan = miningPlan(block.typeId, listInventory(bot));
  if (plan.seconds > 30) return `${posStr(pos)}: ${short(block.typeId)} would take ${Math.round(plan.seconds)}s and ${plan.note}; skipped`;
  if (plan.toolSlot !== undefined) holdSlot(bot, plan.toolSlot);
  const typeBefore = block.typeId;
  const before = inventoryTotals(bot);
  bot.lookAtBlock(pos);
  await sleep(2);
  bot.breakBlock(pos);
  const limit = Math.ceil(plan.seconds * 20 * 1.6) + 40;
  let broken = false;
  for (let t = 0; t < limit; t += 2) {
    await sleep(2);
    if (!bot.isValid) fail("You died while mining.");
    if (typeAt(bot, pos) !== typeBefore) {
      broken = true;
      break;
    }
  }
  if (!broken) {
    bot.stopBreakingBlock();
    return `${posStr(pos)}: could not break ${short(typeBefore)} (still there after ${Math.round(limit / 20)}s)`;
  }
  if (stay) await sleep(14); // drops within reach are picked up where we stand
  else await collectDrops(bot, pos);
  const { gained } = diffText(before, inventoryTotals(bot));
  const now = short(typeAt(bot, pos));
  const note = gained.length ? `picked up ${gained.join(", ")}` : plan.drops ? "the drop was NOT picked up (it fell away or is out of reach)" : `nothing dropped (${plan.note})`;
  return `${posStr(pos)}: broke ${short(typeBefore)}; ${note}${now !== "air" ? `; that spot is now ${now}` : ""}`;
}

async function mine(bot, args) {
  const results = [];
  for (const pos of positionsFrom(args, 24)) {
    try {
      results.push(await mineOne(bot, pos, args.approved === true));
    } catch (e) {
      if (!(e instanceof ActionError) || !bot.isValid || results.length === 0) throw e;
      results.push(`${posStr(pos)}: FAILED - ${e.message} (stopped here)`);
      break;
    }
  }
  return results.join("\n");
}

// ---------- place ----------

async function placeOne(bot, item, pos, approved) {
  if (countItem(bot, item) < 1) fail(`You have no ${item}.`);
  if (item === "lava_bucket" && !approved) throw new ApprovalNeeded(`pour our lava at ${posStr(pos)}. If it touches water the wrong way it turns to obsidian and is lost`);
  const target = blockAt(bot, pos);
  if (!isReplaceableId(target.typeId)) fail(`${posStr(pos)} is already occupied by ${short(target.typeId)}.`);
  const support = NEIGHBORS.map((n) => ({ ...n, pos: add(pos, n.d[0], n.d[1], n.d[2]) })).find((n) => {
    const id = typeAt(bot, n.pos);
    return short(id) !== "air" && !isLiquidId(id) && !isReplaceableId(id);
  });
  if (!support) fail(`${posStr(pos)} has no solid block next to it. Blocks must be placed against an existing block.`);

  const blockName = blockForItem(item);
  const ruleError = plantRuleError(blockName, typeAt(bot, add(pos, 0, -1, 0)));
  if (ruleError) fail(`Cannot place ${item} at ${posStr(pos)}: ${ruleError}.`);
  try {
    BlockPermutation.resolve("minecraft:" + blockName);
  } catch {
    fail(`${item} is not something that can be placed as a block.`);
  }

  await approach(bot, pos, [pos]);
  const slot = holdItem(bot, item);
  if (slot === undefined) fail(`You have no ${item}.`);
  const before = target.typeId;
  bot.lookAtBlock(support.pos);
  await sleep(2);
  bot.useItemInSlotOnBlock(slot, support.pos, support.face, { x: 0.5, y: 0.5, z: 0.5 });
  await sleep(4);
  const after = typeAt(bot, pos);
  if (after === before) fail(`Placing ${item} at ${posStr(pos)} did not work (the spot is still ${short(before)}).`);
  return `${posStr(pos)}: placed, the block there is now ${describeBlock(blockAt(bot, pos))}`;
}

async function place(bot, args) {
  if (typeof args.item !== "string") fail("place_block needs an item name.");
  const item = short(args.item);
  const results = [];
  for (const pos of positionsFrom(args, 24)) {
    try {
      results.push(await placeOne(bot, item, pos, args.approved === true));
    } catch (e) {
      if (!(e instanceof ActionError) || !bot.isValid || results.length === 0) throw e;
      results.push(`${posStr(pos)}: FAILED - ${e.message} (stopped here)`);
      break;
    }
  }
  return results.join("\n");
}

// ---------- chests ----------
// A simulated player has no inventory screen, so after walking up to the
// chest and opening it, items are moved by the server script.

async function openContainer(bot, pos) {
  await approach(bot, pos);
  const block = blockAt(bot, pos);
  const inv = block.getComponent("minecraft:inventory")?.container;
  if (!inv) fail(`${posStr(pos)} is ${short(block.typeId)}, which has no inventory.`);
  bot.lookAtBlock(pos);
  try {
    bot.interactWithBlock(pos);
  } catch {
    // opening is only for show
  }
  await sleep(6);
  return inv;
}

function closeContainer(bot) {
  try {
    bot.stopInteracting();
  } catch {
    // ignore
  }
}

function containerTotals(inv) {
  const totals = {};
  for (let i = 0; i < inv.size; i++) {
    const item = inv.getItem(i);
    if (item) totals[short(item.typeId)] = (totals[short(item.typeId)] ?? 0) + item.amount;
  }
  return totals;
}

function totalsText(totals) {
  const entries = Object.entries(totals);
  return entries.length ? entries.map(([id, n]) => `${id} x${n}`).join(", ") : "empty";
}

/** Move up to `want` items of one kind (or everything if kind is undefined) between containers. */
function moveItems(from, to, kind, want) {
  let left = want;
  for (let i = 0; i < from.size && left > 0; i++) {
    const item = from.getItem(i);
    if (!item || (kind && short(item.typeId) !== kind)) continue;
    const n = Math.min(left, item.amount);
    const moving = item.clone();
    moving.amount = n;
    const overflow = to.addItem(moving);
    const moved = n - (overflow?.amount ?? 0);
    if (moved === item.amount) {
      from.setItem(i, undefined);
    } else if (moved > 0) {
      item.amount -= moved;
      from.setItem(i, item);
    }
    left -= moved;
    if (overflow) break;
  }
  return want - left;
}

async function lookInChest(bot, args) {
  const pos = toPos(args);
  const inv = await openContainer(bot, pos);
  closeContainer(bot);
  return `Chest at ${posStr(pos)} contains: ${totalsText(containerTotals(inv))}.`;
}

async function takeFromChest(bot, args) {
  const pos = toPos(args);
  const inv = await openContainer(bot, pos);
  const kind = typeof args.item === "string" && args.item !== "all" ? short(args.item) : undefined;
  const before = inventoryTotals(bot);
  moveItems(inv, container(bot), kind, kind ? Math.max(1, Number(args.count) || 64) : 9999);
  closeContainer(bot);
  const { gained } = diffText(before, inventoryTotals(bot));
  if (gained.length === 0) fail(kind ? `The chest has no ${kind}. It contains: ${totalsText(containerTotals(inv))}.` : "Nothing was taken (the chest is empty or your inventory is full).");
  return `Took ${gained.join(", ")}. The chest now contains: ${totalsText(containerTotals(inv))}.`;
}

async function putInChest(bot, args) {
  const pos = toPos(args);
  if (typeof args.item !== "string") fail("put_in_chest needs an item name.");
  const kind = short(args.item);
  const have = countItem(bot, kind);
  if (have < 1) fail(`You have no ${kind}.`);
  const inv = await openContainer(bot, pos);
  const chestBefore = containerTotals(inv)[kind] ?? 0;
  moveItems(container(bot), inv, kind, Math.min(have, Math.max(1, Number(args.count) || have)));
  closeContainer(bot);
  const chestAfter = containerTotals(inv)[kind] ?? 0;
  if (chestAfter === chestBefore) fail("Nothing was stored (the chest is full).");
  return `Stored ${kind} x${chestAfter - chestBefore}. The chest had ${chestBefore} ${kind} and now has ${chestAfter}. It contains: ${totalsText(containerTotals(inv))}.`;
}

// ---------- crafting ----------
// There is no crafting screen for a simulated player, so recipes are applied
// by this script: ingredients are removed and the result added, and the
// crafting-table requirement is enforced.

function nearbyBlock(bot, name) {
  const c = botCell(bot);
  for (let dx = -4; dx <= 4; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dz = -4; dz <= 4; dz++) {
        const p = add(c, dx, dy, dz);
        if (short(typeAt(bot, p)) === name && dist(eyePos(c), center(p)) <= REACH + 0.5) return p;
      }
    }
  }
  return undefined;
}

async function craft(bot, args) {
  if (typeof args.item !== "string") fail("craft needs an item name.");
  const item = short(args.item);
  const recipe = getRecipe(item);
  if (!recipe) {
    const similar = recipeNames().filter((n) => n.includes(item) || item.includes(n)).slice(0, 8);
    fail(`No known recipe for "${item}".${item === "planks" ? " Name the wood, e.g. oak_planks." : ""}${similar.length ? " Similar: " + similar.join(", ") + "." : ""}`);
  }
  const table = recipe.table ? nearbyBlock(bot, "crafting_table") : undefined;
  if (recipe.table && !table) fail(`${item} needs a crafting table within reach. Craft a crafting_table (4 planks), place it, and stand next to it.`);
  const want = Math.max(1, Math.min(64, Number(args.count) || 1));
  const batches = Math.ceil(want / recipe.out);
  for (const [ingredient, n] of Object.entries(recipe.in)) {
    const have = countWhere(bot, (id) => matchesIngredient(ingredient, id));
    if (have < n * batches) {
      fail(`Not enough materials for ${want} ${item}: one craft makes ${recipe.out} and needs ${describeIngredients(recipe)}. You have ${have} of the ${n * batches} ${ingredient.replace(/^#/, "")} needed.`);
    }
  }
  try {
    new ItemStack("minecraft:" + item, 1);
  } catch {
    fail(`"${item}" is not a valid item in this version of Minecraft.`);
  }
  if (table) bot.lookAtBlock(table);
  await sleep(8);
  const before = inventoryTotals(bot);
  for (const [ingredient, n] of Object.entries(recipe.in)) removeWhere(bot, (id) => matchesIngredient(ingredient, id), n * batches);
  giveItem(bot, item, recipe.out * batches);
  const after = inventoryTotals(bot);
  return `Crafted ${item}: you now have ${after[item] ?? 0} (had ${before[item] ?? 0}).`;
}

// ---------- routine: harvest the cobblestone generator ----------

const hasPickaxe = (bot) => listInventory(bot).some((e) => /_pickaxe$/.test(e.id));

async function harvestGenerator(bot, args) {
  const generator = getIsland()?.generator;
  if (!generator) fail("No cobblestone generator is recorded for this island. Use observe to find one, or build one.");
  const want = Math.max(1, Math.min(128, Number(args.count) || 8));
  const cell = generator.cobble;
  if (!hasPickaxe(bot)) fail("You need a pickaxe to collect cobblestone (mining it by hand drops nothing). Look in the chest or craft one.");

  // Stand in the generator's mining spot if it has one.
  if (generator.stand) {
    const spot = generator.stand;
    await walkTo(bot, (c) => c.x === spot.x && c.y === spot.y && c.z === spot.z, spot, `Cannot walk to the generator's standing spot at ${posStr(spot)}.`);
  }
  const start = countItem(bot, "cobblestone");
  let broken = 0;
  let waited = 0;
  while (countItem(bot, "cobblestone") - start < want) {
    if (!bot.isValid) fail("You died while harvesting.");
    if (!hasPickaxe(bot)) break; // the pickaxe wore out
    const type = short(typeAt(bot, cell));
    if (type === "cobblestone" || type === "stone") {
      waited = 0;
      await mineOne(bot, cell, true, true);
      broken++;
      if (broken > want * 3 + 6) break; // drops keep getting lost; stop instead of looping forever
    } else {
      await sleep(10);
      waited += 10;
      if (waited > 300) {
        const got = countItem(bot, "cobblestone") - start;
        fail(`The generator stopped making cobblestone: ${posStr(cell)} has been ${type} for 15 seconds. Collected ${got} so far. Check the water and lava with observe.`);
      }
    }
  }
  const got = countItem(bot, "cobblestone") - start;
  const lines = [`Broke the generator block ${broken} times; cobblestone in inventory went from ${start} to ${start + got} (+${got}, wanted ${want}).`];
  if (args.deposit !== false && got > 0) {
    const chest = args.chest ? toPos(args.chest) : getIsland().chest;
    lines.push(await putInChest(bot, { ...chest, item: "cobblestone", count: got }));
  }
  return lines.join("\n");
}

// ---------- other ----------

async function wait(bot, args) {
  const seconds = Math.max(1, Math.min(120, Number(args.seconds) || 5));
  await sleep(seconds * 20);
  return `Waited ${seconds} seconds.`;
}

function say(bot, args) {
  const text = String(args.message ?? "").slice(0, 400);
  if (!text) fail("say needs a message.");
  bot.chat(text);
  return "Message sent.";
}

function rememberPlace(bot, args) {
  const island = getIsland();
  const name = String(args.name ?? "").replace(/[^a-z0-9_ ]/gi, "").slice(0, 30);
  if (!name) fail("remember_place needs a name.");
  island.marks = island.marks ?? {};
  if (args.forget === true) delete island.marks[name];
  else island.marks[name] = toPos(args);
  setProp("skyai:island", island);
  return `Known places updated. ${landmarksText()}`;
}

const ACTIONS = {
  observe, move_to: moveTo, come_to_player: comeToPlayer, mine_block: mine, place_block: place, look_in_chest: lookInChest,
  take_from_chest: takeFromChest, put_in_chest: putInChest, craft, harvest_generator: harvestGenerator, wait, say,
  remember_place: rememberPlace,
};

/**
 * Run one action. Always resolves to { ok, text } or, for risky actions,
 * { ok: false, needsApproval: "what the bot wants to do" }.
 */
export async function runAction(method, args) {
  if (method === "ping") return { ok: true, text: "pong", island: getIsland() ?? null, players: world.getAllPlayers().filter((p) => !isBot(p)).map((p) => p.name) };
  if (method === "config") {
    if (args.name) setBotName(args.name);
    getBot();
    return { ok: true, text: `Bot name: ${getBotName()}` };
  }
  const handler = ACTIONS[method];
  if (!handler) return { ok: false, text: `Unknown action "${method}".` };
  let bot;
  try {
    bot = getBot();
    const before = takeNews();
    const text = await handler(bot, args ?? {});
    const news = before.concat(takeNews());
    saveInventory();
    const tail = method === "observe" || method === "say" ? "" : "\n" + statusLine(getBot());
    return { ok: true, text: (news.length ? news.join("\n") + "\n" : "") + text + tail };
  } catch (e) {
    try {
      if (bot && bot.isValid) bot.stopMoving();
    } catch {
      // ignore
    }
    if (e instanceof ApprovalNeeded) return { ok: false, needsApproval: e.message, text: "" };
    const news = takeNews();
    const prefix = news.length ? news.join("\n") + "\n" : "";
    let tail = "";
    try {
      tail = "\n" + statusLine(getBot());
    } catch {
      // dead or no island
    }
    if (e instanceof ActionError) return { ok: false, text: prefix + e.message + tail };
    return { ok: false, text: `${prefix}The action "${method}" was interrupted (${e}).${tail}` };
  }
}
