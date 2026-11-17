# SkyAI Teammate

An AI that plays classic Skyblock by itself in Minecraft Bedrock Edition, on your own server. It has its own player in the world, works through a list of Skyblock goals using what it knows about Minecraft, and writes down what it learns from its mistakes. You join from your iPhone whenever you like to watch, help, or ask for something.

- **How it works and why it is built this way:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **What has been tested and what has not:** [Testing status](#testing-status)

```
 iPhone (you play here)                Ubuntu host
 ┌──────────────────┐   join    ┌──────────────────────────────────────────┐
 │ Minecraft Bedrock│──────────▶│ Bedrock Dedicated Server (Mojang)         │
 │ game chat        │           │  └ SkyAI add-on: island, AI player,       │
 └──────────────────┘           │    actions, safety checks                 │
 ┌──────────────────┐           │        ▲ HTTP on this machine only        │
 │ Safari: web page │──────────▶│ SkyAI backend: AI keys, model calls,      │──▶ Claude API,
 │ (progress, log)  │           │    goals, lessons, spending limits        │    or a local model
 └──────────────────┘           └──────────────────────────────────────────┘
```

Nothing is installed on the phone. The download is for the Ubuntu computer that hosts the server.

## Install on the Ubuntu host

You need [Node.js](https://nodejs.org) 20 or newer and `unzip` (`sudo apt install -y unzip`).

**From the downloadable file** (`skyai-teammate.zip`):

```bash
unzip skyai-teammate.zip && cd skyai-teammate
./install.sh        # asks you to accept the Minecraft EULA, then downloads Mojang's server and builds the world
npm start           # runs the backend and the Minecraft server together
```

**Or from the repository:** clone it, then run the same two commands.

The Minecraft server goes in `bds/`; settings and credentials go in `data/`. `npm start` prints the web page address, for example `http://192.168.1.20:8765`. Lines typed in that terminal go to the Minecraft console (`stop` shuts down cleanly). To keep it running after you close the terminal: `tmux new -d -s skyai 'npm start'`.

If the host has a firewall, open the game port and the web page port to your home network:

```bash
sudo ufw allow 19132          # Minecraft (TCP and UDP)
sudo ufw allow 8765/tcp       # SkyAI web page
```

Do not forward these ports to the internet: setup turns the server's allow-list off for convenience, and the web page has no password unless you set `SKYAI_UI_PASSWORD`.

## Connect an AI model

Open the web page, open **Settings**, choose a provider, and save. The AI starts playing as soon as it has a working model.

| Provider | What to enter | Cost |
|---|---|---|
| **Claude** | An API key from the [Claude Console](https://platform.claude.com/settings/keys) | Billed per use, separately from any claude.ai subscription |
| **Local model (Ollama)** | The model name you pulled; it must support tool calling | Free |
| OpenAI, Gemini, OpenRouter, other | That provider's key and model name | Per that provider |

**About signing in with your Claude account:** Anthropic does not let third-party programs use a claude.ai login or a Pro/Max subscription's usage; its documentation says to use API key authentication instead ([source](https://code.claude.com/docs/en/agent-sdk/overview)). The supported options are an API key, or Anthropic's command-line login to your Console (API) account: run `ant auth login` on the host as the same user and leave the key field blank. Both bill the API account.

Keys are stored only in `data/config.json` on the host. They are never written to the world, the add-on, or the web page.

## How it plays by itself

- **Goals.** It works down a list of 14 Skyblock goals (own a pickaxe, store 64 cobblestone, secure saplings, stone tools, expand the island, furnace, torches, storage, a shelter, bridge to the sand island, tree farm, crop farm, food). It decides the steps. A goal is ticked off only when it cites proof from the world, such as a chest count. Goals it cannot do yet are skipped with a reason and can be reopened.
- **Knowledge.** Its instructions cover how Skyblock works: the recipes, why lava and dirt are irreplaceable, how saplings work, how a generator is built, bridging, farming.
- **Trial and error.** Every death is written down automatically with what it was doing. When an action fails twice in a row it is told to stop repeating it, look again, and try something else. It records lessons in its own words ("standing above an edge block loses the drop; stand beside it"). All lessons are shown to it at the start of every task, and you can read them on the web page.
- **Memory.** Each task starts fresh with: lessons, goal list, its notes, known places, and the last few task summaries.
- **Quiet.** It does not narrate in chat. It speaks when a goal is completed, when it dies, when it needs permission, and when you talk to it.

### Spending while it plays alone

Playing by itself means calling the AI model continuously. Two limits bound that: 30 model steps per task, and **$2.00 per day by default** (Settings). When the daily limit is reached it stops until the next day and says so. With a local Ollama model there is no cost. By default it also plays while you are not in the game; untick that in Settings if you only want it to play when you are there. The default Claude model is `claude-opus-5-5`; type `claude-haiku-5-5` or `claude-sonnet-5-5` in the Model field for cheaper play.

### Risky actions

Some actions cannot be undone: mining a block that touches water or lava, cutting a log when there is no sapling, pouring or scooping lava. These are caught by plain code in the add-on.

- **If you are in the game** (or gave the instruction), it asks you and waits a minute. No answer counts as no.
- **If nobody is there**, it is told the action is risky and must look again; it may then go ahead only by explicitly confirming. Untick "may go ahead with a risky action" in Settings to make it never do these without you.

## Play from the iPhone

1. In Minecraft: **Play → Servers → Add Server**. Address: the Ubuntu host's IP. Port: `19132`. Join. (The server may also appear by itself under LAN games.)
2. You spawn on the island next to the AI's player (named `Claude` unless you rename it).
3. Just watch, or say something in chat: `what are you working on?`, `come here`, `put all the cobblestone in the chest`. An instruction from you takes priority over what it was doing.
4. The web page in Safari shows goal progress, what it has learned, a live log, and Yes/No buttons when it asks permission.

Commands that work without the AI model:

| Chat | What it does |
|---|---|
| `!status` | What it is doing, goal progress, position, health, hunger, inventory, today's AI usage |
| `!stop` | Stop the current action and task |
| `!come` | Walk to you |
| `!auto off` / `!auto on` | Stop or resume playing by itself |
| `yes` / `no` | Answer a permission request |
| `!help` | List these |

## Two starting kits

- **Milestone (default):** the island already has a working cobblestone generator and the chest holds a stone pickaxe. The AI starts from a safe position.
- **Classic:** the original start (chest with a lava bucket and two ice, nothing built): `./install.sh --classic` on a new world. The AI then has to build the generator itself, and pouring lava is the one step that can ruin a Skyblock world for good. This path has not been played through by a real model yet.

To start over, stop the server, delete `bds/worlds/skyblock`, run `./install.sh` again, and press "Clear the AI's notes, lessons and goal progress" in Settings.

## After a Minecraft update

The iPhone updates Minecraft by itself, and the server must match its version. When you can no longer join:

```bash
./install.sh --update    # new server version, same world, add-on re-installed
npm start
```

## Testing status

**Tested here against the real Bedrock Dedicated Server 1.26.65** with `npm run verify` (23 checks; the last two full runs passed all 23):

- Setup: server download, void world, add-on install, from a clean copy.
- The AI joins as a player with health, hunger and inventory, and observes the real world, including a generator running on real water and lava.
- Instruction to verified result: takes the pickaxe, mines real cobblestone, stores it, reports the true counts.
- Each ability done by its player in the real game: walking, mining, picking up drops, placing, chests, crafting, tilling, planting, bone meal, pouring and scooping a bucket, smelting in a furnace, eating, attacking a mob, dying and respawning.
- Permission requests, and "no" being respected.
- The self-play machinery: starting work with no instruction, recording a lesson, being told to change approach after repeated failure, holding a risky action when nobody is online, ticking off a goal with evidence.

In those tests the *decisions* came from a fixed script, not an AI model. An earlier version of the test had one unexplained failure in 12 runs (see the architecture document).

**Not tested here. Please check these yourself:**

| What | How to check |
|---|---|
| **How well a real AI model plays by itself** | This is the big one. Run `npm run verify -- --live` after saving your model on the web page: it runs the checks through your model and then lets it play alone for two minutes and prints what it did. Then watch the first hour of real play on the web page. |
| Joining from the iPhone | Follow "Play from the iPhone". If the server cannot be reached, check the firewall; if it still fails, set `transport=raknet` in `bds/server.properties` and restart. |
| Chat from a real player reaching the AI | Say `!status` in game chat. Its player should answer within a couple of seconds. |
| Local models | Small models may plan poorly or fail to call tools correctly. Try the largest tool-capable model your machine runs well. |
| `ant auth login` credentials | Log in on the host, leave the key blank, run the live test. |

## Run the test yourself

```bash
npm run verify             # real server, real actions, scripted decisions, no AI cost (about 2 minutes)
npm run verify -- --live   # your configured AI model makes the decisions
```

It uses a throwaway world and leaves yours alone. Stop `npm start` first.

## What its player can do

Look around, walk, mine with the right tool, pick up drops, place blocks, plant saplings and seeds, till with a hoe, use bone meal, pour and scoop buckets, use chests, craft (about 150 recipes), smelt in a furnace, eat, attack mobs, run the cobblestone harvesting routine, chat, remember places, notes and lessons.

Not yet: trading, enchanting, redstone, the Nether, boats, fishing, sleeping in a bed.
