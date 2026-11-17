// Everything the AI can do. Each action returns a short text result that is
// sent back to the AI. Rules of survival Minecraft are enforced here: reach,
// needing the item, mining time, tools, crafting recipes.
import { world, BlockPermutation, ItemStack } from "@minecraft/server";
import {
  blockForItem, isLavaId, isLiquidId, isReplaceableId, isSource, isStandableId, isUnbreakable, isWaterId,
  miningPlan, plantRuleError, specialDrops,
} from "./blocks.js";
import {
  approach, botCell, container, countItem, countWhere, damageTool, eyePos, getBot, getBotName, getIsland,
  giveItem, giveStack, inventoryText, listInventory, lookAtBlock, REACH, removeItem, removeWhere, setBotName,
  takeNews, walkTo,
} from "./bot.js";
import { buildTree } from "./island.js";
import { describeIngredients, fuelValue, getRecipe, matchesIngredient, recipeNames, smeltResult } from "./recipes.js";
import { add, center, dist, fail, posStr, randInt, short, sleep, toPos, ActionError } from "./util.js";

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

function statusLine(bot) {
  const c = botCell(bot);
  const health = bot.getComponent("minecraft:health");
  const hp = health ? `${Math.ceil(health.currentValue)}/${health.effectiveMax}` : "?";
  return `You are at ${posStr(c)}, health ${hp}. Inventory: ${inventoryText(bot)}.`;
}

