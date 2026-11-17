// The link to the backend service (which holds the AI credentials and talks
// to the model). Server scripts may make HTTP requests, so this script asks
// the backend for work a few times a second and posts back results and
// events (chat, players joining).
import { system } from "@minecraft/server";
import { secrets, variables } from "@minecraft/server-admin";
import { http, HttpHeader, HttpRequest, HttpRequestMethod } from "@minecraft/server-net";

let baseUrl = "http://127.0.0.1:8765";
let token;
const outbox = { events: [], results: [] };
let busy = false;
let failures = 0;
let nextTry = 0;
let connected = false;

export function sendEvent(event) {
  outbox.events.push(event);
  if (outbox.events.length > 200) outbox.events.shift();
}

export function sendResult(id, reply) {
  outbox.results.push({ id, reply });
}

async function poll(onCommand) {
  const events = outbox.events.splice(0);
  const results = outbox.results.splice(0);
  const request = new HttpRequest(`${baseUrl}/mc/poll`);
  request.method = HttpRequestMethod.Post;
  request.timeout = 5;
  request.headers = [new HttpHeader("content-type", "application/json")];
  if (token) request.headers.push(new HttpHeader("x-skyai-token", token));
  request.body = JSON.stringify({ events, results });
  let response;
  try {
    response = await http.request(request);
    if (response.status !== 200) throw new Error(`status ${response.status}`);
  } catch (e) {
    // Keep what we could not deliver and try again later.
    outbox.events.unshift(...events);
    outbox.results.unshift(...results);
    throw e;
  }
  const data = JSON.parse(response.body);
  for (const command of data.commands ?? []) onCommand(command);
}

/** Start talking to the backend. onCommand receives { id, m, a }. */
export function startNet(onCommand) {
  try {
    const configured = variables.get("skyai_backend_url");
    if (typeof configured === "string" && configured) baseUrl = configured.replace(/\/+$/, "");
    token = secrets.get("skyai_token");
  } catch {
    // defaults
  }
  system.runInterval(() => {
    if (busy || system.currentTick < nextTry) return;
    busy = true;
    poll(onCommand)
      .then(() => {
        if (!connected) console.warn(`[SkyAI] connected to backend at ${baseUrl}`);
        connected = true;
        failures = 0;
      })
      .catch((e) => {
        if (connected || failures === 0) console.warn(`[SkyAI] backend not reachable at ${baseUrl} (${e}); retrying`);
        connected = false;
        failures++;
        nextTry = system.currentTick + Math.min(200, 20 * failures);
      })
      .finally(() => {
        busy = false;
      });
  }, 4);
}
