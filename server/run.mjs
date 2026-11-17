// Starts the two halves together: the backend (AI + web page) and the
// Minecraft Bedrock server. Lines typed here go to the Minecraft console.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { startBackend } from "../backend/src/index.js";
import { BACKEND_PORT, BDS_DIR, DATA_DIR } from "./paths.mjs";

if (!fs.existsSync(path.join(BDS_DIR, "bedrock_server"))) {
  console.error("The Minecraft server is not installed yet. Run:  npm run setup -- --accept-eula");
  process.exit(1);
}

await startBackend({ port: BACKEND_PORT, dataDir: DATA_DIR });

const server = spawn("./bedrock_server", { cwd: BDS_DIR, env: { ...process.env, LD_LIBRARY_PATH: "." }, stdio: ["pipe", "inherit", "inherit"] });
// Console input goes to Minecraft; keep its input open even when ours closes (e.g. under systemd).
process.stdin.pipe(server.stdin, { end: false });
const stop = () => {
  try {
    server.stdin.write("stop\n");
  } catch {
    // already gone
  }
  setTimeout(() => server.kill("SIGKILL"), 15000).unref();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => {
  console.log(`Minecraft server stopped (${code}).`);
  process.exit(code ?? 0);
});
