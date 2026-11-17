// Crafting and smelting knowledge. Ingredients may be an item id or a group
// starting with "#" (any item in that group counts).
import { short } from "./util.js";

const WOODS = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "pale_oak"];

export function inGroup(group, id) {
  const s = short(id);
  switch (group) {
    case "#planks": return s.endsWith("_planks");
    case "#logs": return /_(log|wood|stem|hyphae)$/.test(s);
    case "#wooden_slabs": return WOODS.some((w) => s === `${w}_slab`);
    case "#stone": return ["cobblestone", "cobbled_deepslate", "blackstone"].includes(s);
    case "#coal": return s === "coal" || s === "charcoal";
    case "#wool": return s.endsWith("_wool");
    default: return s === group;
  }
}

// name -> { out: amount, in: {ingredient: amount}, table: needs crafting table }
const R = {
  stick: { out: 4, in: { "#planks": 2 } },
  crafting_table: { out: 1, in: { "#planks": 4 } },
  chest: { out: 1, in: { "#planks": 8 }, table: true },
  barrel: { out: 1, in: { "#planks": 6, "#wooden_slabs": 2 }, table: true },
  furnace: { out: 1, in: { "#stone": 8 }, table: true },
  torch: { out: 4, in: { "#coal": 1, stick: 1 } },
  ladder: { out: 3, in: { stick: 7 }, table: true },
  bowl: { out: 4, in: { "#planks": 3 }, table: true },
  mushroom_stew: { out: 1, in: { bowl: 1, red_mushroom: 1, brown_mushroom: 1 } },
  bread: { out: 1, in: { wheat: 3 }, table: true },
  bone_meal: { out: 3, in: { bone: 1 } },
  sugar: { out: 1, in: { sugar_cane: 1 } },
  paper: { out: 3, in: { sugar_cane: 3 }, table: true },
  book: { out: 1, in: { paper: 3, leather: 1 } },
  melon_seeds: { out: 1, in: { melon_slice: 1 } },
  pumpkin_seeds: { out: 4, in: { pumpkin: 1 } },
  melon_block: { out: 1, in: { melon_slice: 9 }, table: true },
  sandstone: { out: 1, in: { sand: 4 } },
  stone_bricks: { out: 4, in: { stone: 4 } },
  cobblestone_slab: { out: 6, in: { cobblestone: 3 }, table: true },
  cobblestone_stairs: { out: 4, in: { cobblestone: 6 }, table: true },
  cobblestone_wall: { out: 6, in: { cobblestone: 6 }, table: true },
  stone_slab: { out: 6, in: { stone: 3 }, table: true },
  bucket: { out: 1, in: { iron_ingot: 3 }, table: true },
  shears: { out: 1, in: { iron_ingot: 2 } },
  flint_and_steel: { out: 1, in: { iron_ingot: 1, flint: 1 } },
  iron_ingot: { out: 9, in: { iron_block: 1 } },
  iron_block: { out: 1, in: { iron_ingot: 9 }, table: true },
  fishing_rod: { out: 1, in: { stick: 3, string: 2 }, table: true },
  bow: { out: 1, in: { stick: 3, string: 3 }, table: true },
  arrow: { out: 4, in: { flint: 1, stick: 1, feather: 1 }, table: true },
  white_wool: { out: 1, in: { string: 4 } },
  bed: { out: 1, in: { "#wool": 3, "#planks": 3 }, table: true },
  composter: { out: 1, in: { "#wooden_slabs": 7 }, table: true },
  hopper: { out: 1, in: { iron_ingot: 5, chest: 1 }, table: true },
  glass_pane: { out: 16, in: { glass: 6 }, table: true },
  glass_bottle: { out: 3, in: { glass: 3 }, table: true },
  green_dye: { out: 1, in: { cactus: 1 } },
  jack_o_lantern: { out: 1, in: { carved_pumpkin: 1, torch: 1 } },
  campfire: { out: 1, in: { stick: 3, "#coal": 1, "#logs": 3 }, table: true },
  stonecutter_block: { out: 1, in: { iron_ingot: 1, stone: 3 }, table: true },
};