/** List of positions from args.positions, or a single args.x/y/z. */
function positionsFrom(args, max) {
  const list = Array.isArray(args.positions) && args.positions.length > 0 ? args.positions.map(toPos) : [toPos(args)];
  if (list.length > max) fail(`Too many positions at once (max ${max}).`);
  return list;
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
  const island = getIsland();
  if (island) {
    lines.push(`Island: top grass layer is y=${island.origin.y} (stand at y=${island.origin.y + 1}); spawn ${posStr(island.spawn)}; starter chest ${posStr(island.chest)}; sand island with a second chest about 64 blocks west near ${posStr(island.sand)}.`);
  }
  const time = world.getTimeOfDay();
  lines.push(`Time: ${time < 12000 ? "day" : "night"} (${time}). Standing on: ${short(typeAt(bot, add(c, 0, -1, 0)))}.`);
  lines.push(`Blocks within ${radius} (x east, y up, z south). Everything not listed is air/void:`);
  if (total === 0) lines.push("  (none - nothing but void nearby!)");
  for (const [name, list] of byType) lines.push(`  ${name} [${list.length}]: ${compressPositions(list)}`);

  const entities = [];
  try {
    for (const e of bot.dimension.getEntities({ location: bot.location, maxDistance: 16 })) {
      if (e.id === bot.id) continue;
      const l = e.location;
      const where = `(${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)})`;
      if (e.typeId === "minecraft:item") {
        const stack = e.getComponent("minecraft:item")?.itemStack;
        entities.push(`dropped item ${stack ? short(stack.typeId) + " x" + stack.amount : "?"} at ${where}`);
      } else if (e.typeId === "minecraft:player") {
        entities.push(`player ${e.nameTag || "?"} at ${where}`);
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

// ---------- mine ----------

async function mineOne(bot, pos) {
  let block = blockAt(bot, pos);
  if (block.isAir) return `${posStr(pos)}: already empty`;
  if (isLiquidId(block.typeId)) return `${posStr(pos)}: is ${describeBlock(block)}; liquids cannot be mined (use fill_bucket on a source)`;
  if (isUnbreakable(block.typeId)) return `${posStr(pos)}: ${short(block.typeId)} cannot be broken`;

  // Step off the block first if you are standing on it, so you do not fall into the hole.
  try {
    await approach(bot, pos, [add(pos, 0, 1, 0)]);
  } catch (e) {
    if (!(e instanceof ActionError) || !bot.isValid) throw e;
    await approach(bot, pos);
  }
  const cell = botCell(bot);
  if (cell.x === pos.x && cell.z === pos.z && pos.y === cell.y - 1) {
    let support = false;
    for (let d = 2; d <= 4; d++) if (isStandableId(typeAt(bot, add(cell, 0, -d, 0)))) support = true;
    if (!support) return `${posStr(pos)}: refused - that is the block you are standing on and there is only void below it. Stand somewhere else first.`;
  }

  const plan = miningPlan(block.typeId, listInventory(bot));
  if (plan.seconds > 30) return `${posStr(pos)}: ${short(block.typeId)} would take ${Math.round(plan.seconds)}s and ${plan.note}; skipped`;
  const typeBefore = block.typeId;
  lookAtBlock(bot, pos);
  await sleep(plan.seconds * 20);
  if (!bot.isValid) fail("You died while mining.");
  block = blockAt(bot, pos);
  if (block.typeId !== typeBefore) return `${posStr(pos)}: changed to ${short(block.typeId)} while mining; try again`;

  const gained = [];
  // Containers spill their contents.
  const inside = block.getComponent("minecraft:inventory")?.container;
  if (inside) {
    for (let i = 0; i < inside.size; i++) {
      const item = inside.getItem(i);
      if (item) {
        gained.push(`${short(item.typeId)} x${item.amount}`);
        giveStack(bot, item);
        inside.setItem(i, undefined);
      }
    }
  }
  const name = short(typeBefore);
  if (plan.drops) {
    const special = specialDrops(block, plan.toolId === "shears");
    if (special) {
      for (const d of special) {
        giveItem(bot, d.id, d.amount);
        gained.push(`${d.id} x${d.amount}`);
      }
    } else {
      let stack;
      try {
        stack = block.getItemStack(1);
      } catch {
        stack = undefined;
      }
      if (stack) {
        giveStack(bot, stack);
        gained.push(`${short(stack.typeId)} x1`);
      }
    }
  }
  // Ice melts into water when broken with a block underneath.
  const below = typeAt(bot, add(pos, 0, -1, 0));
  if (name === "ice" && short(below) !== "air") {
    block.setType("minecraft:water");
  } else {
    block.setType("minecraft:air");
  }
  if (plan.toolSlot !== undefined) damageTool(bot, plan.toolSlot);
  const extra = name === "ice" ? (short(below) !== "air" ? " (it melted into a water source)" : " (no block below, so no water was left)") : "";
  return `${posStr(pos)}: mined ${name}${gained.length ? " -> " + gained.join(", ") : plan.drops ? " (dropped nothing)" : ` (dropped nothing: ${plan.note})`}${extra}`;
}

async function mine(bot, args) {
  const results = [];
  for (const pos of positionsFrom(args, 24)) {
    try {
      results.push(await mineOne(bot, pos));
    } catch (e) {
      // Nothing done yet: report a plain failure. Otherwise report what was done, then the problem.
      if (!(e instanceof ActionError) || !bot.isValid || results.length === 0) throw e;
      results.push(`${posStr(pos)}: FAILED - ${e.message} (stopped here)`);
      break;
    }
  }
  return results.join("\n");
}

// ---------- place ----------

const NEIGHBORS = [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

async function placeOne(bot, item, pos) {
  if (countItem(bot, item) < 1) fail(`You have no ${item}.`);
  const target = blockAt(bot, pos);
  if (!isReplaceableId(target.typeId)) fail(`${posStr(pos)} is already occupied by ${short(target.typeId)}.`);
  const supported = NEIGHBORS.some(([dx, dy, dz]) => {
    const id = typeAt(bot, add(pos, dx, dy, dz));
    return short(id) !== "air" && !isLiquidId(id);
  });
  if (!supported) fail(`${posStr(pos)} has no solid block next to it. Blocks must be placed against an existing block.`);

  const blockName = blockForItem(item);
  const belowId = typeAt(bot, add(pos, 0, -1, 0));
  const ruleError = plantRuleError(blockName, belowId);
  if (ruleError) fail(`Cannot place ${item} at ${posStr(pos)}: ${ruleError}.`);
  let permutation;
  try {
    permutation = BlockPermutation.resolve("minecraft:" + blockName);
  } catch {
    fail(`${item} is not something that can be placed as a block.`);
  }

  await approach(bot, pos, [pos]);
  lookAtBlock(bot, pos);
  await sleep(4);
  blockAt(bot, pos).setPermutation(permutation);
  removeItem(bot, item, 1);
  if (short(item) === "water_bucket" || short(item) === "lava_bucket") giveItem(bot, "bucket", 1);
  return `${posStr(pos)}: placed ${blockName}`;
}

async function place(bot, args) {
  if (typeof args.item !== "string") fail("place_block needs an item name.");
  const item = short(args.item);
  const results = [];
  for (const pos of positionsFrom(args, 24)) {
    try {
      results.push(await placeOne(bot, item, pos));
    } catch (e) {
      if (!(e instanceof ActionError) || !bot.isValid || results.length === 0) throw e;
      results.push(`${posStr(pos)}: FAILED - ${e.message} (stopped here)`);
      break;
    }
  }
  return results.join("\n");
}

// ---------- buckets and items ----------

async function fillBucket(bot, args) {
  const pos = toPos(args);
  if (countItem(bot, "bucket") < 1) fail("You have no empty bucket.");
  const block = blockAt(bot, pos);
  if (!isLiquidId(block.typeId)) fail(`${posStr(pos)} is ${short(block.typeId)}, not a liquid.`);
  if (!isSource(block)) fail(`${posStr(pos)} is flowing liquid. Only source blocks can be picked up.`);
  await approach(bot, pos);
  const lava = isLavaId(block.typeId);
  blockAt(bot, pos).setType("minecraft:air");
  removeItem(bot, "bucket", 1);
  giveItem(bot, lava ? "lava_bucket" : "water_bucket", 1);
  return `Picked up the ${lava ? "lava" : "water"} source at ${posStr(pos)}.`;
}

const SOIL = ["dirt", "grass_block", "grass_path", "coarse_dirt"];

async function useItem(bot, args) {
  if (typeof args.item !== "string") fail("use_item needs an item name.");
  const item = short(args.item);
  const pos = toPos(args);
  if (countItem(bot, item) < 1) fail(`You have no ${item}.`);
  const block = blockAt(bot, pos);
  const name = short(block.typeId);
  await approach(bot, pos);
  lookAtBlock(bot, pos);
  await sleep(4);

  if (item.endsWith("_hoe")) {
    if (!SOIL.includes(name)) fail(`A hoe only works on dirt or grass, not ${name}.`);
    if (short(typeAt(bot, add(pos, 0, 1, 0))) !== "air") fail("The block above must be empty to till.");
    block.setType("minecraft:farmland");
    const slot = listInventory(bot).find((e) => short(e.id) === item)?.slot;
    if (slot !== undefined) damageTool(bot, slot);
    return `Tilled ${posStr(pos)} into farmland. Farmland dries out unless water is within 4 blocks.`;
  }

  if (item === "bone_meal") {
    if (["wheat", "carrots", "potatoes", "beetroot"].includes(name)) {
      const growth = Number(block.permutation.getState("growth") ?? 0);
      if (growth >= 7) fail("That crop is already fully grown.");
      const next = Math.min(7, growth + randInt(2, 5));
      block.setPermutation(block.permutation.withState("growth", next));
      removeItem(bot, item, 1);
      return `Crop at ${posStr(pos)} grew to ${next}/7.`;
    }
    if (name.endsWith("_sapling")) {
      removeItem(bot, item, 1);
      if (Math.random() < 0.45) {
        const wood = name.replace(/_sapling$/, "");
        block.setType("minecraft:air");
        if (buildTree(bot.dimension, pos, wood, true)) return `The sapling at ${posStr(pos)} grew into a tree!`;
        block.setType("minecraft:" + name);
        return "The sapling could not grow: it needs at least 5 empty blocks above it.";
      }
      return "Used bone meal; the sapling has not grown yet (try again).";
    }
    if (name === "grass_block") {
      removeItem(bot, item, 1);
      let grown = 0;
      for (let i = 0; i < 12 && grown < 5; i++) {
        const p = add(pos, randInt(-2, 2), 0, randInt(-2, 2));
        if (short(typeAt(bot, p)) === "grass_block" && short(typeAt(bot, add(p, 0, 1, 0))) === "air") {
          blockAt(bot, add(p, 0, 1, 0)).setType("minecraft:short_grass");
          grown++;
        }
      }
      return `Grass grew on ${grown} blocks. Mining short_grass sometimes gives wheat_seeds.`;
    }
    fail(`Bone meal does nothing on ${name}.`);
  }
  fail(`use_item does not support ${item}. Supported: any hoe (on dirt/grass), bone_meal (on crops, saplings, grass_block).`);
}

// ---------- chests ----------

async function openContainer(bot, pos) {
  await approach(bot, pos);
  const block = blockAt(bot, pos);
  const inv = block.getComponent("minecraft:inventory")?.container;
  if (!inv) fail(`${posStr(pos)} is ${short(block.typeId)}, which has no inventory.`);
  return inv;
}

function containerText(inv) {
  const totals = new Map();
  for (let i = 0; i < inv.size; i++) {
    const item = inv.getItem(i);
    if (item) totals.set(item.typeId, (totals.get(item.typeId) ?? 0) + item.amount);
  }
  return totals.size ? [...totals].map(([id, n]) => `${short(id)} x${n}`).join(", ") : "empty";
}

async function lookInChest(bot, args) {
  const pos = toPos(args);
  const inv = await openContainer(bot, pos);
  return `Chest at ${posStr(pos)} contains: ${containerText(inv)}.`;
}

async function takeFromChest(bot, args) {
  const pos = toPos(args);
  const inv = await openContainer(bot, pos);
  const want = typeof args.item === "string" && args.item !== "all" ? short(args.item) : undefined;
  let left = want ? Math.max(1, Number(args.count) || 64) : Infinity;
  const taken = new Map();
  for (let i = 0; i < inv.size && left > 0; i++) {
    const item = inv.getItem(i);
    if (!item || (want && short(item.typeId) !== want)) continue;
    const n = Math.min(left, item.amount);
    const moving = item.clone();
    moving.amount = n;
    const overflow = container(bot).addItem(moving);
    const moved = n - (overflow?.amount ?? 0);
    if (moved > 0) {
      taken.set(item.typeId, (taken.get(item.typeId) ?? 0) + moved);
      if (moved === item.amount) {
        inv.setItem(i, undefined);
      } else {
        item.amount -= moved;
        inv.setItem(i, item);
      }
      left -= moved;
    }
    if (overflow) break;
  }
  if (taken.size === 0) fail(want ? `The chest has no ${want}. It contains: ${containerText(inv)}.` : "Nothing was taken (chest empty or your inventory is full).");
  return `Took ${[...taken].map(([id, n]) => `${short(id)} x${n}`).join(", ")}. Chest now contains: ${containerText(inv)}.`;
}

async function putInChest(bot, args) {
  const pos = toPos(args);
  if (typeof args.item !== "string") fail("put_in_chest needs an item name.");
  const item = short(args.item);
  const have = countItem(bot, item);
  if (have < 1) fail(`You have no ${item}.`);
  const inv = await openContainer(bot, pos);
  const want = Math.min(have, Math.max(1, Number(args.count) || have));
  let moved = 0;
  const c = container(bot);
  for (let i = 0; i < c.size && moved < want; i++) {
    const stack = c.getItem(i);
    if (!stack || short(stack.typeId) !== item) continue;
    const n = Math.min(want - moved, stack.amount);
    const moving = stack.clone();
    moving.amount = n;
    const overflow = inv.addItem(moving);
    const done = n - (overflow?.amount ?? 0);
    if (done === stack.amount) {
      c.setItem(i, undefined);
    } else if (done > 0) {
      stack.amount -= done;
      c.setItem(i, stack);
    }
    moved += done;
    if (overflow) break;
  }
  if (moved === 0) fail("The chest is full.");
  return `Put ${item} x${moved} in the chest. Chest now contains: ${containerText(inv)}.`;
}

// ---------- crafting ----------

function nearbyBlock(bot, name) {
  const c = botCell(bot);
  for (let dx = -4; dx <= 4; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dz = -4; dz <= 4; dz++) {
        const p = add(c, dx, dy, dz);
        const s = short(typeAt(bot, p));
        if ((s === name || (name === "furnace" && s === "lit_furnace")) && dist(eyePos(c), center(p)) <= REACH + 0.5) return p;
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
  if (recipe.table && !nearbyBlock(bot, "crafting_table")) {
    fail(`${item} needs a crafting table within reach. Craft a crafting_table (4 planks), place it, and stand next to it.`);
  }
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
  await sleep(6);
  for (const [ingredient, n] of Object.entries(recipe.in)) removeWhere(bot, (id) => matchesIngredient(ingredient, id), n * batches);
  try {
    giveItem(bot, item, recipe.out * batches);
  } catch {
    fail(`"${item}" is not a valid item in this version of Minecraft.`);
  }
  return `Crafted ${item} x${recipe.out * batches}.`;
}

async function smelt(bot, args) {
  if (typeof args.item !== "string") fail("smelt needs an item name.");
  const item = short(args.item);
  const result = smeltResult(item);
  if (!result) fail(`${item} cannot be smelted.`);
  if (!nearbyBlock(bot, "furnace")) fail("Smelting needs a furnace within reach. Craft a furnace (8 cobblestone), place it, and stand next to it.");
  const count = Math.max(1, Math.min(16, Number(args.count) || 1));
  if (countItem(bot, item) < count) fail(`You only have ${countItem(bot, item)} ${item}.`);

  // Choose fuel: prefer what was asked for, otherwise anything burnable that is not the input.
  const fuels = listInventory(bot)
    .filter((e) => fuelValue(e.id) > 0 && short(e.id) !== item && (!args.fuel || short(e.id) === short(String(args.fuel))))
    .sort((a, b) => fuelValue(b.id) - fuelValue(a.id));
  let power = 0;
  const burn = [];
  for (const f of fuels) {
    if (short(f.id) === "lava_bucket" && !args.fuel) continue; // never burn the lava by accident
    let n = 0;
    while (power < count && n < f.amount) {
      power += fuelValue(f.id);
      n++;
    }
    if (n > 0) burn.push({ id: f.id, amount: n });
    if (power >= count) break;
  }
  if (power < count) fail(`Not enough fuel to smelt ${count} ${item}. Fuels: coal/charcoal (8 items each), logs or planks (1.5), sticks or saplings (0.5).`);

  await sleep(Math.min(count * 30, 400));
  for (const b of burn) {
    removeItem(bot, b.id, b.amount);
    if (short(b.id) === "lava_bucket") giveItem(bot, "bucket", b.amount);
  }
  removeItem(bot, item, count);
  giveItem(bot, result, count);
  return `Smelted ${item} x${count} into ${result} x${count}, burning ${burn.map((b) => `${short(b.id)} x${b.amount}`).join(", ")}.`;
}

// ---------- other ----------

async function attack(bot, args) {
  const target = world.getEntity(String(args.id));
  if (!target || !target.isValid) fail("No such entity (it may have died or moved away). Use observe to list entities.");
  if (target.typeId === "minecraft:player" || target.typeId === "minecraft:item") fail("You cannot attack that.");
  const swords = { wooden_sword: 5, golden_sword: 5, stone_sword: 6, iron_sword: 7, diamond_sword: 8, netherite_sword: 9 };
  const best = listInventory(bot).reduce((m, e) => Math.max(m, swords[short(e.id)] ?? 1), 1);
  const hits = Math.max(1, Math.min(12, Number(args.hits) || 6));
  let done = 0;
  for (let i = 0; i < hits; i++) {
    if (!target.isValid) break;
    const t = target.location;
    const cell = { x: Math.floor(t.x), y: Math.floor(t.y), z: Math.floor(t.z) };
    if (dist(eyePos(botCell(bot)), t) > 3.5) {
      await walkTo(bot, (c) => dist(eyePos(c), t) <= 3, cell, "Cannot get close enough to that entity.");
    }
    if (!target.isValid) break;
    target.applyDamage(best);
    done++;
    await sleep(12);
  }
  return target.isValid ? `Hit ${short(target.typeId)} ${done} times; it is still alive.` : `Killed it after ${done} hits. Drops near you are picked up automatically.`;
}

async function wait(bot, args) {
  const seconds = Math.max(1, Math.min(120, Number(args.seconds) || 5));
  await sleep(seconds * 20);
  return `Waited ${seconds} seconds.`;
}

function chat(bot, args) {
  const text = String(args.message ?? "").slice(0, 400);
  if (!text) fail("chat needs a message.");
  world.sendMessage(`§6<${getBotName()}>§r ${text}`);
  return "Message sent.";
}

function drop(bot, args) {
  if (typeof args.item !== "string") fail("drop needs an item name.");
  const item = short(args.item);
  const have = countItem(bot, item);
  if (have < 1) fail(`You have no ${item}.`);
  const n = Math.min(have, Math.max(1, Number(args.count) || 1));
  removeItem(bot, item, n);
  return `Destroyed ${item} x${n}.`;
}

const ACTIONS = {
  observe, move_to: moveTo, mine_block: mine, place_block: place, fill_bucket: fillBucket, use_item: useItem,
  look_in_chest: lookInChest, take_from_chest: takeFromChest, put_in_chest: putInChest, craft, smelt, attack,
  wait, chat, drop,
};

/** Run one action for the AI. Always resolves to { ok, text }. */
export async function runAction(method, args) {
  if (method === "ping") return { ok: true, text: "pong", island: getIsland() ?? null };
  if (method === "config") {
    if (args.name) setBotName(args.name);
    return { ok: true, text: "ok" };
  }
  const handler = ACTIONS[method];
  if (!handler) return { ok: false, text: `Unknown action "${method}".` };
  try {
    const bot = getBot();
    const before = takeNews();
    const text = await handler(bot, args ?? {});
    const news = before.concat(takeNews());
    const live = getBot();
    const tail = method === "observe" ? "" : "\n" + statusLine(live);
    return { ok: true, text: (news.length ? news.join("\n") + "\n" : "") + text + tail };
  } catch (e) {
    const news = takeNews();
    const prefix = news.length ? news.join("\n") + "\n" : "";
    if (e instanceof ActionError) {
      let tail = "";
      try {
        tail = "\n" + statusLine(getBot());
      } catch {
        // no island / bot
      }
      return { ok: false, text: prefix + e.message + tail };
    }
    return { ok: false, text: `${prefix}The action "${method}" was interrupted (${e}).` };
  }
}
