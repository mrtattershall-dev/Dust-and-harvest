// SkyAI backend: holds the AI credentials, talks to the AI model, and serves
//   - /mc/poll   for the Minecraft server add-on (this machine only)
//   - a web page for you (works in Safari on the iPhone) to watch, chat,
//     approve risky actions and change settings.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { Agent } from "./agent.js";
import { Budget } from "./budget.js";
import { Config } from "./config.js";
import { GameLink } from "./game.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(here, "..", "public", "index.html");

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export function startBackend({ port = 8765, dataDir, makeProvider, quiet = false }) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const config = new Config(dataDir);
  const budget = new Budget(dataDir, config);
  const link = new GameLink();
  const uiPassword = process.env.SKYAI_UI_PASSWORD ?? "";
  let gameToken = "";
  try {
    gameToken = fs.readFileSync(path.join(dataDir, "game-token.txt"), "utf8").trim();
  } catch {
    // no token configured: only the loopback check applies
  }

  // Activity log, shown live on the web page.
  const history = [];
  const listeners = new Set();
  const log = (kind, text) => {
    const entry = { time: Date.now(), kind, text };
    history.push(entry);
    if (history.length > 400) history.shift();
    for (const res of listeners) res.write(`data: ${JSON.stringify(entry)}\n\n`);
    if (!quiet) console.log(`[ai:${kind}] ${text}`);
  };

  const agent = new Agent({ link, config, budget, log, dataDir, makeProvider });
  link.on("connected", () => log("info", "Minecraft server connected."));
  link.on("disconnected", () => log("info", "Minecraft server disconnected."));
  link.on("event", (event) => agent.onEvent(event));

  const readJson = (req) =>
    new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1000000) reject(new Error("too large"));
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
      for (const net of group ?? []) if (net.family === "IPv4" && !net.internal) list.push(net.address);
    }
    return list;
  };

  const state = () => ({
    config: config.publicView(),
    minecraft: link.connected,
    agent: agent.view(),
    usage: budget.view(),
    usageText: budget.summary(),
    addresses: addresses(),
  });

  const server = http.createServer(async (req, res) => {
    const send = (code, data, type = "application/json") => {
      res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
      res.end(type === "application/json" ? JSON.stringify(data) : data);
    };
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      // The game's own endpoint: this machine only, with the shared token.
      if (url.pathname === "/mc/poll") {
        const remote = req.socket.remoteAddress ?? "";
        const local = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
        if (req.method !== "POST" || !local || (gameToken && !same(req.headers["x-skyai-token"] ?? "", gameToken))) return send(403, { error: "forbidden" });
        return send(200, link.handlePoll(await readJson(req)));
      }

      if (uiPassword) {
        const given = Buffer.from(String(req.headers.authorization ?? "").replace(/^Basic\s+/i, ""), "base64").toString().split(":").slice(1).join(":");
        if (!same(given, uiPassword)) {
          res.writeHead(401, { "www-authenticate": 'Basic realm="SkyAI"' });
          return res.end("Password required");
        }
      }
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
          config.save(body);
          log("info", "Settings saved.");
          if (link.connected) link.rpc("config", { name: config.get("botName") }, 15000).catch(() => {});
          return send(200, state());
        }
        if (url.pathname === "/api/say") {
          const text = String(body.message ?? "").trim().slice(0, 500);
          if (text) {
            log("chat", `You (web page): ${text}`);
            agent.onChat("The player", text);
          }
          return send(200, { ok: true });
        }
        if (url.pathname === "/api/approve") return send(200, { ok: agent.answerApproval(body.yes === true, "You (web page)") });
        if (url.pathname === "/api/stop") {
          agent.stop("Stopped from the web page.");
          return send(200, { ok: true });
        }
        if (url.pathname === "/api/clear-memory") {
          agent.clearMemory();
          log("info", "The AI's notes and task history were cleared.");
          return send(200, state());
        }
      }
      send(404, { error: "not found" });
    } catch (error) {
      send(400, { error: String(error?.message ?? error) });
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, () => {
      const actualPort = server.address().port;
      if (!quiet) {
        console.log(`\nSkyAI backend is running.`);
        for (const a of addresses()) console.log(`  Web page (open on your phone): http://${a}:${actualPort}`);
        console.log(`  Web page (this computer):      http://localhost:${actualPort}\n`);
      }
      resolve({ server, link, agent, config, budget, port: actualPort, history, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r(undefined)); }) });
    });
  });
}
