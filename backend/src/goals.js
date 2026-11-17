// The Skyblock progression the AI works through when playing by itself.
// It decides how; each goal is only marked done when it reports evidence
// from the world (chest counts, blocks it observed).
export const GOALS = [
  { id: "pickaxe", title: "Own a pickaxe", how: "Take one from the chest, or cut logs and craft a wooden_pickaxe at a crafting table." },
  { id: "generator", title: "Have a working cobblestone generator", how: "If none is recorded under known places, build one exactly as described in your knowledge, then remember_place it." },
  { id: "cobble64", title: "Store 64 cobblestone in the main chest", how: "Use harvest_generator." },
  { id: "saplings", title: "Secure wood forever: 2 or more saplings planted", how: "Mine leaves to get saplings (they drop only sometimes), plant them on dirt or grass with open sky, and only then cut logs." },
  { id: "stone_tools", title: "Craft a stone pickaxe, axe and shovel", how: "3 cobblestone + 2 sticks each (shovel: 1 cobblestone) at a crafting table." },
  { id: "rim", title: "Expand the island with a cobblestone platform of 30 or more blocks", how: "Place cobblestone outward from the island's edge at the grass level. Never use dirt for this." },
  { id: "furnace", title: "Craft and place a furnace, and smelt something", how: "8 cobblestone at a crafting table. Smelt cobblestone into stone, or logs into charcoal." },
  { id: "torches", title: "Light the island: place 8 torches", how: "Smelt a log into charcoal; charcoal + stick makes 4 torches." },
  { id: "storage", title: "Craft and place a second chest and sort items into it", how: "8 planks at a crafting table. remember_place it." },
  { id: "shelter", title: "Build a small cobblestone shelter with a roof", how: "A 5x5 footprint is enough; leave a doorway." },
  { id: "bridge", title: "Bridge to the sand island and bring back everything in its chest", how: "About 60 cobblestone, one block at a time, each placed against the last. The sand island is listed under known places in observe." },
  { id: "tree_farm", title: "Have 4 or more trees or saplings growing at once", how: "Use the extra platform space; saplings need dirt or grass, so move a few dirt blocks carefully or plant on the island." },
  { id: "farm", title: "Start a farm from what the sand island chest gave you", how: "Hoe dirt next to water for seeds; sugar cane on dirt or sand touching water; cactus on sand. Needs a hoe (2 planks or cobblestone + 2 sticks)." },
  { id: "food", title: "Have a renewable food source and eat when hungry", how: "Bread is 3 wheat. Apples drop from oak leaves now and then." },
];

/** Text for the model: what is done, what is next. */
export function goalsText(status) {
  const lines = [];
  let next = 0;
  for (const g of GOALS) {
    const s = status[g.id];
    if (s?.state === "done") lines.push(`[done] ${g.id}: ${g.title}`);
    else if (s?.state === "skipped") lines.push(`[skipped: ${s.note}] ${g.id}: ${g.title}`);
    else {
      next++;
      lines.push(`[${next === 1 ? "NEXT" : "open"}] ${g.id}: ${g.title}${next <= 2 ? `. How: ${g.how}` : ""}`);
    }
  }
  if (next === 0) lines.push("All listed goals are done. Keep improving the island: more farms, more storage, a bigger base.");
  return lines.join("\n");
}
