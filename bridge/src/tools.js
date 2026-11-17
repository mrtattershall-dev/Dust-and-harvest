// The actions offered to the AI, in a provider-neutral shape:
// { name, description, parameters (JSON Schema) }.

const xyz = {
  x: { type: "integer", description: "Block x (east is +x)" },
  y: { type: "integer", description: "Block y (up is +y)" },
  z: { type: "integer", description: "Block z (south is +z)" },
};
const positions = {
  type: "array",
  description: "Several block positions as [x,y,z] triples, handled in order (max 24). Use instead of x/y/z to do many blocks in one call.",
  items: { type: "array", items: { type: "integer" }, minItems: 3, maxItems: 3 },
};
const obj = (properties, required = []) => ({ type: "object", properties, required });

export const TOOLS = [
  {
    name: "observe",
    description: "Look around. Returns your position, health, inventory, the island layout, every non-air block near you with exact coordinates, and nearby entities. Call this first, and again whenever you are unsure what the world looks like (after trees grow, liquids flow, or you die).",
    parameters: obj({ radius: { type: "integer", description: "How far to scan, 2-12 blocks. Default 7." } }),
  },
  {
    name: "move_to",
    description: "Walk to stand on the block column at x,z (y is the level your feet should be at, i.e. one above the block you stand on). Pathfinding only uses solid ground: it steps up 1 block and drops down at most 3, and never walks into the void. Most other actions walk into reach automatically, so you rarely need this.",
    parameters: obj(xyz, ["x", "y", "z"]),
  },
  {
    name: "mine_block",
    description: "Break one or more blocks and collect what they drop. Walks into reach (4.5 blocks) automatically. Takes real time depending on the block and your best tool, which is chosen automatically. Stone-type blocks drop nothing without a pickaxe. Mining ice that has a block under it leaves a water source.",
    parameters: obj({ ...xyz, positions }),
  },
  {
    name: "place_block",
    description: "Place an item from your inventory as a block at one or more empty positions. Each position must touch an existing solid block (you can extend sideways from the edge of the island to build bridges). Also used to: pour a water_bucket or lava_bucket (you get the empty bucket back), plant saplings (on dirt/grass), plant seeds (on farmland), sugar_cane (next to water), cactus (on sand), and place chests, torches, crafting_table, furnace.",
    parameters: obj({ item: { type: "string", description: "Item name without namespace, e.g. dirt, cobblestone, oak_sapling, water_bucket" }, ...xyz, positions }, ["item"]),
  },
  {
    name: "fill_bucket",
    description: "Scoop a water or lava SOURCE block into an empty bucket.",
    parameters: obj(xyz, ["x", "y", "z"]),
  },
  {
    name: "use_item",
    description: "Use an item on a block: a hoe on dirt/grass makes farmland; bone_meal on a crop advances growth, on a sapling may grow it into a tree at once, on a grass_block grows short grass (mine it for wheat_seeds).",
    parameters: obj({ item: { type: "string" }, ...xyz }, ["item", "x", "y", "z"]),
  },
  {
    name: "look_in_chest",
    description: "List the contents of a chest (or other container block).",
    parameters: obj(xyz, ["x", "y", "z"]),
  },
  {
    name: "take_from_chest",
    description: "Take items out of a chest. Omit item (or use \"all\") to take everything.",
    parameters: obj({ ...xyz, item: { type: "string" }, count: { type: "integer" } }, ["x", "y", "z"]),
  },
  {
    name: "put_in_chest",
    description: "Store items from your inventory in a chest. Omit count to store all of that item.",
    parameters: obj({ ...xyz, item: { type: "string" }, count: { type: "integer" } }, ["x", "y", "z", "item"]),
  },
  {
    name: "craft",
    description: "Craft an item from your inventory using normal Minecraft recipes. Small recipes (planks, sticks, crafting_table, torch) work anywhere; everything else needs a placed crafting_table within reach. count is how many items you want. Name the wood for planks (oak_planks).",
    parameters: obj({ item: { type: "string" }, count: { type: "integer", description: "Default 1" } }, ["item"]),
  },
  {
    name: "smelt",
    description: "Smelt items in a furnace that is placed within reach (cobblestone->stone, sand->glass, any log->charcoal, raw_iron->iron_ingot, food). Fuel is taken from your inventory automatically (coal, charcoal, planks, logs, sticks) unless you name one.",
    parameters: obj({ item: { type: "string" }, count: { type: "integer" }, fuel: { type: "string" } }, ["item"]),
  },
  {
    name: "attack",
    description: "Attack a mob by its id from observe (uses your best sword). Its drops are picked up automatically.",
    parameters: obj({ id: { type: "string" }, hits: { type: "integer", description: "Max hits, default 6" } }, ["id"]),
  },
  {
    name: "wait",
    description: "Do nothing for some seconds (max 120). Use while saplings or crops grow, or while leaves decay and drop saplings. Items that land near you are picked up automatically.",
    parameters: obj({ seconds: { type: "integer" } }, ["seconds"]),
  },
  {
    name: "chat",
    description: "Say something to the human player in the game chat. Keep it short. Use it to answer them or to mention milestones, not for every step.",
    parameters: obj({ message: { type: "string" } }, ["message"]),
  },
  {
    name: "drop",
    description: "Throw away items you do not need (they are destroyed).",
    parameters: obj({ item: { type: "string" }, count: { type: "integer" } }, ["item"]),
  },
  {
    name: "set_notes",
    description: "Save your private notes: the plan, key coordinates (generator, farms, chests), and what is done. Your conversation memory is cleared from time to time and ONLY these notes survive, so keep them current. Replaces the previous notes.",
    parameters: obj({ notes: { type: "string" } }, ["notes"]),
  },
];
