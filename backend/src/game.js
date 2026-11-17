// The backend's side of the link to the game. The server add-on calls
// POST /mc/poll a few times a second: it delivers events and finished
// results, and picks up the next commands for the AI's player.
import { EventEmitter } from "node:events";

export class GameLink extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.pending = new Map();
    this.nextId = Date.now() % 1000000000;
    this.lastSeen = 0;
    this.wasConnected = false;
    setInterval(() => this.#checkConnection(), 1000).unref();
  }

  /** True while the add-on has polled recently. */
  get connected() {
    return Date.now() - this.lastSeen < 5000;
  }

  #checkConnection() {
    if (this.connected === this.wasConnected) return;
    this.wasConnected = this.connected;
    this.emit(this.connected ? "connected" : "disconnected");
    if (!this.connected) {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error("The Minecraft server stopped responding."));
      }
      this.pending.clear();
      this.queue = [];
    }
  }

  /** Handle one poll from the add-on. Returns the reply body. */
  handlePoll(body) {
    this.lastSeen = Date.now();
    this.#checkConnection();
    for (const result of body.results ?? []) {
      const waiter = this.pending.get(result.id);
      if (!waiter) continue;
      this.pending.delete(result.id);
      clearTimeout(waiter.timer);
      waiter.resolve(result.reply ?? { ok: false, text: "empty reply" });
    }
    for (const event of body.events ?? []) this.emit("event", event);
    return { commands: this.queue.splice(0) };
  }

  /** Ask the add-on to do something. Resolves to { ok, text, needsApproval? }. */
  rpc(method, args = {}, timeoutMs = 300000) {
    if (!this.connected) return Promise.reject(new Error("The Minecraft server is not connected."));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The game did not finish "${method}" in time.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.queue.push({ id, m: method, a: args });
    });
  }
}
