// SkyAI Skyblock - entry point.
//
// The bridge (a small server outside the game) talks to this add-on with
//   /scriptevent skyai:rpc {"id":1,"m":"mine_block","a":{...}}
// and reads the reply from tags on the connected player (see outbox.js).
import { world, system } from "@minecraft/server";
import { runAction } from "./actions.js";
import { loadBotName, startBotJobs } from "./bot.js";
import { createIsland, startVoidJob } from "./island.js";
import { giveMenuItem, openMenu, startMenu } from "./menu.js";
import { clearOutbox, sendReply } from "./outbox.js";

let queue = Promise.resolve();
let lastId;
let lastReply;

/** Where replies are written: the player who ran the command (the one connected to the bridge). */
function replyTarget(event) {
  const source = event.sourceEntity;
  if (source && source.isValid) return source;
  return world.getAllPlayers()[0];
}

function handleRpc(event) {
  let request;
  try {
    request = JSON.parse(event.message);
  } catch {
    return;
  }
  const { id, m: method, a: args } = request;
  const target = replyTarget(event);
  if (!target || typeof id !== "number") return;
  // The bridge may re-send a request it thinks was lost; answer it once.
  if (id === lastId) {
    if (lastReply) sendReply(target, id, lastReply);
    return;
  }
  lastId = id;
  lastReply = undefined;
  queue = queue.then(async () => {
    const reply = await runAction(String(method), args ?? {});
    lastReply = reply;
    if (target.isValid) sendReply(target, id, reply);
  });
}

system.afterEvents.scriptEventReceive.subscribe((event) => {
  try {
    switch (event.id) {
      case "skyai:rpc":
        handleRpc(event);
        break;
      case "skyai:ack": {
        const target = replyTarget(event);
        if (target) clearOutbox(target, Number(event.message));
        break;
      }
      case "skyai:setup": {
        const player = event.sourceEntity ?? world.getAllPlayers()[0];
        if (player && player.typeId === "minecraft:player") createIsland(/** @type {any} */ (player)).catch((e) => world.sendMessage(`§cSkyAI: ${e}`));
        break;
      }
      case "skyai:menu": {
        const player = event.sourceEntity ?? world.getAllPlayers()[0];
        if (player && player.typeId === "minecraft:player") {
          giveMenuItem(/** @type {any} */ (player));
          openMenu(/** @type {any} */ (player)).catch(() => {});
        }
        break;
      }
    }
  } catch (e) {
    world.sendMessage(`§cSkyAI error: ${e}`);
  }
});

// Event subscriptions and timers are registered right away; anything that
// reads world data waits for the world to finish loading.
startBotJobs();
startVoidJob();
startMenu();
world.afterEvents.worldLoad.subscribe(() => {
  loadBotName();
});
