// Settings for the bridge, saved to bridge/config.json (which holds your API
// keys, so it is git-ignored and never sent to the web page).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.SKYAI_CONFIG ?? path.join(here, "..", "config.json");

/** Providers the setup page offers. "anthropic" uses the official SDK; the rest speak the OpenAI-style chat API. */
export const PROVIDERS = {
  anthropic: { label: "Claude (Anthropic)", kind: "anthropic", defaultModel: "claude-opus-5-5", keyUrl: "https://platform.claude.com/settings/keys" },
  openai: { label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "", keyUrl: "https://platform.openai.com/api-keys" },
  gemini: { label: "Google Gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "", keyUrl: "https://aistudio.google.com/apikey" },
  openrouter: { label: "OpenRouter (many models)", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "", keyUrl: "https://openrouter.ai/keys" },
  xai: { label: "xAI Grok", kind: "openai", baseUrl: "https://api.x.ai/v1", defaultModel: "", keyUrl: "https://console.x.ai" },
  custom: { label: "Custom / local (OpenAI-compatible, e.g. Ollama)", kind: "openai", baseUrl: "http://localhost:11434/v1", defaultModel: "", keyUrl: "" },
};

const DEFAULTS = {
  provider: "anthropic",
  botName: "Claude",
  effort: "low",
  goal: "",
  stepDelayMs: 0,
  // per-provider: { apiKey, model, baseUrl }
  accounts: {},
};

let config = structuredClone(DEFAULTS);

export function loadConfig() {
  try {
    config = { ...structuredClone(DEFAULTS), ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } catch {
    config = structuredClone(DEFAULTS);
  }
  if (process.env.ANTHROPIC_API_KEY && !config.accounts.anthropic?.apiKey) {
    config.accounts.anthropic = { ...config.accounts.anthropic, apiKey: process.env.ANTHROPIC_API_KEY };
  }
  return config;
}

export function getConfig() {
  return config;
}

export function saveConfig(patch) {
  const next = { ...config };
  for (const key of ["provider", "botName", "effort", "goal", "stepDelayMs"]) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  if (!PROVIDERS[next.provider]) next.provider = "anthropic";
  if (patch.account) {
    const current = next.accounts[next.provider] ?? {};
    const account = { ...current };
    if (typeof patch.account.model === "string") account.model = patch.account.model.trim();
    if (typeof patch.account.baseUrl === "string") account.baseUrl = patch.account.baseUrl.trim();
    // An empty key field means "keep the saved key".
    if (typeof patch.account.apiKey === "string" && patch.account.apiKey.trim()) account.apiKey = patch.account.apiKey.trim();
    next.accounts = { ...next.accounts, [next.provider]: account };
  }
  config = next;
  fs.writeFileSync(FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  return config;
}

/** The account settings for the selected provider, with defaults filled in. */
export function activeAccount() {
  const preset = PROVIDERS[config.provider];
  const saved = config.accounts[config.provider] ?? {};
  return {
    provider: config.provider,
    kind: preset.kind,
    apiKey: saved.apiKey ?? "",
    model: saved.model || preset.defaultModel,
    baseUrl: saved.baseUrl || preset.baseUrl || "",
  };
}

/** Config as shown on the web page: keys are replaced by a yes/no flag. */
export function publicConfig() {
  const accounts = {};
  for (const [name, preset] of Object.entries(PROVIDERS)) {
    const saved = config.accounts[name] ?? {};
    accounts[name] = {
      label: preset.label,
      keyUrl: preset.keyUrl,
      hasKey: Boolean(saved.apiKey),
      keyHint: saved.apiKey ? "…" + saved.apiKey.slice(-4) : "",
      model: saved.model || preset.defaultModel,
      baseUrl: saved.baseUrl || preset.baseUrl || "",
      showBaseUrl: name === "custom",
    };
  }
  return { provider: config.provider, botName: config.botName, effort: config.effort, goal: config.goal, stepDelayMs: config.stepDelayMs, accounts };
}
