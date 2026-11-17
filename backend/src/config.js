// Backend settings, stored in data/config.json on the host (never in the
// Minecraft world or the add-on). API keys are write-only from the web page.
import fs from "node:fs";
import path from "node:path";

/** "anthropic" uses the official SDK; the rest speak the OpenAI-style chat API (which Ollama and most hosts offer). */
export const PROVIDERS = {
  anthropic: { label: "Claude (Anthropic)", kind: "anthropic", defaultModel: "claude-opus-5-5", needsKey: false, keyUrl: "https://platform.claude.com/settings/keys" },
  ollama: { label: "Local model (Ollama)", kind: "openai", baseUrl: "http://127.0.0.1:11434/v1", defaultModel: "", needsKey: false, keyUrl: "" },
  openai: { label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "", needsKey: true, keyUrl: "https://platform.openai.com/api-keys" },
  gemini: { label: "Google Gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "", needsKey: true, keyUrl: "https://aistudio.google.com/apikey" },
  openrouter: { label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "", needsKey: true, keyUrl: "https://openrouter.ai/keys" },
  custom: { label: "Other OpenAI-compatible server", kind: "openai", baseUrl: "", defaultModel: "", needsKey: false, keyUrl: "" },
};

const DEFAULTS = {
  provider: "anthropic",
  botName: "Claude",
  effort: "low",
  listen: "all", // "all": every chat line is for the AI; "mention": only lines containing its name
  autonomous: true, // keep playing by itself when it has no instruction
  playWhenAlone: true, // ...even while no human is online
  selfApprove: true, // when nobody is online to ask, the AI may confirm a risky action itself after a second look
  maxStepsPerTask: 30,
  dailyUsdLimit: 2,
  dailyTokenLimit: 3000000,
  approvalTimeoutSec: 60,
  accounts: {}, // per provider: { apiKey, model, baseUrl }
};
const PLAIN_KEYS = ["provider", "botName", "effort", "listen", "autonomous", "playWhenAlone", "selfApprove", "maxStepsPerTask", "dailyUsdLimit", "dailyTokenLimit", "approvalTimeoutSec"];

export class Config {
  constructor(dataDir) {
    this.file = path.join(dataDir, "config.json");
    this.values = structuredClone(DEFAULTS);
    try {
      this.values = { ...this.values, ...JSON.parse(fs.readFileSync(this.file, "utf8")) };
    } catch {
      // first run
    }
  }

  get(key) {
    return this.values[key];
  }

  save(patch) {
    for (const key of PLAIN_KEYS) {
      if (patch[key] === undefined) continue;
      this.values[key] = typeof DEFAULTS[key] === "number" ? Math.max(0, Number(patch[key]) || 0) : typeof DEFAULTS[key] === "boolean" ? Boolean(patch[key]) : String(patch[key]);
    }
    if (!PROVIDERS[this.values.provider]) this.values.provider = "anthropic";
    if (patch.account) {
      const account = { ...(this.values.accounts[this.values.provider] ?? {}) };
      if (typeof patch.account.model === "string") account.model = patch.account.model.trim();
      if (typeof patch.account.baseUrl === "string") account.baseUrl = patch.account.baseUrl.trim();
      // An empty key field means "keep the saved key".
      if (typeof patch.account.apiKey === "string" && patch.account.apiKey.trim()) account.apiKey = patch.account.apiKey.trim();
      if (patch.account.clearKey === true) delete account.apiKey;
      this.values.accounts = { ...this.values.accounts, [this.values.provider]: account };
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2), { mode: 0o600 });
  }

  /** Settings for the selected provider, with defaults filled in. */
  activeAccount() {
    const name = this.values.provider;
    const preset = PROVIDERS[name];
    const saved = this.values.accounts[name] ?? {};
    const envKey = name === "anthropic" ? process.env.ANTHROPIC_API_KEY : name === "openai" ? process.env.OPENAI_API_KEY : undefined;
    return {
      provider: name,
      kind: preset.kind,
      needsKey: preset.needsKey,
      apiKey: saved.apiKey || envKey || "",
      model: saved.model || preset.defaultModel,
      baseUrl: saved.baseUrl || preset.baseUrl || "",
      effort: this.values.effort,
    };
  }

  /** What the web page may see: keys are replaced by a yes/no flag. */
  publicView() {
    const accounts = {};
    for (const [name, preset] of Object.entries(PROVIDERS)) {
      const saved = this.values.accounts[name] ?? {};
      accounts[name] = {
        label: preset.label,
        keyUrl: preset.keyUrl,
        needsKey: preset.needsKey,
        hasKey: Boolean(saved.apiKey),
        keyHint: saved.apiKey ? "…" + saved.apiKey.slice(-4) : "",
        model: saved.model || preset.defaultModel,
        baseUrl: saved.baseUrl || preset.baseUrl || "",
        editableUrl: preset.kind === "openai",
      };
    }
    const view = { accounts };
    for (const key of PLAIN_KEYS) view[key] = this.values[key];
    return view;
  }
}
