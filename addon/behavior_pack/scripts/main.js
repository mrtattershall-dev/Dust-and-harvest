// SkyAI teammate - server add-on entry point.
//
// Runs on a Bedrock Dedicated Server. It creates the Skyblock island, owns
// the AI's simulated player, carries out actions requested by the backend,
// and reports chat and results back to it.
import { world, system } from "@minecraft/server";
import { variables } from "@minecraft/server-admin";
import { runAction } from "./actions.js";
import { botExists, getBot, getIsland, isBot, loadBotName, startBotJobs } from "./bot.js";
import { createIsland } from "./island.js";
import { sendEvent, sendResult, startNet } from "./net.js";
import { clearStop, requestStop } from "./util.js";

let queue = Promise.resolve();
const seen = new Set();

function onCommand(command) {
  const { id, m: method, a: args } = command;
  if (seen.has(id)) return;
  seen.add(id);
  if (method === "stop") {
    // Handled at once: interrupts the action that is running.
    requestStop();
    try {
      if (botExists()) getBot().stopMoving();
    } catch {
      // ignore
    }
    sendResult(id, { ok: true, text: "Stopping." });
    return;
  }
  queue = queue.then(async () => {
    clearStop();
    let reply;
    try {
      reply = await runAction(String(method), args ?? {});
    } catch (e) {
      reply = { ok: false, text: `Add-on error: ${e}` };
    }
    sendResult(id, reply);
  });
}

world.afterEvents.chatSend.subscribe((event) => {
  if (isBot(event.sender)) return;
  sendEvent({ type: "chat", sender: event.sender.name, message: event.message });
});

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn || isBot(event.player)) return;
  sendEvent({ type: "join", player: event.player.name });
});

world.afterEvents.playerLeave.subscribe((event) => {
  sendEvent({ type: "leave", player: event.playerName });
});

startBotJobs();

world.afterEvents.worldLoad.subscribe(() => {
  loadBotName();
  system.run(async () => {
    try {
      if (!getIsland()) {
        let kit = "milestone";
        try {
          const configured = variables.get("skyai_kit");
          if (configured === "classic") kit = "classic";
        } catch {
          // default
        }
        await createIsland(kit);
        console.warn(`[SkyAI] island created (${kit} kit)`);
      }
      getBot();
      console.warn("[SkyAI] AI player is in the world");
      sendEvent({ type: "ready" });
    } catch (e) {
      console.warn(`[SkyAI] startup problem: ${e}`);
    }
    startNet(onCommand);
  });
});
