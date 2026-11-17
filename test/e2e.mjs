// End-to-end test without the real game or a real AI.
//
//   scripted "AI"  ->  bridge (real)  ->  WebSocket  ->  fake Minecraft client
//                                                        -> add-on scripts (real) on a mock world
//
// It plays the opening of Skyblock: loot the chest, cut the tree, craft
// tools, build the cobblestone generator, mine cobblestone, start a bridge.
import assert from "node:assert/strict";
import { createRequire, register } from "node:module";
import os from "node:os";
import path from "node:path";

register("./hooks.mjs", import.meta.url);
process.env.SKYAI_CONFIG = path.join(os.tmpdir(), `skyai-test-config-${process.pid}.json`);
process.env.SKYAI_NOTES = path.join(os.tmpdir(), `skyai-test-notes-${process.pid}.txt`);

const { testing, world } = await import("./mock/server.mjs");
await import("../addon/behavior_pack/scripts/main.js");
const { createIsland } = await import("../addon/behavior_pack/scripts/island.js");
const { startBridge } = await import("../bridge/src/server.js");
const { saveConfig } = await import("../bridge/src/config.js");
const { WebSocket } = createRequire(new URL("../bridge/package.json", import.meta.url))("ws");

// ---- the world: one player, one island ----
world.afterEvents.worldLoad.fire({});
const player = testing.addPlayer("Steve", { x: 10.5, y: 201, z: 10.5 });
const island = await createIsland(player);
const { x: ox, y: oy, z: oz } = island.origin;
const typeAt = (x, y, z) => testing.dimension.getBlock({ x, y, z }).typeId.replace("minecraft:", "");
assert.equal(typeAt(ox, oy, oz), "grass_block");
assert.equal(typeAt(island.chest.x, island.chest.y, island.chest.z), "chest");

// ---- the scripted AI ----
const A = { x: ox + 1, y: oy, z: oz + 1 };
const B = { x: ox + 2, y: oy, z: oz + 1 };
const C = { x: ox + 3, y: oy, z: oz + 1 };
const D = { x: ox + 4, y: oy, z: oz + 1 };
const tree = island.tree;
const script = [
  ["observe", {}, (r) => assert.match(r.content, /oak_log \[5\]/)],
  ["take_from_chest", { ...island.chest }, (r) => assert.match(r.content, /lava_bucket x1/)],
  ["mine_block", { positions: [0, 1, 2, 3, 4].map((dy) => [tree.x, tree.y + dy, tree.z]) }, (r) => assert.match(r.content, /oak_log x5/)],
  ["craft", { item: "planks" }, (r) => assert.ok(r.isError && /Name the wood/.test(r.content))],
  ["craft", { item: "oak_planks", count: 20 }, (r) => assert.match(r.content, /oak_planks x20/)],
  ["craft", { item: "wooden_pickaxe" }, (r) => assert.ok(r.isError && /crafting table/.test(r.content))],
  ["craft", { item: "stick", count: 8 }],
  ["craft", { item: "crafting_table" }],
  ["place_block", { item: "crafting_table", x: ox + 3, y: oy + 1, z: oz }, (r) => assert.match(r.content, /placed crafting_table/)],
  ["craft", { item: "wooden_pickaxe" }, (r) => assert.match(r.content, /Crafted wooden_pickaxe/)],
  // Dig the generator trench A B C D, with B one deeper.
  ["mine_block", { positions: [A, B, C, D, { ...B, y: oy - 1 }].map((p) => [p.x, p.y, p.z]) }, (r) => assert.match(r.content, /dirt x1/)],
  ["place_block", { item: "ice", ...A }],
  ["mine_block", { ...A }, (r) => assert.match(r.content, /melted into a water source/)],
  ["place_block", { item: "lava_bucket", ...D }, (r) => assert.match(r.content, /bucket x1/)],
  ["observe", {}, (r) => assert.match(r.content, /cobblestone \[1\]/)],
  ["mine_block", { ...C }, (r) => assert.match(r.content, /cobblestone x1/)],
  ["wait", { seconds: 1 }],
  ["mine_block", { ...C }],
  ["wait", { seconds: 1 }],
  ["mine_block", { ...C }, (r) => assert.match(r.content, /cobblestone x3/)],
  ["craft", { item: "stone_pickaxe" }, (r) => assert.match(r.content, /Crafted stone_pickaxe/)],
  // Bridge out over the void and walk onto it.
  ["place_block", { item: "dirt", positions: [[ox - 1, oy, oz], [ox - 2, oy, oz]] }, (r) => assert.match(r.content, /placed dirt[\s\S]*placed dirt/)],
  ["move_to", { x: ox - 2, y: oy + 1, z: oz }, (r) => assert.match(r.content, new RegExp(`You are at \\(${ox - 2},${oy + 1},${oz}\\)`))],
  // Things that must be refused.
  ["mine_block", { x: ox + 1, y: oy - 2, z: oz + 1 }, (r) => assert.match(r.content, /bedrock cannot be broken/)],
  ["place_block", { item: "dirt", x: ox - 10, y: oy, z: oz }, (r) => assert.ok(r.isError && /no solid block next to it/.test(r.content))],
  ["move_to", { x: ox - 30, y: oy + 1, z: oz }, (r) => assert.ok(r.isError && /No walkable path/.test(r.content))],
  // Mining the block under your feet: the bot steps aside first instead of falling.
  ["mine_block", { x: ox - 2, y: oy, z: oz }, (r) => assert.match(r.content, new RegExp(`mined dirt[\\s\\S]*You are at \\(${ox - 1},${oy + 1},${oz}\\)`))],
  ["place_block", { item: "stick", x: ox - 2, y: oy, z: oz }, (r) => assert.ok(r.isError && /not something that can be placed/.test(r.content))],
  ["put_in_chest", { ...island.chest, item: "oak_planks", count: 4 }, (r) => assert.match(r.content, /Put oak_planks x4/)],
  ["chat", { message: "Generator is running!" }],
  ["set_notes", { notes: "Generator at trench z=" + (oz + 1) }, (r) => assert.equal(r.content, "Notes saved.")],
];

