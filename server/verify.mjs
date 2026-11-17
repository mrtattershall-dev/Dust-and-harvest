// Repeatable end-to-end test of the first milestone against the REAL
// Minecraft Bedrock server (no phone needed).
//
//   npm run verify            decisions come from a fixed script (no AI model, no cost);
//                             everything else is real: server, world, AI player, actions.
//   npm run verify -- --live  the same instruction goes through your configured AI model.
//
// It uses a throwaway world ("skyai-verify"), so your own world is not touched.
// Stop "npm start" first: both use the same ports.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startBackend } from "../backend/src/index.js";
import { BACKEND_PORT, BDS_DIR, DATA_DIR, ROOT } from "./paths.mjs";

const live = process.argv.includes("--live");
const WORLD = "skyai-verify";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn, ms) => {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for: ${what}`);
    await sleep(250);
  }
};

if (!fs.existsSync(path.join(BDS_DIR, "bedrock_server"))) {
  console.error("The Minecraft server is not installed yet. Run:  npm run setup -- --accept-eula");
  process.exit(1);
}

// ---- a fresh throwaway world, without disturbing the real one ----
const keep = ["server.properties", "config/default/variables.json"].map((f) => path.join(BDS_DIR, f));
const backups = keep.map((f) => [f, fs.readFileSync(f)]);
const restore = () => {
  for (const [f, data] of backups) fs.writeFileSync(f, data);
  fs.rmSync(path.join(BDS_DIR, "worlds", WORLD), { recursive: true, force: true });
};
fs.rmSync(path.join(BDS_DIR, "worlds", WORLD), { recursive: true, force: true });
const setup = spawnSync(process.execPath, [path.join(ROOT, "server/setup.mjs"), "--accept-eula"], { env: { ...process.env, SKYAI_WORLD: WORLD }, encoding: "utf8" });
if (setup.status !== 0) {
  restore();
  console.error("Could not prepare the test world:\n" + setup.stdout + setup.stderr);
  process.exit(1);
}

// ---- backend: real, with either the scripted decision-maker or the real model ----
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "skyai-verify-"));
for (const f of ["game-token.txt", ...(live ? ["config.json"] : [])]) {
  if (fs.existsSync(path.join(DATA_DIR, f))) fs.copyFileSync(path.join(DATA_DIR, f), path.join(dataDir, f));
}

/** Stands in for the AI model: fixed tool calls per instruction, final answer copied from the last real result. */
class ScriptedProvider {
  constructor() {
    this.plan = null;
    this.lastResult = "";
  }
  async step({ input }) {
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    if (input.text && !this.plan) {
      const task = input.text.split("\n").pop();
      if (/collect/i.test(task)) this.plan = [["take_from_chest", { x: 5, y: 65, z: 1, item: "stone_pickaxe" }], ["harvest_generator", { count: 6 }]];
      else if (/grass/i.test(task)) this.plan = [["mine_block", { x: 4, y: 64, z: 0 }]];
      else this.plan = [];
    }
    if (input.toolResults) this.lastResult = input.toolResults.map((r) => r.content).join("\n");
    const next = this.plan.shift();
    if (!next) return { text: this.lastResult.split("\n").slice(0, 2).join(" ") || "Nothing to do.", toolCalls: [], model: "scripted", usage };
    return { text: "", toolCalls: [{ id: `call_${Date.now()}`, name: next[0], input: next[1] }], model: "scripted", usage };
  }
}

let backend;
let bds;
let failed = false;
try {
  backend = await startBackend({ port: BACKEND_PORT, dataDir, quiet: true, makeProvider: live ? undefined : () => new ScriptedProvider() });
} catch (error) {
  restore();
  console.error(`Could not start the backend on port ${BACKEND_PORT} (${error.message}). Stop "npm start" first.`);
  process.exit(1);
}
const { link, agent } = backend;
const said = () => backend.history.filter((e) => e.kind === "say").map((e) => e.text);

const serverLog = [];
bds = spawn("./bedrock_server", { cwd: BDS_DIR, env: { ...process.env, LD_LIBRARY_PATH: "." } });
bds.stdout.on("data", (d) => serverLog.push(String(d)));
bds.stderr.on("data", (d) => serverLog.push(String(d)));
const logText = () => serverLog.join("");

const chestCount = async (item) => {
  const reply = await link.rpc("look_in_chest", { x: 5, y: 65, z: 1 }, 30000);
  const match = new RegExp(`${item} x(\\d+)`).exec(reply.text.split("\n")[0]);
  return match ? Number(match[1]) : 0;
};
const idle = () => !agent.view().working;

try {
  console.log(`\nSkyAI milestone test (${live ? "LIVE AI model" : "scripted decisions, no AI cost"}) on Bedrock server at ${BDS_DIR}\n`);

  // 1. The server loads the add-on and the AI joins as a player.
  await until("the add-on to connect to the backend", () => link.connected, 90000);
  check("Server started and the add-on connected to the backend", true);
  await until("the AI player to spawn", () => /Player Spawned: /.test(logText()), 30000);
  const spawned = /Player Spawned: (\S+)/.exec(logText())?.[1];
  check("The AI joined the world as a player", true, `server log: "Player Spawned: ${spawned}"`);

  // 2. It observes real world state (the generator runs on real game physics).
  await until("the generator to make its first cobblestone", async () => /cobblestone \[1\]: y=64: z=1 x=3/.test((await link.rpc("observe", { radius: 5 }, 20000)).text), 60000);
  const observation = (await link.rpc("observe", { radius: 5 }, 20000)).text;
  check("Observation shows the real world", /water\(source\)/.test(observation) && /lava\(source\)/.test(observation) && /chest \[1\]/.test(observation) && /hunger \d+\/20/.test(observation), observation.split("\n")[0]);

  // 3. An instruction leads to real actions with a verified outcome.
  const before = await chestCount("cobblestone");
  const sayCount = said().length;
  agent.onChat("Tester", "Please collect 6 cobblestone from the generator and put it in the chest.");
  await until("the task to start", () => !idle(), 10000);
  await until("the task to finish", idle, live ? 600000 : 180000);
  const after = await chestCount("cobblestone");
  check("Instruction carried out: cobblestone mined from the generator and stored in the chest", after - before >= 6, `chest cobblestone before: ${before}, after: ${after}`);
  const report = said().slice(sayCount).join(" ");
  check("It reported the outcome in chat", report.length > 0, `AI said: "${report.slice(0, 200)}"`);
  if (!live) check("The report matches the verified numbers", report.includes(`now has ${after}`), "");

  // 4. A risky action is held until the human answers; "no" means it is not done.
  agent.onChat("Tester", "Mine the grass block at 4 64 0.");
  try {
    await until("a permission request", () => agent.view().approval !== "", live ? 120000 : 30000);
    check("Risky action (block touching lava) triggered a permission request", true, agent.view().approval);
    agent.onChat("Tester", "no");
    await until("the task to finish", idle, live ? 300000 : 60000);
    const seen = (await link.rpc("observe", { radius: 6 }, 20000)).text;
    const grassLine = seen.split("\n").find((l) => l.includes("grass_block [")) ?? "";
    const intact = /y=64: z=0 x=0\.\.5/.test(grassLine);
    check("After the human said no, the block was left alone", intact, intact ? grassLine.trim().slice(0, 120) : "what the AI saw:\n" + seen);
  } catch (error) {
    check("Risky action (block touching lava) triggered a permission request", false, live ? `${error.message} (the live model may have refused on its own; see the log)` : error.message);
    agent.stop();
  }

  // 5. Commands that work without the AI model.
  const n = said().length;
  agent.onChat("Tester", "!status");
  await until("the status reply", () => said().length >= n + 3, 20000);
  check("!status answers without using the AI model", /health \d+\/20/.test(said().slice(n).join(" ")), said().slice(n)[1]);

  // 6. The pickaxe it took is still in its inventory.
  const inventoryLine = (await link.rpc("observe", { radius: 2 }, 20000)).text.split("\n")[0];
  check("The AI player still holds its pickaxe", /stone_pickaxe x1/.test(inventoryLine), inventoryLine);
} catch (error) {
  failed = true;
  console.log(`\nFAIL  ${error.message}`);
  const tail = logText().split("\n").filter((l) => /Scripting|ERROR|rror/.test(l)).slice(-12).join("\n");
  if (tail) console.log("\nServer log (script lines):\n" + tail);
  console.log("\nBackend log:\n" + backend.history.slice(-15).map((e) => `  [${e.kind}] ${e.text}`).join("\n"));
}

// ---- shut down and put everything back ----
try {
  bds.stdin.write("stop\n");
} catch {
  // already gone
}
await Promise.race([new Promise((r) => bds.on("exit", r)), sleep(15000)]);
bds.kill("SIGKILL");
await backend.close();
restore();
fs.rmSync(dataDir, { recursive: true, force: true });

const bad = results.filter((r) => !r.ok).length + (failed ? 1 : 0);
console.log(`\n${bad === 0 ? "ALL CHECKS PASSED" : `${bad} CHECK(S) FAILED`} (${results.filter((r) => r.ok).length} passed)`);
process.exit(bad === 0 ? 0 : 1);