for (const [material, ingredient] of [["wooden", "#planks"], ["stone", "#stone"], ["iron", "iron_ingot"], ["golden", "gold_ingot"], ["diamond", "diamond"]]) {
  R[`${material}_pickaxe`] = { out: 1, in: { [ingredient]: 3, stick: 2 }, table: true };
  R[`${material}_axe`] = { out: 1, in: { [ingredient]: 3, stick: 2 }, table: true };
  R[`${material}_shovel`] = { out: 1, in: { [ingredient]: 1, stick: 2 }, table: true };
  R[`${material}_hoe`] = { out: 1, in: { [ingredient]: 2, stick: 2 }, table: true };
  R[`${material}_sword`] = { out: 1, in: { [ingredient]: 2, stick: 1 }, table: true };
}

for (const wood of WOODS) {
  const planks = `${wood}_planks`;
  R[planks] = { out: 4, in: { [`#${wood}_logs`]: 1 } };
  R[`${wood}_slab`] = { out: 6, in: { [planks]: 3 }, table: true };
  R[`${wood}_stairs`] = { out: 4, in: { [planks]: 6 }, table: true };
  R[`${wood}_fence`] = { out: 3, in: { [planks]: 4, stick: 2 }, table: true };
  // Oak versions of these keep their old, un-prefixed Bedrock names.
  const oak = wood === "oak";
  R[oak ? "fence_gate" : `${wood}_fence_gate`] = { out: 1, in: { [planks]: 2, stick: 4 }, table: true };
  R[oak ? "trapdoor" : `${wood}_trapdoor`] = { out: 2, in: { [planks]: 6 }, table: true };
  R[oak ? "wooden_pressure_plate" : `${wood}_pressure_plate`] = { out: 1, in: { [planks]: 2 } };
  R[oak ? "wooden_button" : `${wood}_button`] = { out: 1, in: { [planks]: 1 } };
  R[wood === "oak" ? "wooden_door" : `${wood}_door`] = { out: 3, in: { [planks]: 6 }, table: true };
  R[`${wood}_sign`] = { out: 3, in: { [planks]: 6, stick: 1 }, table: true };
}

/** Does item id satisfy an ingredient name? Handles "#oak_logs"-style groups. */
export function matchesIngredient(ingredient, id) {
  const s = short(id);
  const woodLogs = /^#(.+)_logs$/.exec(ingredient);
  if (woodLogs) {
    const w = woodLogs[1];
    return [`${w}_log`, `${w}_wood`, `stripped_${w}_log`, `stripped_${w}_wood`].includes(s);
  }
  return ingredient.startsWith("#") ? inGroup(ingredient, id) : s === ingredient;
}

export function getRecipe(item) {
  const s = short(item);
  if (s === "planks") return undefined;
  return R[s];
}

export function describeIngredients(recipe) {
  return Object.entries(recipe.in)
    .map(([k, n]) => `${n} ${k.startsWith("#") ? "any " + k.slice(1).replace(/_/g, " ") : k}`)
    .join(" + ");
}

export const recipeNames = () => Object.keys(R);

// Smelting: input -> output
const SMELT = {
  cobblestone: "stone", stone: "smooth_stone", sand: "glass", red_sand: "glass", raw_iron: "iron_ingot",
  raw_gold: "gold_ingot", raw_copper: "copper_ingot", iron_ore: "iron_ingot", gold_ore: "gold_ingot",
  clay_ball: "brick", cactus: "green_dye", potato: "baked_potato", beef: "cooked_beef", porkchop: "cooked_porkchop",
  chicken: "cooked_chicken", mutton: "cooked_mutton", rabbit: "cooked_rabbit", cod: "cooked_cod",
  salmon: "cooked_salmon", kelp: "dried_kelp", netherrack: "netherbrick", wet_sponge: "sponge",
  cobbled_deepslate: "deepslate", sandstone: "smooth_sandstone", stone_bricks: "cracked_stone_bricks",
};

export function smeltResult(id) {
  const s = short(id);
  if (inGroup("#logs", s)) return "charcoal";
  return SMELT[s];
}

/** How many items one piece of this fuel smelts (0 = not a fuel). */
export function fuelValue(id) {
  const s = short(id);
  if (s === "lava_bucket") return 100;
  if (s === "coal_block") return 80;
  if (s === "coal" || s === "charcoal") return 8;
  if (inGroup("#logs", s) || s.endsWith("_planks") || s === "crafting_table" || s === "chest" || s === "ladder") return 1.5;
  if (s.endsWith("_slab") && inGroup("#wooden_slabs", s)) return 0.75;
  if (s.startsWith("wooden_")) return 1;
  if (s === "stick" || s.endsWith("_sapling") || s === "bowl") return 0.5;
  return 0;
}
