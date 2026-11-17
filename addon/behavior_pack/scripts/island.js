// Builds the classic Skyblock start: an L-shaped dirt island with one tree
// and a chest, plus a small sand island further away.
//
// Two starter kits:
//   "milestone" - a working cobblestone generator is already built and the
//                 chest holds a stone pickaxe (for the first prototype test).
//   "classic"   - the original start: the chest holds a lava bucket and ice.
import { BlockPermutation } from "@minecraft/server";
import { makeStack } from "./blocks.js";
import { overworld, setProp, sleep } from "./util.js";

function set(dim, x, y, z, type) {
  dim.setBlockType({ x, y, z }, "minecraft:" + type);
}

/** A simple oak tree. `base` is the position of the lowest log. */
export function buildTree(dim, base, wood = "oak") {
  const height = 5;
  const leaves = BlockPermutation.resolve(`minecraft:${wood}_leaves`);
  for (let dy = height - 3; dy <= height; dy++) {
    const radius = dy >= height - 1 ? 1 : 2;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
        if (corner && (dy === height || radius === 2)) continue;
        if (dx === 0 && dz === 0 && dy < height) continue;
        const b = dim.getBlock({ x: base.x + dx, y: base.y + dy, z: base.z + dz });
        if (b && b.isAir) b.setPermutation(leaves);
      }
    }
  }
  for (let dy = 0; dy < height; dy++) set(dim, base.x, base.y + dy, base.z, `${wood}_log`);
}

function fillChest(dim, pos, items) {
  dim.setBlockType(pos, "minecraft:chest");
  const chest = dim.getBlock(pos)?.getComponent("minecraft:inventory")?.container;
  if (!chest) return;
  for (const [id, amount] of items) chest.addItem(makeStack(id, amount));
}

async function waitForChunk(dim, pos) {
  for (let i = 0; i < 200; i++) {
    try {
      if (dim.getBlock(pos)) return true;
    } catch {
      // not loaded yet
    }
    await sleep(5);
  }
  return false;
}

/** Create the islands. The top (grass) layer of the main island is at y=64. */
export async function createIsland(kit) {
  const dim = overworld();
  const origin = { x: 0, y: 64, z: 0 };
  const { x: ox, y: oy, z: oz } = origin;
  try {
    dim.runCommand(`tickingarea add circle ${ox + 2} ${oy} ${oz + 2} 3 skyai_home`);
  } catch {
    // already exists
  }
  if (!(await waitForChunk(dim, origin))) throw new Error("the island area did not load");

  // Main island: an L made of three 3x3 squares, 3 blocks thick.
  for (let dx = 0; dx < 6; dx++) {
    for (let dz = 0; dz < 6; dz++) {
      if (dx >= 3 && dz >= 3) continue;
      set(dim, ox + dx, oy, oz + dz, "grass_block");
      set(dim, ox + dx, oy - 1, oz + dz, "dirt");
      set(dim, ox + dx, oy - 2, oz + dz, "dirt");
    }
  }
  set(dim, ox + 1, oy - 2, oz + 1, "bedrock");
  const tree = { x: ox + 1, y: oy + 1, z: oz + 4 };
  buildTree(dim, tree);
  const chest = { x: ox + 5, y: oy + 1, z: oz + 1 };
  const spawn = { x: ox + 2, y: oy + 1, z: oz + 2 };
  const island = { origin, spawn, chest, tree, sand: { x: ox - 64, y: oy, z: oz }, kit };

  if (kit === "classic") {
    fillChest(dim, chest, [["lava_bucket", 1], ["ice", 2]]);
  } else {
    // A trench of four cells in a row: water, a deeper hole the water falls
    // into, the cell where cobblestone forms, and lava.
    const z = oz + 1;
    const water = { x: ox + 1, y: oy, z };
    const hole = { x: ox + 2, y: oy, z };
    const cobble = { x: ox + 3, y: oy, z };
    const lava = { x: ox + 4, y: oy, z };
    for (const p of [water, hole, cobble, lava]) set(dim, p.x, p.y, p.z, "air");
    set(dim, hole.x, hole.y - 1, hole.z, "air");
    // Placed with commands so the liquids start flowing (a scripted block change alone leaves them frozen).
    dim.runCommand(`setblock ${water.x} ${water.y} ${water.z} flowing_water`);
    await sleep(40); // let the water settle into the hole before adding lava
    dim.runCommand(`setblock ${lava.x} ${lava.y} ${lava.z} flowing_lava`);
    // A notch beside the cobblestone cell, at the same level, to stand in while
    // mining: from there the drops are within pick-up range.
    const stand = { x: cobble.x, y: oy, z: z + 1 };
    set(dim, stand.x, stand.y, stand.z, "air");
    island.generator = { water, hole, cobble, lava, stand };
    fillChest(dim, chest, [["stone_pickaxe", 1], ["ice", 1]]);
  }

  setProp("skyai:island", island);
  try {
    dim.runCommand(`setworldspawn ${spawn.x} ${spawn.y} ${spawn.z}`);
    dim.runCommand(`gamerule spawnradius 0`);
  } catch {
    // not critical
  }
  buildSandIsland(island.sand).catch(() => {});
  return island;
}

/** The second island: sand with a cactus and a chest of rare starting items. */
async function buildSandIsland(at) {
  const dim = overworld();
  try {
    dim.runCommand(`tickingarea add circle ${at.x + 1} ${at.y} ${at.z + 1} 1 skyai_sand`);
  } catch {
    // may already exist
  }
  if (await waitForChunk(dim, at)) {
    for (let dx = 0; dx < 3; dx++) {
      for (let dz = 0; dz < 3; dz++) {
        // Sandstone underneath so the sand does not fall into the void.
        set(dim, at.x + dx, at.y - 2, at.z + dz, "sandstone");
        set(dim, at.x + dx, at.y - 1, at.z + dz, "sand");
        set(dim, at.x + dx, at.y, at.z + dz, "sand");
      }
    }
    set(dim, at.x, at.y + 1, at.z, "cactus");
    fillChest(dim, { x: at.x + 2, y: at.y + 1, z: at.z + 2 }, [
      ["obsidian", 10], ["melon_slice", 1], ["pumpkin_seeds", 1], ["sugar_cane", 1], ["red_mushroom", 1], ["brown_mushroom", 1],
    ]);
  }
  try {
    dim.runCommand(`tickingarea remove skyai_sand`);
  } catch {
    // fine
  }
}
