// The play loop: ask the AI what to do, do it in the game, tell the AI what
// happened, repeat.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activeAccount, getConfig } from "./config.js";
import { kickoffMessage, systemPrompt } from "./prompt.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAICompatibleProvider } from "./providers/openai.js";
import { TOOLS } from "./tools.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const NOTES_FILE = process.env.SKYAI_NOTES ?? path.join(here, "..", "notes.txt");

// The conversation is restarted (keeping only the AI's notes) after this many
// steps, so it never grows without bound.
const EPISODE_STEPS = 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Agent {
  /**
   * @param {import("./minecraft.js").MinecraftLink} link
   * @param {(kind: string, text: string) => void} log
   * @param {(account: object) => object} [makeProvider] test hook
   */
  constructor(link, log, makeProvider) {
    this.link = link;
    this.log = log;
    this.makeProvider = makeProvider ?? defaultProvider;
    this.running = false;
    this.status = "stopped";
    this.inbox = [];
    this.steps = 0;
    this.tokens = { input: 0, output: 0 };
    this.notes = "";
    try {
      this.notes = fs.readFileSync(NOTES_FILE, "utf8");
    } catch {
      // no notes yet
    }
  }

  /** A chat line from a player, or a message typed on the web page. */
  tell(sender, message) {
    this.inbox.push(`[${sender} says in chat]: ${message}`);
  }

  clearNotes() {
    this.notes = "";
    try {
      fs.rmSync(NOTES_FILE, { force: true });
    } catch {
      // ignore
    }
  }

  stop() {
    if (this.running) this.log("info", "Stopping after the current action…");
    this.running = false;
  }

  async start() {
    if (this.running) return;
    const account = activeAccount();
    if (!account.apiKey && account.provider !== "custom") {
      this.log("error", "No API key saved for the selected AI. Add one above and press Save.");
      return;
    }
    if (!this.link.connected) {
      this.log("error", "Minecraft is not connected yet. In the game chat type the /connect command shown above.");
      return;
    }
    let provider;
    try {
      provider = this.makeProvider({ ...account, effort: getConfig().effort });
    } catch (error) {
      this.log("error", error.message);
      return;
    }
    this.running = true;
    this.status = "playing";
    this.log("info", `Started: ${account.provider} / ${account.model || "default model"}`);
    try {
      await this.#loop(provider);
    } catch (error) {
      this.log("error", `Stopped: ${error.message}`);
    }
    this.running = false;
    this.status = "stopped";
    this.log("info", "AI stopped.");
  }

  async #observe() {
    const reply = await this.link.rpc("observe", {});
    return reply.text;
  }

  async #loop(provider) {
    const config = getConfig();
    const system = systemPrompt({ botName: config.botName, goal: config.goal });
    await this.link.rpc("config", { name: config.botName });

    let input = { text: kickoffMessage({ notes: this.notes, observation: await this.#observe(), reason: "You are now connected to the game." }) };
    let episodeSteps = 0;
    let failures = 0;

    while (this.running) {
      if (!this.link.connected) throw new Error("Minecraft disconnected. Reconnect with /connect and press Start.");

      // Hand over anything the human said since the last step.
      if (this.inbox.length > 0) {
        input.text = [input.text, ...this.inbox.splice(0)].filter(Boolean).join("\n");
      }

      let result;
      try {
        result = await provider.step({ system, tools: TOOLS, input });
        failures = 0;
      } catch (error) {
        if (error.fatal) throw error;
        failures++;
        this.log("error", error.message);
        if (failures >= 6) throw new Error("Too many errors in a row.");
        if (error.resetConversation) {
          provider.reset();
          episodeSteps = 0;
          input = { text: kickoffMessage({ notes: this.notes, observation: await this.#observe(), reason: "The conversation was restarted after an error." }) };
        }
        await sleep(error.waitMs ?? 3000 * failures);
        continue;
      }

      this.steps++;
      episodeSteps++;
      this.tokens.input += result.usage.input;
      this.tokens.output += result.usage.output;
      if (result.text) this.log("ai", result.text);

      if (result.toolCalls.length === 0) {
        input = { text: "You did not take an action. Keep playing: choose the next useful action. (If you are waiting for something to grow, use the wait tool.)" };
      } else {
        const toolResults = [];
        for (const call of result.toolCalls) {
          toolResults.push(await this.#runTool(call));
        }
        input = { toolResults };
      }

      if (episodeSteps >= EPISODE_STEPS && this.running) {
        // Start a fresh conversation; the notes carry the plan across.
        if (!this.notesSavedThisEpisode) {
          try {
            const final = await provider.step({ system, tools: TOOLS, input: { ...input, text: "Your conversation memory is about to be cleared. Call set_notes now with everything you need to remember: progress, plan, key coordinates." } });
            for (const call of final.toolCalls) if (call.name === "set_notes") await this.#runTool(call);
          } catch (error) {
            this.log("error", `Could not save notes before the memory reset: ${error.message}`);
          }
        }
        provider.reset();
        episodeSteps = 0;
        this.notesSavedThisEpisode = false;
        input = { text: kickoffMessage({ notes: this.notes, observation: await this.#observe(), reason: "Your conversation memory was cleared to keep things fast. Rely on your notes." }) };
        this.log("info", "Conversation memory refreshed (notes kept).");
      }

      if (config.stepDelayMs > 0) await sleep(config.stepDelayMs);
    }
  }

  async #runTool(call) {
    const args = call.input && typeof call.input === "object" ? call.input : {};
    const shown = JSON.stringify(args);
    this.log("action", `${call.name} ${shown.length > 160 ? shown.slice(0, 160) + "…" : shown}`);

    if (args.__invalid) return { id: call.id, content: "The tool arguments were not valid JSON. Try again.", isError: true };
    if (!TOOLS.some((t) => t.name === call.name)) return { id: call.id, content: `There is no tool named "${call.name}".`, isError: true };

    if (call.name === "set_notes") {
      this.notes = String(args.notes ?? "").slice(0, 6000);
      this.notesSavedThisEpisode = true;
      try {
        fs.writeFileSync(NOTES_FILE, this.notes);
      } catch {
        // notes stay in memory
      }
      return { id: call.id, content: "Notes saved." };
    }

    try {
      const reply = await this.link.rpc(call.name, args);
      const text = String(reply.text ?? "");
      this.log(reply.ok ? "result" : "fail", text.length > 400 ? text.slice(0, 400) + "…" : text);
      return { id: call.id, content: text || (reply.ok ? "Done." : "Failed."), isError: !reply.ok };
    } catch (error) {
      this.log("fail", error.message);
      return { id: call.id, content: `The game did not respond: ${error.message}`, isError: true };
    }
  }
}

function defaultProvider(account) {
  return account.kind === "anthropic" ? new AnthropicProvider(account) : new OpenAICompatibleProvider(account);
}
