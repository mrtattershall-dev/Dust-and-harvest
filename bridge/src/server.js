// SkyAI bridge: one small server that
//   - Minecraft connects to with  /connect <address>
//   - serves a setup page where you add your AI key and start/stop the AI.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";
import { Agent } from "./agent.js";
import { loadConfig, publicConfig, saveConfig } from "./config.js";
import { MinecraftLink } from "./minecraft.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(here, "..", "public", "index.html");

/** Start the bridge. Options are for tests; normally everything comes from the environment. */
export function startBridge({ port = Number(process.env.PORT) || 8765, makeProvider, quiet = false } = {}) {
  loadConfig();
  const password = process.env.BRIDGE_PASSWORD ?? "";
  const link = new MinecraftLink();

  // Activity log, shown live on the web page.
  const history = [];
  const listeners = new Set();
  const log = (kind, text) => {
    const entry = { time: Date.now(), kind, text };
    history.push(entry);
    if (history.length > 400) history.shift();
    for (const res of listeners) res.write(`data: ${JSON.stringify(entry)}\n\n`);
    if (!quiet) console.log(`[${kind}] ${text}`);
  };

  const agent = new Agent(link, log, makeProvider);
  link.on("connected", () => log("info", "Minecraft connected."));
  link.on("disconnected", () => log("info", "Minecraft disconnected."));
  link.on("chat", ({ sender, message }) => {
    log("chat", `${sender}: ${message}`);
    agent.tell(sender, message);
  });

  const authorized = (req) => {
    if (!password) return true;
    const header = req.headers.authorization ?? "";
    const given = Buffer.from(header.replace(/^Basic\s+/i, ""), "base64").toString().split(":").slice(1).join(":");
    const a = Buffer.from(given);
    const b = Buffer.from(password);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  const readJson = (req) =>
    new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 100000) reject(new Error("too large"));
      });
      req.on("end", () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (error) {
          reject(error);
        }
      });
    });

  const addresses = () => {
    const list = [];
    for (const group of Object.values(os.networkInterfaces())) {
      for (const net of group ?? []) if (net.family === "IPv4" && !net.internal) list.push(`${net.address}:${port}`);
    }
    return list;
  };

  const state = () => ({
    config: publicConfig(),
    minecraft: link.connected,
    running: agent.running,
    steps: agent.steps,
    tokens: agent.tokens,
    notes: agent.notes,
    addresses: addresses(),
    publicHost: process.env.PUBLIC_HOST ?? "",
  });

  const server = http.createServer(async (req, res) => {
    const send = (code, data, type = "application/json") => {
      res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
      res.end(type === "application/json" ? JSON.stringify(data) : data);
    };
    if (!authorized(req)) {
      res.writeHead(401, { "www-authenticate": 'Basic realm="SkyAI bridge"' });
      return res.end("Password required");
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/") return send(200, fs.readFileSync(PAGE, "utf8"), "text/html; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/api/state") return send(200, state());
      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        for (const entry of history.slice(-150)) res.write(`data: ${JSON.stringify(entry)}\n\n`);
        listeners.add(res);
        req.on("close", () => listeners.delete(res));
        return;
      }
      if (req.method === "POST") {
        // Only accept requests made by this page itself, not by other websites open in the browser.
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return send(403, { error: "cross-site request refused" });
        const body = await readJson(req);
        if (url.pathname === "/api/config") {
          saveConfig(body);
          log("info", "Settings saved.");
          return send(200, state());
        }
        if (url.pathname === "/api/start") {
          agent.start();
          return send(200, { ok: true });
        }
        if (url.pathname === "/api/stop") {
          agent.stop();
          return send(200, { ok: true });
        }
        if (url.pathname === "/api/say") {
          const text = String(body.message ?? "").trim().slice(0, 500);
          if (text) {
            log("chat", `You (web): ${text}`);
            agent.tell("The player", text);
          }
          return send(200, { ok: true });
        }
        if (url.pathname === "/api/clear-notes") {
          agent.clearNotes();
          log("info", "AI notes cleared.");
          return send(200, state());
        }
      }
      send(404, { error: "not found" });
    } catch (error) {
      send(400, { error: String(error?.message ?? error) });
    }
  });

  // Minecraft's /connect opens a WebSocket on the same port as the web page.
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => link.attach(ws));
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const actualPort = server.address().port;
      if (!quiet) {
        console.log(`\nSkyAI bridge is running.`);
        console.log(`  Setup page:        http://localhost:${actualPort}`);
        for (const a of addresses()) console.log(`  In Minecraft chat: /connect ${a}`);
        console.log("");
      }
      resolve({ server, link, agent, port: actualPort, close: () => new Promise((r) => { agent.stop(); wss.close(); server.closeAllConnections?.(); server.close(() => r(undefined)); }) });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startBridge();
}
