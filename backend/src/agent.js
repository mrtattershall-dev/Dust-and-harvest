// The teammate's brain. Chat from the human becomes a task; for each task the
// AI model decides which actions to take, the add-on carries them out with the
// AI's player, and the verified results go back to the model. Model calls are
// bounded per task and per day.
import fs from "node:fs";
import path from "node:path";
import { AUTONOMOUS_INSTRUCTION, systemPrompt, taskMessage } from "./prompt.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAICompatibleProvider } from "./providers/openai.js";
import { TOOLS } from "./tools.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const YES = /^!?(yes|y|ok|okay|sure|do it|go ahead|approve|approved)[.!]*$/i;
const NO = /^!?(no|n|nope|don't|dont|stop|deny|denied|cancel)[.!]*$/i;

const HELP = [
  "Talk to me normally to give me a job or ask a question.",
  "!status - what I'm doing, my inventory, today's AI usage",
  "!stop - stop what I'm doing right now",
  "!come - walk to you",
  "!auto on / !auto off - let me keep playing on my own",
  "!yes / !no - answer when I ask for permission",
];

export class Agent {
  /**
   * @param {object} deps
   * @param {import("./game.js").GameLink} deps.link
   * @param {import("./config.js").Config} deps.config
   * @param {import("./budget.js").Budget} deps.budget
   * @param {(kind: string, text: string) => void} deps.log
   * @param {string} deps.dataDir
   * @param {(account: object) => object} [deps.makeProvider] test hook
   */
  constructor({ link, config, budget, log, dataDir, makeProvider }) {
    this.link = link;
    this.config = config;
    this.budget = budget;
    this.log = log;
    this.makeProvider = makeProvider ?? defaultProvider;
    this.memoryFile = path.join(dataDir, "memory.json");
    this.memory = { notes: "", recent: [] };
    try {
      this.memory = { ...this.memory, ...JSON.parse(fs.readFileSync(this.memoryFile, "utf8")) };
    } catch {
      // nothing remembered yet
    }
    this.tasks = [];
    this.current = null; // { instruction, sender, inbox: [], stop: false }
    this.approval = null; // { question, resolve }
    this.lastAuto = 0;
    this.working = false;
    setInterval(() => this.#idleTick(), 5000).unref();
  }

  // ---------- input ----------

  /** A chat line from a human player (or from the web page). */
  onChat(sender, raw) {
    const message = String(raw).trim();
    if (!message) return;
    if (this.approval && (YES.test(message) || NO.test(message))) {
      this.answerApproval(YES.test(message), sender);
      return;
    }
    if (message.startsWith("!")) {
      this.#command(sender, message.slice(1).trim().toLowerCase());
      return;
    }
    if (this.config.get("listen") === "mention" && !message.toLowerCase().includes(this.config.get("botName").toLowerCase())) return;
    if (this.current) {
      // Passed to the model with its next step, so the human can redirect a running task.
      this.current.inbox.push(`${sender} says in chat: "${message}"`);
      return;
    }
    this.tasks.push({ instruction: message, sender });
    this.#pump();
  }

  answerApproval(yes, who = "The player") {
    if (!this.approval) return false;
    const { resolve } = this.approval;
    this.approval = null;
    this.log("info", `${who} answered the permission request: ${yes ? "yes" : "no"}`);
    resolve(yes);
    return true;
  }

  stop(reason = "Stopped.") {
    this.tasks = [];
    if (this.approval) this.answerApproval(false, "Stop");
    if (this.current) {
      this.current.stop = true;
      this.link.rpc("stop", {}, 5000).catch(() => {});
    }
    this.log("info", reason);
  }

  async #command(sender, command) {
    try {
      if (command === "help") {
        for (const line of HELP) await this.say(line);
      } else if (command === "status") {
        const doing = this.current ? `Working on: "${this.current.instruction}"` : this.config.get("autonomous") ? "Idle (playing on my own is ON)." : "Idle, waiting for instructions.";
        await this.say(doing);
        const reply = await this.link.rpc("observe", { radius: 2 }, 15000);
        await this.say(String(reply.text).split("\n")[0]);
        await this.say(this.budget.summary());
      } else if (command === "stop") {
        this.stop(`${sender} asked me to stop.`);
        await this.say("Stopped.");
      } else if (command === "come") {
        const reply = await this.link.rpc("come_to_player", { name: sender }, 60000);
        if (!reply.ok) await this.say(String(reply.text).split("\n")[0]);
      } else if (command === "auto on" || command === "auto off") {
        this.config.save({ autonomous: command === "auto on" });
        await this.say(command === "auto on" ? "OK, I'll keep playing on my own when idle. !auto off to stop." : "OK, I'll wait for instructions.");
      } else if (command === "yes" || command === "no") {
        await this.say("I'm not waiting for an answer right now.");
      } else {
        await this.say("Unknown command. Type !help.");
      }
    } catch (error) {
      this.log("error", `Command failed: ${error.message}`);
    }
  }

  onEvent(event) {
    if (event.type === "chat") {
      this.log("chat", `${event.sender}: ${event.message}`);
      this.onChat(event.sender, event.message);
    } else if (event.type === "join") {
      this.log("info", `${event.player} joined.`);
      this.say(`Hi ${event.player}! I'm ready. Tell me what to do, or type !help.`).catch(() => {});
    } else if (event.type === "leave") {
      this.log("info", `${event.player} left.`);
    } else if (event.type === "ready") {
      this.log("info", "The AI player is in the world.");
      this.link.rpc("config", { name: this.config.get("botName") }, 15000).catch(() => {});
    }
  }

  // ---------- output ----------

  /** Say something in game chat as the AI's player. */
  async say(text) {
    this.log("say", text);
    // Game chat lines are short; split long answers.
    const chunks = String(text).match(/[\s\S]{1,240}(\s|$)/g) ?? [String(text)];
    for (const chunk of chunks.slice(0, 4)) {
      if (!chunk.trim()) continue;
      try {
        await this.link.rpc("say", { message: chunk.trim() }, 10000);
      } catch {
        return; // game not connected; the message is still in the log
      }
    }
  }

  // ---------- tasks ----------

  #idleTick() {
    if (this.working || this.tasks.length > 0 || !this.config.get("autonomous")) return;
    if (!this.link.connected || Date.now() - this.lastAuto < 20000 || this.budget.blocked()) return;
    this.lastAuto = Date.now();
    // Never spend while nobody is playing.
    this.link
      .rpc("ping", {}, 5000)
      .then((reply) => {
        if (!reply.players?.length || this.working || this.tasks.length > 0) return;
        this.tasks.push({ instruction: AUTONOMOUS_INSTRUCTION, sender: "" });
        this.#pump();
      })
      .catch(() => {});
  }

  async #pump() {
    if (this.working) return;
    this.working = true;
    while (this.tasks.length > 0) {
      const task = this.tasks.shift();
      this.current = { ...task, inbox: [], stop: false };
      let outcome;
      try {
        outcome = await this.#runTask(this.current);
      } catch (error) {
        outcome = `Stopped: ${error.message}`;
        this.log("error", outcome);
        await this.say(error.playerMessage ?? `I had to stop: ${error.message}`);
      }
      this.memory.recent.push({ instruction: task.sender ? task.instruction : "(playing on my own)", outcome: String(outcome).slice(0, 300) });
      this.memory.recent = this.memory.recent.slice(-6);
      this.#saveMemory();
      this.current = null;
    }
    this.working = false;
    this.lastAuto = Date.now();
  }

  #saveMemory() {
    try {
      fs.writeFileSync(this.memoryFile, JSON.stringify(this.memory, null, 2));
    } catch {
      // memory stays in RAM
    }
  }

  async #runTask(task) {
    this.log("task", task.sender ? `${task.sender}: ${task.instruction}` : "Playing on my own");
    const blocked = this.budget.blocked();
    if (blocked) throw Object.assign(new Error(blocked), { playerMessage: `I can't think right now: ${blocked}. Raise the limit on my web page, or try tomorrow. (!status and !stop still work.)` });

    const account = this.config.activeAccount();
    if (account.needsKey && !account.apiKey) throw Object.assign(new Error("no API key saved"), { playerMessage: "I have no AI key yet. Open my web page and add one." });
    let provider;
    try {
      provider = this.makeProvider(account);
    } catch (error) {
      throw Object.assign(error, { playerMessage: `My AI model is not set up: ${error.message}` });
    }

    const system = systemPrompt({ botName: this.config.get("botName") });
    const observation = (await this.link.rpc("observe", {}, 20000)).text;
    let input = { text: taskMessage({ instruction: task.instruction, sender: task.sender, notes: this.memory.notes, recent: this.memory.recent, observation }) };
    const maxSteps = Math.max(3, this.config.get("maxStepsPerTask"));

    for (let step = 1; step <= maxSteps; step++) {
      if (task.stop) return "Stopped by the player.";
      if (!this.link.connected) throw new Error("the Minecraft server is not connected");
      const limit = this.budget.blocked();
      if (limit) throw Object.assign(new Error(limit), { playerMessage: `I have to pause: ${limit}.` });
      if (task.inbox.length > 0) input.text = [input.text, ...task.inbox.splice(0)].filter(Boolean).join("\n");
      if (step === maxSteps) input.text = [input.text, "This is your last step for this task. Do not call tools; report where things stand."].filter(Boolean).join("\n");

      const result = await this.#callModel(provider, { system, tools: TOOLS, input }, task);
      if (task.stop) return "Stopped by the player.";
      if (result.toolCalls.length === 0 || step === maxSteps) {
        const answer = result.text || "Done.";
        await this.say(answer);
        return answer;
      }
      if (result.text) this.log("ai", result.text);
      const toolResults = [];
      for (const call of result.toolCalls) {
        toolResults.push(task.stop ? { id: call.id, content: "Not done: the player said stop.", isError: true } : await this.#runTool(call));
      }
      input = { toolResults };
    }
    return "Step limit reached.";
  }

  /** One model call, with retries when the model is temporarily unavailable. */
  async #callModel(provider, request, task) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await provider.step(request);
        this.budget.record(result.model ?? "", result.usage);
        return result;
      } catch (error) {
        lastError = error;
        this.log("error", error.message);
        if (error.fatal || error.resetConversation || task.stop) break;
        await sleep(error.waitMs ?? 4000 * attempt);
      }
    }
    throw Object.assign(new Error(lastError.message), {
      playerMessage: `I can't reach my AI model right now (${lastError.message.slice(0, 120)}). I'll stand by; ask me again in a bit. !status and !stop still work.`,
    });
  }

  async #runTool(call) {
    const args = call.input && typeof call.input === "object" ? { ...call.input } : {};
    const shown = JSON.stringify(args);
    this.log("action", `${call.name} ${shown.length > 160 ? shown.slice(0, 160) + "…" : shown}`);
    if (args.__invalid) return { id: call.id, content: "The tool arguments were not valid JSON. Try again.", isError: true };
    if (!TOOLS.some((t) => t.name === call.name)) return { id: call.id, content: `There is no tool named "${call.name}".`, isError: true };
    delete args.approved; // only the human can approve risky actions

    if (call.name === "set_notes") {
      this.memory.notes = String(args.notes ?? "").slice(0, 6000);
      this.#saveMemory();
      return { id: call.id, content: "Notes saved." };
    }
    if (call.name === "say") {
      await this.say(String(args.message ?? ""));
      return { id: call.id, content: "Said in chat." };
    }

    try {
      let reply = await this.link.rpc(call.name, args);
      if (reply.needsApproval) {
        const approved = await this.#askPermission(reply.needsApproval);
        if (approved === null) return { id: call.id, content: `Not done: this needs the human's permission (${reply.needsApproval}) and nobody answered. Do something else, or ask them again later.`, isError: true };
        if (!approved) return { id: call.id, content: `Not done: the human said NO to this (${reply.needsApproval}). Do not try it again unless they ask.`, isError: true };
        reply = await this.link.rpc(call.name, { ...args, approved: true });
      }
      const text = String(reply.text ?? "");
      this.log(reply.ok ? "result" : "fail", text.length > 500 ? text.slice(0, 500) + "…" : text);
      return { id: call.id, content: text || (reply.ok ? "Done." : "Failed."), isError: !reply.ok };
    } catch (error) {
      this.log("fail", error.message);
      return { id: call.id, content: `The game did not respond: ${error.message}`, isError: true };
    }
  }

  /** Ask the human to allow a risky action. Resolves true, false, or null (no answer). */
  async #askPermission(what) {
    const question = `I want to ${what}. OK? Answer yes or no.`;
    this.log("ask", question);
    await this.say(question);
    const seconds = Math.max(10, this.config.get("approvalTimeoutSec"));
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.approval?.resolve === finish) this.approval = null;
        this.log("info", "Nobody answered the permission request.");
        resolve(null);
      }, seconds * 1000);
      const finish = (yes) => {
        clearTimeout(timer);
        resolve(yes);
      };
      this.approval = { question, resolve: finish };
    });
  }

  view() {
    return {
      working: this.working,
      task: this.current ? (this.current.sender ? this.current.instruction : "Playing on its own") : "",
      approval: this.approval?.question ?? "",
      notes: this.memory.notes,
      recent: this.memory.recent,
    };
  }

  clearMemory() {
    this.memory = { notes: "", recent: [] };
    this.#saveMemory();
  }
}

function defaultProvider(account) {
  return account.kind === "anthropic" ? new AnthropicProvider(account) : new OpenAICompatibleProvider(account);
}
