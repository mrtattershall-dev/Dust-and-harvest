// The link to the game. Minecraft Bedrock connects to us with the
// "/connect <address>" chat command (a WebSocket). Over that link we can run
// commands as the player and hear chat messages.
//
// To make the AI's bot act we run:   /scriptevent skyai:rpc {json}
// The add-on writes its answer onto tags of the player; we read them with
// "/tag @s list" and then acknowledge so the add-on deletes them.
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

const TAG_PATTERN = /skyai\.(\d+)\.(\d+)\.(\d+)\.([A-Za-z0-9_-]*)/g;

export class MinecraftLink extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.pending = new Map();
    this.nextId = Math.floor(Date.now() / 1000) % 1000000;
    this.pollCommand = process.env.SKYAI_POLL_COMMAND ?? "tag @s list";
  }

  get connected() {
    return this.socket !== null;
  }

  /** Called by the server when the game connects. */
  attach(socket) {
    if (this.socket) this.socket.close();
    this.socket = socket;
    socket.on("message", (data) => this.#onMessage(String(data)));
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      for (const { reject } of this.pending.values()) reject(new Error("Minecraft disconnected"));
      this.pending.clear();
      this.emit("disconnected");
    });
    socket.on("error", () => {});
    this.#send("subscribe", { eventName: "PlayerMessage" });
    this.emit("connected");
  }

  #send(purpose, body) {
    const requestId = randomUUID();
    this.socket.send(JSON.stringify({ header: { version: 1, requestId, messageType: "commandRequest", messagePurpose: purpose }, body }));
    return requestId;
  }

  #onMessage(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    const header = message.header ?? {};
    if (header.messagePurpose === "commandResponse") {
      const waiter = this.pending.get(header.requestId);
      if (waiter) {
        this.pending.delete(header.requestId);
        clearTimeout(waiter.timer);
        waiter.resolve(message.body ?? {});
      }
    } else if (header.messagePurpose === "event" && header.eventName === "PlayerMessage") {
      const body = message.body ?? {};
      if (body.type === "chat" && typeof body.message === "string" && body.message.trim()) {
        this.emit("chat", { sender: String(body.sender ?? "Player"), message: body.message });
      }
    }
  }

  /** Run a slash command as the connected player and return the game's response body. */
  command(commandLine, timeoutMs = 8000) {
    if (!this.socket) return Promise.reject(new Error("Minecraft is not connected"));
    return new Promise((resolve, reject) => {
      const requestId = this.#send("commandRequest", { version: 1, commandLine, origin: { type: "player" } });
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Minecraft did not answer the command in time: ${commandLine.slice(0, 40)}`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
  }

  /** Read whatever reply chunks are currently on the player's tags for request `id`. */
  async #readReply(id) {
    const body = await this.command(this.pollCommand);
    const text = typeof body.statusMessage === "string" ? body.statusMessage : JSON.stringify(body);
    this.lastPollText = text;
    const chunks = new Map();
    let total = 0;
    for (const match of text.matchAll(TAG_PATTERN)) {
      if (Number(match[1]) !== id) continue;
      total = Number(match[3]);
      chunks.set(Number(match[2]), match[4]);
    }
    if (total === 0 || chunks.size < total) return undefined;
    let encoded = "";
    for (let i = 0; i < total; i++) encoded += chunks.get(i) ?? "";
    return JSON.parse(Buffer.from(encoded, "base64url").toString("latin1"));
  }

  /**
   * Ask the add-on to do something and wait for its answer.
   * Resolves to { ok, text, ... }.
   */
  async rpc(method, args = {}, timeoutMs = 180000) {
    const id = ++this.nextId;
    // Non-ASCII characters are escaped so the command line stays plain ASCII.
    const json = JSON.stringify({ id, m: method, a: args }).replace(/[\u0080-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
    if (json.length > 1900) throw new Error("Request too large for one command; use fewer positions per call.");
    const sent = await this.command(`scriptevent skyai:rpc ${json}`);
    if (typeof sent.statusCode === "number" && sent.statusCode !== 0) {
      throw new Error(`Minecraft refused the command (${sent.statusMessage ?? sent.statusCode}). Are cheats enabled and are you an operator?`);
    }
    const deadline = Date.now() + timeoutMs;
    let delay = 150;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay + 100, 600);
      const reply = await this.#readReply(id);
      if (reply) {
        this.command(`scriptevent skyai:ack ${id}`).catch(() => {});
        return reply;
      }
    }
    throw new Error(
      `The add-on did not answer "${method}". Check that the SkyAI Skyblock behavior pack is active in this world. ` +
        `(Last tag list seen: ${String(this.lastPollText ?? "").slice(0, 120)})`
    );
  }
}
