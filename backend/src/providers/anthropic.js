// Claude, through the official Anthropic SDK.
import Anthropic from "@anthropic-ai/sdk";

// Models that support server-side fallback when a safety classifier declines a request.
const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

export class AnthropicProvider {
  constructor({ apiKey, model, effort }) {
    // With no key saved, the SDK looks for credentials on the host itself:
    // ANTHROPIC_API_KEY, or a profile created with "ant auth login".
    this.client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
    this.model = model || "claude-opus-5-5";
    this.effort = EFFORTS.has(effort) ? effort : undefined;
    /** @type {Anthropic.MessageParam[]} */
    this.messages = [];
  }

  reset() {
    this.messages = [];
  }

  /**
   * Send the next turn. `input` is { text?, toolResults?: [{ id, content, isError }] }.
   * Returns { text, toolCalls: [{ id, name, input }], usage }.
   */
  async step({ system, tools, input }) {
    /** @type {Anthropic.ContentBlockParam[]} */
    const content = [];
    for (const r of input.toolResults ?? []) {
      content.push({ type: "tool_result", tool_use_id: r.id, content: r.content, is_error: r.isError || undefined });
    }
    if (input.text) content.push({ type: "text", text: input.text });
    this.messages.push({ role: "user", content });

    const params = {
      model: this.model,
      max_tokens: 16000,
      system: [{ type: "text", text: system }],
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      messages: this.messages,
      // Cache the growing conversation prefix so each step only pays for what is new.
      cache_control: { type: "ephemeral" },
      ...(this.effort ? { output_config: { effort: this.effort } } : {}),
    };

    let response;
    try {
      response = FALLBACK_MODELS.has(this.model)
        ? await this.client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
        : await this.client.messages.create(params);
    } catch (error) {
      this.messages.pop();
      throw describeError(error);
    }

    if (response.stop_reason === "refusal") {
      this.messages.pop();
      throw Object.assign(new Error("Claude declined this request. Starting a fresh conversation."), { resetConversation: true });
    }
    if (response.stop_reason === "max_tokens") {
      this.messages.pop();
      throw Object.assign(new Error("The reply was cut off before it finished. Retrying."), { retry: true });
    }

    // Keep the full content (thinking blocks, tool calls) exactly as returned.
    this.messages.push({ role: "assistant", content: response.content });
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    const toolCalls = response.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} }));
    const u = response.usage ?? {};
    return {
      text,
      toolCalls,
      model: response.model ?? this.model,
      usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
    };
  }
}

function describeError(error) {
  if (error instanceof Anthropic.AuthenticationError) {
    return Object.assign(new Error("Claude rejected the credentials. Add an API key on the web page, or run \"ant auth login\" on the host."), { fatal: true });
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return Object.assign(new Error(`Your Claude account cannot use this model or feature: ${error.message}`), { fatal: true });
  }
  if (error instanceof Anthropic.NotFoundError) {
    return Object.assign(new Error(`Claude does not know that model name: ${error.message}`), { fatal: true });
  }
  if (error instanceof Anthropic.BadRequestError) {
    return Object.assign(new Error(`Claude rejected the request: ${error.message}`), { resetConversation: true });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return Object.assign(new Error("Claude rate limit reached; waiting a bit."), { retry: true, waitMs: 20000 });
  }
  if (error instanceof Anthropic.APIError) {
    return Object.assign(new Error(`Claude API error ${error.status ?? ""}: ${error.message}`), { retry: true });
  }
  if (/api[_ ]?key|auth|credential/i.test(String(error?.message ?? ""))) {
    return Object.assign(new Error("No Claude credentials found. Add an API key on the web page, or run \"ant auth login\" on the host."), { fatal: true });
  }
  return Object.assign(new Error(`Could not reach Claude: ${error?.message ?? error}`), { retry: true });
}
