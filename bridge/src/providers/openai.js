// Any model that speaks the OpenAI-style "chat completions" API with tools:
// OpenAI, Google Gemini (its OpenAI-compatible endpoint), OpenRouter, xAI,
// and local servers such as Ollama.

export class OpenAICompatibleProvider {
  constructor({ apiKey, model, baseUrl }) {
    if (!model) throw Object.assign(new Error("Enter a model name on the setup page (see your provider's model list)."), { fatal: true });
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.messages = [];
  }

  reset() {
    this.messages = [];
  }

  async step({ system, tools, input }) {
    const added = [];
    for (const r of input.toolResults ?? []) added.push({ role: "tool", tool_call_id: r.id, content: r.content });
    if (input.text) added.push({ role: "user", content: input.text });
    this.messages.push(...added);
    const undo = () => this.messages.splice(this.messages.length - added.length, added.length);

    let response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "system", content: system }, ...this.messages],
          tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
        }),
        signal: AbortSignal.timeout(300000),
      });
    } catch (error) {
      undo();
      throw Object.assign(new Error(`Could not reach ${this.baseUrl}: ${error?.message ?? error}`), { retry: true });
    }
    const raw = await response.text();
    if (!response.ok) {
      undo();
      const detail = raw.slice(0, 300);
      if (response.status === 401 || response.status === 403) throw Object.assign(new Error(`The provider rejected the API key (${response.status}). ${detail}`), { fatal: true });
      if (response.status === 404) throw Object.assign(new Error(`Model or address not found (404). Check the model name. ${detail}`), { fatal: true });
      if (response.status === 429) throw Object.assign(new Error("Rate limit reached; waiting a bit."), { retry: true, waitMs: 20000 });
      if (response.status >= 500) throw Object.assign(new Error(`Provider error ${response.status}. ${detail}`), { retry: true });
      throw Object.assign(new Error(`The provider rejected the request (${response.status}). ${detail}`), { resetConversation: true });
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      undo();
      throw Object.assign(new Error("The provider sent an unreadable reply."), { retry: true });
    }
    const message = data.choices?.[0]?.message;
    if (!message) {
      undo();
      throw Object.assign(new Error("The provider sent an empty reply."), { retry: true });
    }
    // Echo the assistant message back unchanged on later turns (some providers attach extra fields they need).
    this.messages.push(message);
    const toolCalls = (message.tool_calls ?? []).map((call) => {
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        args = { __invalid: true };
      }
      return { id: call.id, name: call.function?.name ?? "", input: args };
    });
    const text = typeof message.content === "string" ? message.content.trim() : "";
    return { text, toolCalls, usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0, cached: data.usage?.prompt_tokens_details?.cached_tokens ?? 0 } };
  }
}
