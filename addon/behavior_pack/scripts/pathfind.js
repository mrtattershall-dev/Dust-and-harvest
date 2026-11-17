// A* pathfinding over block cells the bot can stand in.
import { isStandableId, isPassableId, isLavaId } from "./blocks.js";
import { posKey } from "./util.js";

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Makes a cached view of the world for one search.
 * typeAt returns undefined for unloaded chunks.
 */
export function worldView(dimension) {
  const cache = new Map();
  const typeAt = (x, y, z) => {
    const k = `${x},${y},${z}`;
    if (cache.has(k)) return cache.get(k);
    let id;
    try {
      id = dimension.getBlock({ x, y, z })?.typeId;
    } catch {
      id = undefined;
    }
    cache.set(k, id);
    return id;
  };
  const passable = (x, y, z) => {
    const id = typeAt(x, y, z);
    return id !== undefined && isPassableId(id) && !isLavaId(id);
  };
  const lava = (x, y, z) => {
    const id = typeAt(x, y, z);
    return id !== undefined && isLavaId(id);
  };
  // Never stand in a cell that touches lava.
  const nearLava = (x, y, z) =>
    lava(x, y - 1, z) || [0, 1].some((dy) => lava(x + 1, y + dy, z) || lava(x - 1, y + dy, z) || lava(x, y + dy, z + 1) || lava(x, y + dy, z - 1));
  const standable = (x, y, z) => {
    const below = typeAt(x, y - 1, z);
    return below !== undefined && isStandableId(below) && passable(x, y, z) && passable(x, y + 1, z) && !nearLava(x, y, z);
  };
  return { typeAt, passable, standable };
}

/**
 * Find a walking path from start to the nearest cell accepted by isGoal.
 * Moves: one block sideways, optionally stepping up 1 or dropping up to 3.
 * Returns an array of cells (excluding start), [] if already at a goal, or
 * undefined if no path exists.
 */
export function findPath(dimension, start, isGoal, heuristic, maxNodes = 6000) {
  const view = worldView(dimension);
  if (isGoal(start)) return [];
  const open = [{ pos: start, g: 0, f: heuristic(start) }];
  const cameFrom = new Map();
  const best = new Map([[posKey(start), 0]]);
  let expanded = 0;

  while (open.length > 0 && expanded < maxNodes) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const current = open.splice(bi, 1)[0];
    const ck = posKey(current.pos);
    if (current.g > (best.get(ck) ?? Infinity)) continue;
    expanded++;
    if (isGoal(current.pos)) {
      const path = [];
      let k = ck;
      let p = current.pos;
      while (cameFrom.has(k)) {
        path.unshift(p);
        p = cameFrom.get(k);
        k = posKey(p);
      }
      return path;
    }
    const { x, y, z } = current.pos;
    for (const [dx, dz] of DIRS) {
      const nx = x + dx;
      const nz = z + dz;
      let next;
      if (view.standable(nx, y, nz)) {
        next = { x: nx, y, z: nz };
      } else if (view.passable(x, y + 2, z) && view.standable(nx, y + 1, nz)) {
        next = { x: nx, y: y + 1, z: nz };
      } else if (view.passable(nx, y, nz) && view.passable(nx, y + 1, nz)) {
        for (let drop = 1; drop <= 3; drop++) {
          if (!view.passable(nx, y - drop, nz)) break;
          if (view.standable(nx, y - drop, nz)) {
            next = { x: nx, y: y - drop, z: nz };
            break;
          }
        }
      }
      if (!next) continue;
      const g = current.g + 1 + Math.abs(next.y - y) * 0.5;
      const nk = posKey(next);
      if (g >= (best.get(nk) ?? Infinity)) continue;
      best.set(nk, g);
      cameFrom.set(nk, current.pos);
      open.push({ pos: next, g, f: g + heuristic(next) });
    }
  }
  return undefined;
}
