// A small in-game menu (opened with the SkyAI compass) so that nothing has
// to be typed on a phone except the /connect command.
import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { botExists, getBot, getBotName, getIsland, removeBots } from "./bot.js";
import { createIsland } from "./island.js";

const MENU_ITEM = "minecraft:compass";
const MENU_NAME = "§6SkyAI Menu";

export function giveMenuItem(player) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return;
  for (let i = 0; i < inv.size; i++) {
    const item = inv.getItem(i);
    if (item && item.typeId === MENU_ITEM && item.nameTag === MENU_NAME) return;
  }
  const compass = new ItemStack(MENU_ITEM, 1);
  compass.nameTag = MENU_NAME;
  compass.keepOnDeath = true;
  inv.addItem(compass);
}

async function makeIsland(player) {
  if (getIsland()) {
    const confirm = new MessageFormData()
      .title("Create a new island?")
      .body("An island already exists. Create a fresh one where you are standing? The old one is left as it is, and the AI starts over on the new one.")
      .button1("Cancel")
      .button2("Create new island");
    const answer = await confirm.show(player);
    if (answer.canceled || answer.selection !== 1) return;
    removeBots();
  }
  const island = await createIsland(player);
  player.sendMessage(
    island.flat
      ? "§aSkyblock island created. The ground around you is being removed - welcome to the void!"
      : "§aSkyblock island created high in the sky. §eTip: for a true void, use a Flat world."
  );
  player.sendMessage("§7Next: start the bridge and type §f/connect <address>§7 (see the SkyAI menu > Help).");
}

function help(player) {
  new MessageFormData()
    .title("Connecting the AI")
    .body(
      "1. Start the SkyAI bridge on a computer or server and open its web page to add your AI key.\n\n" +
        "2. In Minecraft settings turn OFF 'Require Encrypted Websockets'.\n\n" +
        "3. In chat type:  /connect <address shown on the bridge page>\n\n" +
        "4. Press Start on the bridge page. Talk to the AI in chat."
    )
    .button1("OK")
    .button2("Close")
    .show(player)
    .catch(() => {});
}

export async function openMenu(player) {
  const island = getIsland();
  const form = new ActionFormData()
    .title("SkyAI Skyblock")
    .body(island ? `Island ready. AI bot: ${botExists() ? "in the world" : "not spawned yet"}.` : "No island yet. Create one to begin.")
    .button(island ? "Create a new island here" : "Create Skyblock island here")
    .button("Go to island")
    .button(`Summon ${getBotName()} (the AI)`)
    .button("Help: connect the AI");
  const answer = await form.show(player);
  if (answer.canceled) return;
  try {
    if (answer.selection === 0) {
      await makeIsland(player);
    } else if (answer.selection === 1) {
      if (!island) return player.sendMessage("§eCreate an island first.");
      player.teleport({ x: island.spawn.x + 0.5, y: island.spawn.y, z: island.spawn.z + 0.5 });
    } else if (answer.selection === 2) {
      if (!island) return player.sendMessage("§eCreate an island first.");
      const bot = getBot();
      bot.teleport({ x: island.spawn.x + 0.5, y: island.spawn.y, z: island.spawn.z + 0.5 });
      player.sendMessage(`§a${getBotName()} is at the island spawn.`);
    } else {
      help(player);
    }
  } catch (e) {
    player.sendMessage(`§cSkyAI: ${e instanceof Error ? e.message : e}`);
  }
}

export function startMenu() {
  world.afterEvents.playerSpawn.subscribe((event) => {
    if (!event.initialSpawn) return;
    const player = event.player;
    system.runTimeout(() => {
      try {
        giveMenuItem(player);
        if (!getIsland()) player.sendMessage("§6SkyAI:§r use the §6SkyAI Menu§r compass to create your Skyblock island.");
      } catch {
        // player left
      }
    }, 40);
  });

  world.afterEvents.itemUse.subscribe((event) => {
    const item = event.itemStack;
    if (item.typeId !== MENU_ITEM || item.nameTag !== MENU_NAME) return;
    openMenu(event.source).catch(() => {});
  });
}
