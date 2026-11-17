import { system, world } from "@minecraft/server";

export const short = (id) => id.replace(/^minecraft:/, "");
export const full = (id) => (id.includes(":") ? id : "minecraft:" + id);
export const posKey = (p) => `${p.x},${p.y},${p.z}`;
export const posStr = (p) => `(${p.x},${p.y},${p.z})`;
export const add = (p, dx, dy, dz) => ({ x: p.x + dx, y: p.y + dy, z: p.z + dz });
export const center = (p) => ({ x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

/** An error whose message is meant to be read by the AI (not a bug). */
export class ActionError extends Error {}

// A "stop" from the player interrupts whatever action is running at its next pause.
let stopRequested = false;
export function requestStop() {
  stopRequested = true;
}
export function clearStop() {
  stopRequested = false;
}

/** Wait a number of game ticks (20 ticks = 1 second). */
export function sleep(ticks) {
  return new Promise((resolve, reject) =>
    system.runTimeout(() => (stopRequested ? reject(new ActionError("Stopped by the player.")) : resolve(undefined)), Math.max(1, Math.round(ticks)))
  );
}

export function fail(message) {
  throw new ActionError(message);
}

/** Parse a block position from tool arguments: {x,y,z} or [x,y,z]. */
export function toPos(v) {
  const p = Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : v;
  if (!p || ![p.x, p.y, p.z].every((n) => typeof n === "number" && Number.isFinite(n))) {
    fail("Bad position: expected integer x, y, z");
  }
  return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

export const overworld = () => world.getDimension("overworld");

export function getProp(name, fallback) {
  const raw = world.getDynamicProperty(name);
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function setProp(name, value) {
  world.setDynamicProperty(name, value === undefined ? undefined : JSON.stringify(value));
}
