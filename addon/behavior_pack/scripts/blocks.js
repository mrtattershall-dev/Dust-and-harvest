// Knowledge about blocks: what can be walked through, how long things take
// to mine, which tool is needed, and what they drop.
import { ItemStack } from "@minecraft/server";
import { short, randInt } from "./util.js";

const PASSABLE = new Set([
  "short_grass", "tall_grass", "fern", "large_fern", "deadbush", "torch", "redstone_torch", "soul_torch",
  "wheat", "carrots", "potatoes", "beetroot", "melon_stem", "pumpkin_stem", "reeds", "sugar_cane",
  "brown_mushroom", "red_mushroom", "dandelion", "poppy", "snow_layer", "ladder", "vine", "rail",
  "redstone_wire", "trip_wire", "lever", "sweet_berry_bush", "nether_wart", "bamboo_sapling", "fire",
  "water", "flowing_water", "light_block", "structure_void",
]);

export function isLiquidId(id) {
  const s = short(id);
  return s === "water" || s === "flowing_water" || s === "lava" || s === "flowing_lava";
}
export const isLavaId = (id) => short(id).endsWith("lava");
export const isWaterId = (id) => short(id).endsWith("water");

export function isPassableId(id) {
  const s = short(id);
  if (s === "air") return true;
  if (PASSABLE.has(s)) return true;
  return (
    s.endsWith("_sapling") || s.endsWith("_sign") || s.endsWith("_button") || s.endsWith("_carpet") ||
    s.endsWith("_pressure_plate") || s.endsWith("_tulip") || s.endsWith("_door") || s.endsWith("_fence_gate")
  );
}

/** Blocks that a newly placed block may overwrite. */
export function isReplaceableId(id) {
  const s = short(id);
  return s === "air" || isLiquidId(id) || ["short_grass", "tall_grass", "fern", "large_fern", "deadbush", "snow_layer", "fire", "vine"].includes(s);
}

/** Solid enough to stand on. */
export function isStandableId(id) {
  const s = short(id);
  if (s === "air" || isLiquidId(id)) return false;
  if (s === "cactus" || s === "magma" || s === "campfire" || s === "sweet_berry_bush") return false;
  if (s === "farmland" || s.endsWith("_slab") || s.endsWith("_stairs") || s === "chest" || s.endsWith("leaves")) return true;
  return !isPassableId(id);
}

/** True for a liquid source block (not flowing). */
export function isSource(block) {
  if (!isLiquidId(block.typeId)) return false;
  try {
    return block.permutation.getState("liquid_depth") === 0;
  } catch {
    return true;
  }
}

const UNBREAKABLE = new Set(["bedrock", "barrier", "command_block", "end_portal_frame", "end_portal", "portal", "structure_block", "border_block", "deny", "allow"]);
export const isUnbreakable = (id) => UNBREAKABLE.has(short(id));

const TIERS = ["wooden", "stone", "iron", "diamond", "netherite", "golden"];
const TIER_LEVEL = { wooden: 1, golden: 1, stone: 2, iron: 3, diamond: 4, netherite: 5 };
const TIER_SPEED = { wooden: 2, stone: 4, iron: 6, diamond: 8, netherite: 9, golden: 12 };

