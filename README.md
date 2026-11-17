# SkyAI Skyblock

An AI (Claude, or another model) plays classic OG Skyblock inside your Minecraft Bedrock world, including on iPhone. You watch, help, and talk to it in chat.

It has two parts:

| Part | What it is | Where it runs |
|---|---|---|
| **Add-on** (`dist/SkyAI-Skyblock.mcaddon`) | Builds the Skyblock island, adds the AI's bot character, and carries out its actions under survival rules | Inside Minecraft on your iPhone |
| **Bridge** (`bridge/`) | Holds your AI key, talks to the AI model, and passes its decisions to the game | A computer on your Wi-Fi, or any always-on server |

Minecraft on iPhone does not let add-ons use the internet, so the bridge cannot live on the phone. The game connects out to it with the built-in `/connect` command.

```
AI model  <-->  Bridge (your computer)  <-- /connect -->  Minecraft on iPhone + add-on
```

## About "logging in with my Claude account"

A claude.ai subscription login cannot be used by third-party apps. The bridge uses an **API key** instead: create one at <https://platform.claude.com/settings/keys> (billed by usage, separate from a chat subscription) and paste it into the bridge's setup page. Keys for OpenAI, Google Gemini, OpenRouter, xAI, or a local model (Ollama) work the same way. Keys stay in `bridge/config.json` on your machine.

The AI is called once per action, continuously, while it plays, so it uses tokens the whole time. The default model is `claude-opus-5-5`; you can type a cheaper one (for example `claude-haiku-5-5`) on the setup page.

## Setup

### 1. Install the add-on on the iPhone

1. On the iPhone, download `dist/SkyAI-Skyblock.mcaddon` from this repository.
2. Open it from the Files app and choose **Minecraft**. The game imports two packs.
3. Create a new world:
   - Game mode: **Survival**
   - **Flat World: on** (Advanced). The add-on removes the flat ground around you so the island floats over a real void. In a normal world the island is built high in the sky instead.
   - **Cheats: on** (needed for `/connect`)
   - Behavior Packs: activate **SkyAI Skyblock** (the resource pack comes with it)
4. Enter the world. You get a **SkyAI Menu** compass. Use it and choose **Create Skyblock island here**.

No experimental toggles are needed.

### 2. Start the bridge

On a computer on the same Wi-Fi as the phone (needs [Node.js](https://nodejs.org) 20 or newer):

```
cd bridge
npm install
npm start
```

It prints a setup page address and a `/connect` command. Open the setup page, pick the AI provider, paste the API key, and press **Save**.

### 3. Connect and play

1. In Minecraft settings, turn **off** "Require Encrypted Websockets" (under General or Creator, depending on version).
2. In the game chat type the command the bridge showed, for example `/connect 192.168.1.20:8765`.
3. On the setup page press **Start AI**.

The bot walks, mines, crafts and builds by itself. Type in the game chat to talk to it. The setup page shows a live log of what it is thinking and doing.

## What the AI can do

It plays through high-level actions, each enforced by the add-on: look around, walk (pathfinding, no flying), mine (real mining times, correct tool needed for drops, tools wear out), place blocks (must touch an existing block), pour and scoop buckets, till and plant, bone meal, use chests, craft (about 150 real recipes, crafting table required for the big ones), smelt (needs a furnace and fuel), attack mobs, wait, and chat. Its instructions include how Skyblock works: saving saplings, building a cobblestone generator without ruining the lava, bridging, farming, and the classic challenge list. If it falls into the void it loses its inventory and respawns.

The island is the classic start: an L-shaped dirt island with one tree and a chest (lava bucket, 2 ice), plus a sand island about 64 blocks west with a cactus and a chest.

## Limits

- The bot is a custom character, not a real player account: it has no hunger, mobs ignore it, and it shows no item in its hand.
- Crafting, smelting and bone-meal tree growth are carried out by the add-on's own rules rather than the game's screens. Smelting is faster than in the real game.
- The phone must stay in the world with Minecraft open; when the game closes, reconnect with `/connect`.
- To run the bridge on a server instead of a home computer, set `PORT`, set `BRIDGE_PASSWORD` to protect the setup page, and set `PUBLIC_HOST` to the address players should type after `/connect`.

## Testing status

- `npm test` runs the real add-on scripts and the real bridge against a simulated Minecraft world and a scripted stand-in for the AI: 31 steps of the Skyblock opening (loot chest, cut tree, craft tools, build the generator, mine cobblestone, bridge out, refusals, death and respawn).
- `npm run typecheck` checks the add-on against Mojang's official scripting API definitions (stable API 2.0.0, Minecraft 1.21.90 and newer).
- **Not yet run inside a real Minecraft client or against a live AI model.** The first real run may need small fixes, most likely in how the bridge reads replies from the game (`bridge/src/minecraft.js`) or in the bot's appearance (`addon/resource_pack/`).

## Troubleshooting

| Problem | Fix |
|---|---|
| `/connect` fails | Phone and computer on the same Wi-Fi; "Require Encrypted Websockets" off; cheats on; allow Minecraft "Local Network" access in iPhone Settings; computer firewall allows the port. |
| "The add-on did not answer" in the log | The behavior pack is not active in this world, or you are not an operator. |
| The bot is invisible | The resource pack is not active. Activate it in the world settings. |
| "No island yet" | Use the SkyAI Menu compass, or type `/scriptevent skyai:setup`. Lost the compass? `/scriptevent skyai:menu`. |

## Development

```
npm install          # tools for building and checking the add-on
npm run build        # writes dist/SkyAI-Skyblock.mcaddon
npm run typecheck
npm test             # needs: npm --prefix bridge install
```
