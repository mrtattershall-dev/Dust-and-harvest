// Keeps AI spending bounded. Every model call is recorded; when today's
// limit is reached, no more calls are made until tomorrow or until the limit
// is raised.
import fs from "node:fs";
import path from "node:path";

// US dollars per million tokens: [input, output]. Cache reads cost 0.1x input,
// cache writes 1.25x input. Models not listed here (other providers, local
// models) are tracked by token count only.
const PRICES = {
  "claude-fable-5-2": [8, 40],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-haiku-4-5": [1, 5],
};

const today = () => new Date().toISOString().slice(0, 10);

export class Budget {
  constructor(dataDir, config) {
    this.file = path.join(dataDir, "usage.json");
    this.config = config;
    this.state = { day: today(), usd: 0, tokens: 0, calls: 0, unpriced: false };
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (saved.day === today()) this.state = saved;
    } catch {
      // no usage yet
    }
  }

  #rollOver() {
    if (this.state.day !== today()) this.state = { day: today(), usd: 0, tokens: 0, calls: 0, unpriced: false };
  }

  /** Returns "" if another model call is allowed, otherwise the reason it is not. */
  blocked() {
    this.#rollOver();
    const usdLimit = this.config.get("dailyUsdLimit");
    const tokenLimit = this.config.get("dailyTokenLimit");
    if (usdLimit > 0 && this.state.usd >= usdLimit) return `today's spending limit of $${usdLimit.toFixed(2)} is used up`;
    if (tokenLimit > 0 && this.state.tokens >= tokenLimit) return `today's limit of ${tokenLimit.toLocaleString()} tokens is used up`;
    return "";
  }

  /** usage: { input, output, cacheRead, cacheWrite } in tokens. */
  record(model, usage) {
    this.#rollOver();
    const price = PRICES[model];
    const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    if (price) {
      this.state.usd += (usage.input * price[0] + usage.cacheRead * price[0] * 0.1 + usage.cacheWrite * price[0] * 1.25 + usage.output * price[1]) / 1e6;
    } else {
      this.state.unpriced = true;
    }
    this.state.tokens += tokens;
    this.state.calls += 1;
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.state));
    } catch {
      // usage stays in memory
    }
  }

  summary() {
    this.#rollOver();
    const usdLimit = this.config.get("dailyUsdLimit");
    const cost = this.state.unpriced && this.state.usd === 0 ? "cost not tracked for this model" : `$${this.state.usd.toFixed(2)} of $${usdLimit.toFixed(2)}`;
    return `Today: ${this.state.calls} AI calls, ${this.state.tokens.toLocaleString()} tokens, ${cost}.`;
  }

  view() {
    this.#rollOver();
    return { ...this.state };
  }
}
