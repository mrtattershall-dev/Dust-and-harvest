// The actions offered to the AI model, in a provider-neutral shape.
// Each one is carried out by the add-on with the AI's real player.

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
const confirm_risk = {
  type: "boolean",
  description: "Only when a previous result told you this action is risky and nobody is online to ask: set true to go ahead after you have double-checked the coordinates and are sure it is safe and necessary.",
};

export const TOOLS = [
  {
    name: "observe",
    description: "Look around. Returns your position, health, hunger, inventory, known places, every non-air block near you with exact coordinates, and nearby entities and players. Use it before acting on coordinates you have not seen this task.",
    parameters: obj({ radius: { type: "integer", description: "How far to scan, 2-12 blocks. Default 7." } }),
  },
  {
    name: "move_to",
    description: "Walk to stand in the block column x,z with your feet at height y. You walk like a player: on solid ground, stepping up 1 block and dropping at most 3. Paths never touch lava or cross gaps. Most other actions walk into reach on their own.",
    parameters: obj(xyz, ["x", "y", "z"]),
  },
  {
    name: "come_to_player",
    description: "Walk to the human player (or to the named player).",
    parameters: obj({ name: { type: "string" } }),
  },
  {
    name: "mine_block",
    description: "Break one or more blocks with your best tool and pick up the drops. Walks into reach first. Takes real time. Stone-type blocks drop nothing without a pickaxe. The result says what was actually picked up; drops can be lost over the edge. Risky blocks (touching water or lava, or a log when there is no sapling) are sent to the human for approval automatically.",
    parameters: obj({ ...xyz, positions, confirm_risk }),
  },
  {
    name: "place_block",
    description: "Place an item from your inventory at one or more empty positions. Each position must touch an existing solid block (extend sideways from an edge to build a bridge). Also: plants saplings (on dirt or grass), seeds (on farmland), sugar_cane, cactus; pours a water_bucket or lava_bucket (you keep the empty bucket); places ice. The result says what block is actually there afterwards.",
    parameters: obj({ item: { type: "string", description: "Item name without namespace, e.g. cobblestone, dirt, oak_sapling, crafting_table, wheat_seeds, water_bucket" }, ...xyz, positions, confirm_risk }, ["item"]),
  },
  {
    name: "look_in_chest",
    description: "Walk to a chest and list what is in it.",
    parameters: obj(xyz, ["x", "y", "z"]),
  },
  {
    name: "take_from_chest",
    description: "Take items out of a chest. Omit item (or use \"all\") to take everything.",
    parameters: obj({ ...xyz, item: { type: "string" }, count: { type: "integer" } }, ["x", "y", "z"]),
  },
  {
    name: "put_in_chest",
    description: "Store items from your inventory in a chest. Omit count to store all of that item. The result gives the chest's count before and after.",
    parameters: obj({ ...xyz, item: { type: "string" }, count: { type: "integer" } }, ["x", "y", "z", "item"]),
  },
  {
    name: "craft",
    description: "Craft an item using normal Minecraft recipes and your inventory. Small recipes (planks, sticks, crafting_table, torch) work anywhere; the rest need a placed crafting_table within reach. count is how many items you want. Name the wood for planks (oak_planks).",
    parameters: obj({ item: { type: "string" }, count: { type: "integer", description: "Default 1" } }, ["item"]),
  },
  {
    name: "harvest_generator",
    description: "Routine: collect cobblestone from the island's recorded cobblestone generator until you have gained `count`, then (unless deposit is false) store it in the main chest. Needs a pickaxe in your inventory. One call does the whole job and reports real before/after counts.",
    parameters: obj({ count: { type: "integer", description: "How many cobblestone to collect (max 128). Default 8." }, deposit: { type: "boolean", description: "Store the cobblestone in the main chest afterwards. Default true." } }),
  },
  {
    name: "use_item_on",
    description: "Use an item from your inventory on a block: a hoe on dirt or grass makes farmland; bone_meal on a crop or sapling makes it grow (a sapling may need several tries), on a grass_block grows short grass (mine it for seeds). The result says what actually changed.",
    parameters: obj({ item: { type: "string" }, ...xyz, confirm_risk }, ["item", "x", "y", "z"]),
  },
  {
    name: "fill_bucket",
    description: "Scoop a water or lava SOURCE block into an empty bucket.",
    parameters: obj({ ...xyz, confirm_risk }, ["x", "y", "z"]),
  },
  {
    name: "smelt",
    description: "Smelt up to 8 items in a placed furnace within reach, in real time (10 seconds each): cobblestone->stone, sand->glass, any log->charcoal, raw_iron->iron_ingot, food. Fuel comes from your inventory (coal, charcoal, planks, logs, sticks) unless you name one.",
    parameters: obj({ item: { type: "string" }, count: { type: "integer" }, fuel: { type: "string" } }, ["item"]),
  },
  {
    name: "eat",
    description: "Eat a food item from your inventory. Only works when hunger is below 20.",
    parameters: obj({ item: { type: "string" } }, ["item"]),
  },
  {
    name: "attack",
    description: "Attack a mob by its id from observe, with a sword if you have one. Drops near you are picked up.",
    parameters: obj({ id: { type: "string" }, hits: { type: "integer", description: "Max hits, default 8" } }, ["id"]),
  },
  {
    name: "record_lesson",
    description: "Write down one thing you learned the hard way, so you never repeat the mistake: what you tried, what happened, what to do instead. One or two sentences with specifics. Use it after every death, every lost item, and whenever an approach failed and a different one worked. Lessons are shown to you at the start of every future task.",
    parameters: obj({ lesson: { type: "string" } }, ["lesson"]),
  },
  {
    name: "complete_goal",
    description: "Mark a goal from the goal list as done. Only call it when a tool result in this task proves it; quote that proof as evidence (for example the chest count).",
    parameters: obj({ id: { type: "string" }, evidence: { type: "string" } }, ["id", "evidence"]),
  },
  {
    name: "skip_goal",
    description: "Mark a goal as not possible right now and move on, with the reason (for example a missing item). It can be reopened later with reopen: true.",
    parameters: obj({ id: { type: "string" }, reason: { type: "string" }, reopen: { type: "boolean" } }, ["id"]),
  },
  {
    name: "wait",
    description: "Do nothing for some seconds (max 120), e.g. while a sapling grows.",
    parameters: obj({ seconds: { type: "integer" } }, ["seconds"]),
  },
  {
    name: "say",
    description: "Say something in the game chat while you are still working (a question, or a short progress note on a long job). Your final answer for a task is sent to chat automatically, so do not repeat it with this.",
    parameters: obj({ message: { type: "string" } }, ["message"]),
  },
  {
    name: "remember_place",
    description: "Save a named location (for example a farm or a second chest) so it is listed under known places from now on. Set forget to true to remove a name.",
    parameters: obj({ name: { type: "string" }, ...xyz, forget: { type: "boolean" } }, ["name"]),
  },
  {
    name: "set_notes",
    description: "Replace your private long-term notes: goals, plans, what is finished, what the human prefers. Each task starts with a fresh conversation and only these notes, the known places and the last few task summaries carry over.",
    parameters: obj({ notes: { type: "string" } }, ["notes"]),
  },
];