/** { tool: "pickaxe"|"axe"|"shovel"|"shears"|null, hardness, needLevel } */
function miningProfile(id) {
  const s = short(id);
  if (s === "obsidian" || s === "crying_obsidian") return { tool: "pickaxe", hardness: 50, needLevel: 4 };
  if (s === "ice" || s === "packed_ice") return { tool: "pickaxe", hardness: 0.5, needLevel: 0 };
  if (/(diamond|gold|redstone|emerald)_ore|diamond_block|gold_block|emerald_block/.test(s)) return { tool: "pickaxe", hardness: 3, needLevel: 3 };
  if (/iron_ore|lapis_ore|copper_ore|iron_block|raw_iron_block|lapis_block/.test(s)) return { tool: "pickaxe", hardness: 3, needLevel: 2 };
  if (/sandstone|netherrack|terracotta/.test(s)) return { tool: "pickaxe", hardness: 0.8, needLevel: 1 };
  if (/furnace|smoker|dispenser|dropper|hopper|cauldron|anvil|stonecutter|brewing|lantern|iron_|observer|piston/.test(s)) return { tool: "pickaxe", hardness: 3.5, needLevel: 1 };
  if (/stone|cobble|_ore|brick|andesite|diorite|granite|deepslate|concrete$|basalt|blackstone|prismarine|quartz|purpur|tuff|calcite|dripstone/.test(s)) return { tool: "pickaxe", hardness: 2, needLevel: 1 };
  if (/leaves/.test(s)) return { tool: "shears", hardness: 0.2, needLevel: 0 };
  if (s === "web") return { tool: "shears", hardness: 4, needLevel: 0 };
  if (/wool/.test(s)) return { tool: "shears", hardness: 0.8, needLevel: 0 };
  if (/chest|crafting_table|barrel|bookshelf|composter|lectern|loom|jukebox|noteblock|beehive/.test(s)) return { tool: "axe", hardness: 2.5, needLevel: 0 };
  if (/_log|_wood|_stem$|_hyphae|planks|wooden|_fence|_door|_sign|trapdoor|ladder|pumpkin|melon_block|bamboo|campfire|_slab|_stairs|mushroom_block/.test(s)) return { tool: "axe", hardness: 2, needLevel: 0 };
  if (/dirt|grass_block|grass_path|farmland|podzol|mycelium|^sand$|red_sand|gravel|clay$|snow|soul_s|mud$|concrete_powder/.test(s)) return { tool: "shovel", hardness: 0.6, needLevel: 0 };
  if (isPassableId(id) || /mushroom$|flower|lily|cocoa/.test(s)) return { tool: null, hardness: 0, needLevel: 0 };
  if (s === "cactus") return { tool: null, hardness: 0.4, needLevel: 0 };
  if (/glass/.test(s)) return { tool: null, hardness: 0.3, needLevel: 0 };
  if (s === "bed") return { tool: null, hardness: 0.2, needLevel: 0 };
  return { tool: null, hardness: 1, needLevel: 0 };
}

/** Find the best tool of a kind in a list of {slot, id} inventory entries. */
function bestTool(kind, inventory) {
  let best;
  for (const entry of inventory) {
    const s = short(entry.id);
    if (kind === "shears") {
      if (s === "shears") return { slot: entry.slot, tier: "iron", id: s };
      continue;
    }
    for (const tier of TIERS) {
      if (s === `${tier}_${kind}` && (!best || TIER_SPEED[tier] > TIER_SPEED[best.tier])) {
        best = { slot: entry.slot, tier, id: s };
      }
    }
  }
  return best;
}

/**
 * Work out how mining a block will go with the given inventory.
 * Returns { seconds, drops, toolSlot, toolId, note }.
 */
export function miningPlan(id, inventory) {
  const profile = miningProfile(id);
  const tool = profile.tool ? bestTool(profile.tool, inventory) : undefined;
  let speed = 1;
  let drops = true;
  let note = "";
  if (tool) speed = profile.tool === "shears" ? 5 : TIER_SPEED[tool.tier];
  if (profile.needLevel > 0) {
    const level = tool ? TIER_LEVEL[tool.tier] : 0;
    if (level < profile.needLevel) {
      drops = false;
      speed = 1;
      const needed = Object.keys(TIER_LEVEL).find((t) => TIER_LEVEL[t] === profile.needLevel);
      note = `needs a ${needed} ${profile.tool} or better to drop anything`;
    }
  }
  const seconds = profile.hardness === 0 ? 0.05 : (profile.hardness * (drops ? 1.5 : 5)) / speed;
  return { seconds, drops, toolSlot: tool?.slot, toolId: tool?.id, note };
}

function stack(id, amount = 1) {
  return amount > 0 ? [{ id, amount }] : [];
}

/**
 * What a block drops when mined, as a list of {id, amount} (short ids), or
 * undefined to mean "the block itself".
 */
