// One-time (and after-update) setup on the Ubuntu host:
//   1. downloads Mojang's official Bedrock Dedicated Server,
//   2. creates an empty "void" world with the options the AI player needs,
//   3. installs the SkyAI add-on into that world and lets it talk to the backend.
//
//   npm run setup -- --accept-eula            first install
//   npm run setup -- --accept-eula --update   after Minecraft updates (keeps the world)
//   npm run setup -- --accept-eula --classic  original start (lava bucket + ice, no generator)
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { configureWorld } from "./leveldat.mjs";
import { BACKEND_PORT, BDS_DIR, DATA_DIR, PACK_SOURCE, PACK_UUID, WORLD_NAME } from "./paths.mjs";

const args = new Set(process.argv.slice(2));
const say = (text) => console.log(`[setup] ${text}`);

if (!args.has("--accept-eula")) {
  console.log(
    "This downloads the Minecraft Bedrock Dedicated Server from minecraft.net.\n" +
      "By using it you agree to the Minecraft End User License Agreement (https://minecraft.net/eula)\n" +
      "and Privacy Policy (https://go.microsoft.com/fwlink/?LinkId=521839).\n\n" +
      "Run again with:  npm run setup -- --accept-eula"
  );
  process.exit(1);
}

async function downloadServer() {
  const response = await fetch("https://net-secondary.web.minecraft-services.net/api/v1.0/download/links");
  const links = (await response.json()).result.links;
  const url = links.find((l) => l.downloadType === "serverBedrockLinux")?.downloadUrl;
  if (!url) throw new Error("Could not find the Linux server download link.");
  const version = /bedrock-server-([\d.]+)\.zip/.exec(url)?.[1] ?? "unknown";
  const installed = readVersion();
  if (installed === version && fs.existsSync(path.join(BDS_DIR, "bedrock_server"))) {
    say(`Bedrock server ${version} is already installed.`);
    return version;
  }
  say(`Downloading Bedrock server ${version}…`);
  const zip = path.join(DATA_DIR, "bedrock-server.zip");
  const file = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!file.ok) throw new Error(`Download failed: HTTP ${file.status}`);
  fs.writeFileSync(zip, Buffer.from(await file.arrayBuffer()));
  // Keep settings and worlds when updating.
  const keep = ["server.properties", "allowlist.json", "permissions.json"].filter((f) => fs.existsSync(path.join(BDS_DIR, f)));
  const backup = Object.fromEntries(keep.map((f) => [f, fs.readFileSync(path.join(BDS_DIR, f))]));
  fs.mkdirSync(BDS_DIR, { recursive: true });
  try {
    execFileSync("unzip", ["-q", "-o", zip, "-d", BDS_DIR], { stdio: "inherit" });
  } catch {
    throw new Error("Could not unpack the server. Install unzip first:  sudo apt install unzip");
  }
  for (const [f, data] of Object.entries(backup)) fs.writeFileSync(path.join(BDS_DIR, f), data);
  fs.rmSync(zip);
  fs.chmodSync(path.join(BDS_DIR, "bedrock_server"), 0o755);
  fs.writeFileSync(path.join(BDS_DIR, "skyai-version.txt"), version);
  return version;
}

function readVersion() {
  try {
    return fs.readFileSync(path.join(BDS_DIR, "skyai-version.txt"), "utf8").trim();
  } catch {
    return undefined;
  }
}

/** The beta scripting API version that belongs to this server version, e.g. "2.12.0-beta". */
async function betaApiVersion(serverVersion) {
  const short = serverVersion.split(".").slice(0, 3).join(".");
  const response = await fetch("https://registry.npmjs.org/@minecraft/server");
  const versions = Object.keys((await response.json()).versions);
  const match = versions.find((v) => v.endsWith(`-beta.${short}-stable`));
  if (!match) throw new Error(`Could not find the scripting API version for Bedrock ${short}.`);
  return match.split("-beta.")[0] + "-beta";
}

