// Builds the classic Skyblock start: an L-shaped dirt island with one tree
// and a chest, plus a small sand island further away. Also turns a Flat
// world into a void by removing the ground around players.
import { world, system, BlockPermutation } from "@minecraft/server";
import { makeStack } from "./blocks.js";
import { getProp, overworld, setProp, short, sleep } from "./util.js";

function set(dim, x, y, z, type) {
  dim.setBlockType({ x, y, z }, "minecraft:" + type);
}

/** A simple oak-style tree. `base` is the position of the lowest log. */
export function buildTree(dim, base, wood = "oak", onlyIfAir = false) {
  const height = wood === "birch" ? 6 : 5;
  const leaves = [];
  for (let dy = height - 3; dy <= height; dy++) {
    const radius = dy >= height - 1 ? 1 : 2;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
        if (corner && (dy === height || radius === 2)) continue;
        if (dx === 0 && dz === 0 && dy < height) continue;
        leaves.push({ x: base.x + dx, y: base.y + dy, z: base.z + dz });
      }
    }
  }
  if (onlyIfAir) {
    for (let dy = 1; dy < height; dy++) {
      const b = dim.getBlock({ x: base.x, y: base.y + dy, z: base.z });
      if (!b || !b.isAir) return false;
    }
  }
  let leafPerm;
  try {
    leafPerm = BlockPermutation.resolve(`minecraft:${wood}_leaves`);
  } catch {
    leafPerm = BlockPermutation.resolve("minecraft:oak_leaves");
  }
  for (const p of leaves) {
    const b = dim.getBlock(p);
    if (b && b.isAir) b.setPermutation(leafPerm);
  }
  for (let dy = 0; dy < height; dy++) set(dim, base.x, base.y + dy, base.z, `${wood}_log`);
  return true;
}

function fillChest(dim, pos, items) {
  dim.setBlockType(pos, "minecraft:chest");
  const chest = dim.getBlock(pos)?.getComponent("minecraft:inventory")?.container;
  if (!chest) return;
  for (const [id, amount] of items) chest.addItem(makeStack(id, amount));
}

/** True if this looks like a default Flat world at the given column. */
export function looksFlat(dim, x, z) {
  try {
    const grass = dim.getBlock({ x, y: -61, z });
    const bedrock = dim.getBlock({ x, y: -64, z });
    const above = dim.getBlock({ x, y: -60, z });
    return !!grass && !!bedrock && !!above && short(grass.typeId) === "grass_block" && short(bedrock.typeId) === "bedrock" && above.isAir;
  } catch {
    return false;
  }
}

/**
 * Create the islands near a player. The origin is the north-west top corner
 * of the main island; the top (grass) layer is at origin.y.
 */
export async function createIsland(player) {
  const dim = overworld();
  const px = Math.floor(player.location.x);
  const pz = Math.floor(player.location.z);
  const flat = looksFlat(dim, px, pz);
  const origin = { x: px - 2, y: flat ? 64 : 200, z: pz - 2 };
  const { x: ox, y: oy, z: oz } = origin;

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
  buildTree(dim, { x: ox + 1, y: oy + 1, z: oz + 4 });
  const chest = { x: ox + 5, y: oy + 1, z: oz + 1 };
  fillChest(dim, chest, [["lava_bucket", 1], ["ice", 2]]);

  const spawn = { x: ox + 2, y: oy + 1, z: oz + 1 };
  const island = { origin, spawn, chest, tree: { x: ox + 1, y: oy + 1, z: oz + 4 }, sand: { x: ox - 64, y: oy, z: oz }, flat };
  setProp("skyai:island", island);
  setProp("skyai:void", flat);

  try {
    dim.runCommand(`tickingarea remove skyai_home`);
  } catch {
    // none yet
  }
  try {
    dim.runCommand(`tickingarea add circle ${ox + 2} ${oy} ${oz + 2} 2 skyai_home`);
  } catch {
    // the island still works while the player is nearby
  }
  try {
    dim.runCommand(`setworldspawn ${spawn.x} ${spawn.y} ${spawn.z}`);
  } catch {
    // not critical
  }
  player.teleport({ x: spawn.x + 0.5, y: spawn.y, z: spawn.z + 0.5 });
  try {
    player.setSpawnPoint({ dimension: dim, x: spawn.x, y: spawn.y, z: spawn.z });
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
  // Wait for the area to load.
  for (let i = 0; i < 60; i++) {
    let loaded = false;
    try {
      loaded = dim.getBlock({ x: at.x, y: at.y, z: at.z }) !== undefined;
    } catch {
      loaded = false;
    }
    if (loaded) break;
    await sleep(10);
  }
  try {
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
  } catch {
    world.sendMessage("§eSkyAI: could not build the sand island (area not loaded).");
  }
  try {
    dim.runCommand(`tickingarea remove skyai_sand`);
  } catch {
    // fine
  }
}

/**
 * In a Flat world, remove the 4 ground layers in chunks near players so that
 * falling off the island really means falling into the void.
 */
export function startVoidJob() {
  system.runInterval(() => {
    if (!getProp("skyai:void", false)) return;
    const dim = overworld();
    let budget = 6;
    for (const player of world.getAllPlayers()) {
      if (player.dimension.id !== "minecraft:overworld") continue;
      const cx = Math.floor(player.location.x / 16);
      const cz = Math.floor(player.location.z / 16);
      for (let r = 0; r <= 5 && budget > 0; r++) {
        for (let dx = -r; dx <= r && budget > 0; dx++) {
          for (let dz = -r; dz <= r && budget > 0; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const x0 = (cx + dx) * 16;
            const z0 = (cz + dz) * 16;
            try {
              const probe = dim.getBlock({ x: x0, y: -64, z: z0 });
              if (!probe || probe.isAir) continue;
              dim.runCommand(`fill ${x0} -64 ${z0} ${x0 + 15} -61 ${z0 + 15} air`);
              budget--;
            } catch {
              // chunk not loaded yet; try again later
            }
          }
        }
      }
    }
  }, 20);
}