export function specialDrops(block, usedShears) {
  const s = short(block.typeId);
  const state = (name) => {
    try {
      return block.permutation.getState(name);
    } catch {
      return undefined;
    }
  };
  if (s.endsWith("leaves")) {
    if (usedShears) return undefined;
    const out = [];
    const wood = s.replace(/_leaves$/, "");
    const sapling = wood === "azalea" || wood === "mangrove" ? null : `${wood}_sapling`;
    if (sapling && Math.random() < (wood === "jungle" ? 0.025 : 0.05)) out.push({ id: sapling, amount: 1 });
    if (Math.random() < 0.02) out.push({ id: "stick", amount: randInt(1, 2) });
    if ((wood === "oak" || wood === "dark_oak") && Math.random() < 0.005) out.push({ id: "apple", amount: 1 });
    return out;
  }
  switch (s) {
    case "stone": return stack("cobblestone");
    case "grass_block": case "farmland": case "grass_path": case "podzol": case "mycelium": return stack("dirt");
    case "gravel": return stack(Math.random() < 0.1 ? "flint" : "gravel");
    case "glass": case "glass_pane": case "ice": case "packed_ice": case "fire": case "bookshelf": case "web":
      return s === "bookshelf" ? stack("book", 3) : s === "web" ? stack("string") : [];
    case "short_grass": case "tall_grass": case "fern": case "large_fern":
      return usedShears ? undefined : Math.random() < 0.125 ? stack("wheat_seeds") : [];
    case "deadbush": return stack("stick", randInt(0, 2));
    case "wheat": return state("growth") === 7 ? [{ id: "wheat", amount: 1 }, { id: "wheat_seeds", amount: randInt(1, 3) }] : stack("wheat_seeds");
    case "carrots": return stack("carrot", state("growth") === 7 ? randInt(2, 4) : 1);
    case "potatoes": return stack("potato", state("growth") === 7 ? randInt(2, 4) : 1);
    case "beetroot": return state("growth") === 7 ? [{ id: "beetroot", amount: 1 }, { id: "beetroot_seeds", amount: randInt(1, 3) }] : stack("beetroot_seeds");
    case "melon_block": return stack("melon_slice", randInt(3, 7));
    case "melon_stem": return stack("melon_seeds", Math.random() < 0.5 ? 1 : 0);
    case "pumpkin_stem": return stack("pumpkin_seeds", Math.random() < 0.5 ? 1 : 0);
    case "reeds": return stack("sugar_cane");
    case "coal_ore": return stack("coal");
    case "iron_ore": return stack("raw_iron");
    case "copper_ore": return stack("raw_copper", randInt(2, 5));
    case "gold_ore": return stack("raw_gold");
    case "diamond_ore": return stack("diamond");
    case "emerald_ore": return stack("emerald");
    case "lapis_ore": return stack("lapis_lazuli", randInt(4, 9));
    case "redstone_ore": case "lit_redstone_ore": return stack("redstone", randInt(4, 5));
    case "clay": return stack("clay_ball", 4);
    case "snow": return stack("snowball", 4);
    case "glowstone": return stack("glowstone_dust", randInt(2, 4));
    case "sweet_berry_bush": return stack("sweet_berries", randInt(1, 3));
    case "lit_furnace": return stack("furnace");
    case "redstone_wire": return stack("redstone");
    case "trip_wire": return stack("string");
    case "cocoa": return stack("cocoa_beans", state("age") === 2 ? 3 : 1);
    case "nether_wart": return stack("nether_wart", state("age") === 3 ? randInt(2, 4) : 1);
    default: return undefined;
  }
}

/** Item id -> block id, for items whose placed block has a different name. */
const ITEM_TO_BLOCK = {
  wheat_seeds: "wheat", melon_seeds: "melon_stem", pumpkin_seeds: "pumpkin_stem", beetroot_seeds: "beetroot",
  carrot: "carrots", potato: "potatoes", sugar_cane: "reeds", string: "trip_wire", redstone: "redstone_wire",
  water_bucket: "water", lava_bucket: "lava", sweet_berries: "sweet_berry_bush", cocoa_beans: "cocoa",
};
export const blockForItem = (itemId) => ITEM_TO_BLOCK[short(itemId)] ?? short(itemId);

/** Check the ground under a plant. Returns an error string or "". */
export function plantRuleError(blockId, belowId) {
  const b = short(blockId);
  const below = short(belowId);
  const soil = ["dirt", "grass_block", "podzol", "farmland", "coarse_dirt", "mycelium", "moss_block", "mud"];
  if (b.endsWith("_sapling") && !soil.includes(below)) return "saplings must be planted on dirt or grass";
  if (["wheat", "carrots", "potatoes", "beetroot", "melon_stem", "pumpkin_stem"].includes(b) && below !== "farmland") {
    return "seeds must be planted on farmland (use a hoe on dirt first)";
  }
  if (b === "reeds" && !["dirt", "grass_block", "sand", "red_sand", "podzol", "reeds", "mud"].includes(below)) return "sugar cane needs dirt/grass/sand below, next to water";
  if (b === "cactus" && !["sand", "red_sand", "cactus"].includes(below)) return "cactus must be planted on sand";
  if ((b === "red_mushroom" || b === "brown_mushroom") && (below === "air" || isLiquidId(belowId))) return "mushrooms need a solid block below";
  return "";
}

export function makeStack(id, amount) {
  return new ItemStack(id.includes(":") ? id : "minecraft:" + id, amount);
}