function setProperties(changes) {
  const file = path.join(BDS_DIR, "server.properties");
  let text = fs.readFileSync(file, "utf8");
  for (const [key, value] of Object.entries(changes)) {
    const line = new RegExp(`^${key}=.*$`, "m");
    text = line.test(text) ? text.replace(line, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
  }
  fs.writeFileSync(file, text);
}

/** Start the server just long enough for it to write a fresh level.dat. */
function createWorldFiles() {
  return new Promise((resolve, reject) => {
    const child = spawn("./bedrock_server", { cwd: BDS_DIR, env: { ...process.env, LD_LIBRARY_PATH: "." } });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("The server did not start within 2 minutes.\n" + output.slice(-2000)));
    }, 120000);
    child.stdout.on("data", (data) => {
      output += data;
      if (String(data).includes("Server started")) child.stdin.write("stop\n");
    });
    child.stderr.on("data", (data) => (output += data));
    child.on("error", reject);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const version = await downloadServer();
const apiVersion = await betaApiVersion(version);
say(`Scripting API for this server: @minecraft/server ${apiVersion}`);

setProperties({
  "level-name": WORLD_NAME,
  gamemode: "survival",
  difficulty: "easy",
  "allow-cheats": "true",
  "allow-list": "false",
  "content-log-console-output-enabled": "true",
  "player-idle-timeout": "0",
});

const worldDir = path.join(BDS_DIR, "worlds", WORLD_NAME);
if (!fs.existsSync(path.join(worldDir, "level.dat"))) {
  say("Creating the world…");
  await createWorldFiles();
  if (!fs.existsSync(path.join(worldDir, "level.dat"))) throw new Error("The server did not create a world.");
  // Throw away the terrain it generated and switch the world to an empty void.
  fs.rmSync(path.join(worldDir, "db"), { recursive: true, force: true });
  fs.mkdirSync(path.join(worldDir, "db"));
  configureWorld(path.join(worldDir, "level.dat"), { voidWorld: true });
  say("World created: empty void, survival, Beta APIs on.");
} else if (args.has("--update")) {
  configureWorld(path.join(worldDir, "level.dat"), { voidWorld: false });
  say("Existing world kept.");
} else {
  say("World already exists (kept as it is). Delete bds/worlds/" + WORLD_NAME + " to start over.");
}

// Install the add-on into the world.
const packDir = path.join(worldDir, "behavior_packs", "SkyAI");
fs.rmSync(packDir, { recursive: true, force: true });
copyDir(PACK_SOURCE, packDir);
const manifestFile = path.join(packDir, "manifest.json");
fs.writeFileSync(manifestFile, fs.readFileSync(manifestFile, "utf8").replace("SERVER_BETA_VERSION", apiVersion));
fs.writeFileSync(path.join(worldDir, "world_behavior_packs.json"), JSON.stringify([{ pack_id: PACK_UUID, version: [2, 0, 0] }], null, 2));

// Let the add-on's scripts make HTTP requests, and tell it where the backend is.
const configDir = path.join(BDS_DIR, "config", "default");
const permissionsFile = path.join(configDir, "permissions.json");
const permissions = JSON.parse(fs.readFileSync(permissionsFile, "utf8"));
for (const module of ["@minecraft/server-net", "@minecraft/server-admin", "@minecraft/server-gametest"]) {
  if (!permissions.allowed_modules.includes(module)) permissions.allowed_modules.push(module);
}
fs.writeFileSync(permissionsFile, JSON.stringify(permissions, null, 2));

const tokenFile = path.join(DATA_DIR, "game-token.txt");
if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, randomBytes(24).toString("hex"), { mode: 0o600 });
const token = fs.readFileSync(tokenFile, "utf8").trim();
const kit = args.has("--classic") ? "classic" : "milestone";
fs.writeFileSync(path.join(configDir, "variables.json"), JSON.stringify({ skyai_backend_url: `http://127.0.0.1:${BACKEND_PORT}`, skyai_kit: kit }, null, 2));
fs.writeFileSync(path.join(configDir, "secrets.json"), JSON.stringify({ skyai_token: token }, null, 2), { mode: 0o600 });

say(`Add-on installed (${kit} starter kit).`);
say("Done. Start everything with:  npm start");