let stepIndex = 0;
const seenInputs = [];
let finished;
const done = new Promise((resolve) => (finished = resolve));
class ScriptedProvider {
  reset() {}
  async step({ input }) {
    seenInputs.push(input);
    if (stepIndex > 0) {
      const [name, , check] = script[stepIndex - 1];
      const result = input.toolResults?.[0];
      assert.ok(result, `no tool result after ${name}`);
      try {
        if (check) check(result);
        else assert.ok(!result.isError, result.content);
      } catch (error) {
        console.error(`\nStep ${stepIndex} (${name}) returned:\n${result.content}\n`);
        throw error;
      }
      console.log(`  ok ${String(stepIndex).padStart(2)}  ${name}`);
    }
    if (stepIndex >= script.length) {
      finished();
      return { text: "done", toolCalls: [], usage: { input: 0, output: 0, cached: 0 } };
    }
    const [name, args] = script[stepIndex++];
    return { text: "", toolCalls: [{ id: `call_${stepIndex}`, name, input: args }], usage: { input: 1, output: 1, cached: 0 } };
  }
}

// ---- the bridge and a fake Minecraft client ----
const errors = [];
const bridge = await startBridge({ port: 0, quiet: true, makeProvider: () => new ScriptedProvider() });
saveConfig({ provider: "anthropic", botName: "Testy", account: { apiKey: "test-key" } });

const game = new WebSocket(`ws://127.0.0.1:${bridge.port}/`);
game.on("message", (data) => {
  const message = JSON.parse(String(data));
  const { requestId, messagePurpose } = message.header;
  if (messagePurpose !== "commandRequest") return;
  const line = message.body.commandLine;
  let body = { statusCode: 0 };
  const event = /^scriptevent (\S+) (.*)$/s.exec(line);
  if (event) {
    testing.scriptEvent(event[1], event[2], player);
  } else if (line === "tag @s list") {
    const tags = player.getTags();
    body = { statusCode: 0, statusMessage: `§aSteve has ${tags.length} tags: ${tags.map((t) => `§a${t}§r`).join(", ")}` };
  } else {
    errors.push(`unexpected command: ${line}`);
  }
  game.send(JSON.stringify({ header: { requestId, messagePurpose: "commandResponse", version: 1 }, body }));
});
await new Promise((resolve) => game.on("open", resolve));
await new Promise((resolve) => setTimeout(resolve, 50));
assert.ok(bridge.link.connected, "bridge should see Minecraft as connected");

// A chat line from the player must reach the AI.
game.send(JSON.stringify({ header: { messagePurpose: "event", eventName: "PlayerMessage" }, body: { type: "chat", sender: "Steve", message: "hello bot" } }));

const run = bridge.agent.start();
const timeout = setTimeout(() => {
  console.error("Timed out at step", stepIndex);
  process.exit(1);
}, 60000);
await Promise.race([done, run.then(() => { if (stepIndex < script.length) throw new Error("agent stopped early"); })]);
clearTimeout(timeout);
bridge.agent.stop();
await run;

assert.deepEqual(errors, []);
assert.match(seenInputs[0].text, /hello bot/, "player chat should be passed to the AI");
assert.match(seenInputs[0].text, /Blocks within/, "first message should include an observation");
assert.ok(world.messages.some((m) => m.includes("<Testy>") && m.includes("Generator is running!")), "chat should appear in game with the bot name");
assert.equal(bridge.agent.notes.startsWith("Generator at trench"), true);
assert.equal(player.getTags().filter((t) => t.startsWith("skyai.")).length <= 2, true, "reply tags should be cleaned up");

// Dying loses the inventory and respawns the bot at the island spawn.
const bot = testing.dimension.getEntities({ type: "skyai:bot" })[0];
bot.kill();
const after = await bridge.link.rpc("observe", {});
assert.match(after.text, /YOU DIED/);
assert.match(after.text, /Inventory: empty/);

game.close();
await bridge.close();
testing.stop();
console.log(`\nAll ${script.length} scripted steps passed.`);
process.exit(0);
