# SkyAI Teammate

An AI teammate that plays classic Skyblock with you in Minecraft Bedrock Edition. You play on your iPhone; the AI has its own player in the world, takes instructions in chat, acts, and reports what it verifiably did.

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
 │ (log, approvals) │           │    tasks, memory, spending limits         │    or a local model
 └──────────────────┘           └──────────────────────────────────────────┘
```

## What you need

- An Ubuntu computer on the same network as the iPhone, with [Node.js](https://nodejs.org) 20 or newer, `git` and `unzip`.
- Minecraft Bedrock on the iPhone, signed in to your Microsoft account.
- One of: a Claude API key, another provider's key, or a local model in Ollama.

## Set up the Ubuntu host

```bash
sudo apt install -y unzip git
git clone <this repository> skyai && cd skyai
npm install
npm run setup -- --accept-eula     # downloads Mojang's server, creates the world, installs the add-on
npm start                          # runs the backend and the Minecraft server together
```

`--accept-eula` means you accept the [Minecraft EULA](https://minecraft.net/eula). Setup puts the server in `bds/` and all settings and credentials in `data/` (both git-ignored).

If the host has a firewall, open the game port and the web page port to your home network:

```bash
sudo ufw allow 19132          # Minecraft (TCP and UDP)
sudo ufw allow 8765/tcp       # SkyAI web page
```

Do not forward these ports to the internet: the setup turns the server's allow-list off for convenience, and the web page has no password unless you set `SKYAI_UI_PASSWORD`.

`npm start` prints the web page address, for example `http://192.168.1.20:8765`. Lines you type in that terminal go to the Minecraft console (`stop` shuts it down cleanly).

## Connect an AI model

Open the web page (on the phone or the host), open **Settings**, choose a provider, and save.

| Provider | What to enter | Cost |
|---|---|---|
| **Claude** | An API key from the [Claude Console](https://platform.claude.com/settings/keys) | Billed per use, separately from any claude.ai subscription |
| **Local model (Ollama)** | The model name you pulled; it must support tool calling | Free |
| OpenAI, Gemini, OpenRouter, other | That provider's key and model name | Per that provider |

**About signing in with your Claude account:** Anthropic does not let third-party programs use a claude.ai login or a Pro/Max subscription's usage; its documentation says to use API key authentication instead ([source](https://code.claude.com/docs/en/agent-sdk/overview)). A subscription does not include API access. The supported options are an API key, or Anthropic's own command-line login to your **Console** (API) account: run `ant auth login` on the host as the same user and leave the key field blank. Both bill the API account. The command-line login path is implemented but not tested here.

Keys are stored only in `data/config.json` on the host (readable only by you). They are never written to the world, the add-on, or the web page.

**Cost control.** The AI is called only while it works on a task, never while idle. Defaults: at most 30 model steps per task and $2.00 per day (change both in Settings). The default Claude model is `claude-opus-5-5`; type `claude-haiku-5-5` or `claude-sonnet-5-5` in the Model field for cheaper play. For models without a known price the daily token limit applies instead.

## Play from the iPhone

1. In Minecraft: **Play → Servers → Add Server**. Address: the Ubuntu host's IP. Port: `19132`. Join. (The server may also appear by itself under LAN games.)
2. You spawn on the island next to the AI's player (named `Claude` unless you rename it).
3. Talk in the game chat:
   - `collect 16 cobblestone and put it in the chest`
   - `what do we have in the chest?`
   - `build a 3x3 cobblestone platform off the east side`
4. Keep the web page open in Safari if you like: live log, a box to send instructions, and Yes/No buttons when it asks permission.

Commands that work without the AI model:

| Chat | What it does |
|---|---|
| `!status` | What it is doing, its position, health, hunger, inventory, today's AI usage |
| `!stop` | Stop the current action and task |
| `!come` | Walk to you |
| `!auto on` / `!auto off` | Keep playing by itself when idle (experimental) |
| `yes` / `no` | Answer a permission request |
| `!help` | List these |

**Permission requests.** Some actions are held until you answer: mining a block that touches water or lava, cutting a log when there is no sapling to replant, pouring lava. This check is plain code in the add-on, so the AI cannot skip it. No answer within two minutes counts as no.

## Two starting kits

- **Milestone (default):** the island already has a working cobblestone generator and the chest holds a stone pickaxe. This is for the first prototype: it tests observing and acting before any risky building.
- **Classic:** the original start (chest with a lava bucket and two ice, nothing built). Use `npm run setup -- --accept-eula --classic` on a new world. The AI cannot use buckets yet, so you would build the generator yourself.

To start over, stop the server and delete `bds/worlds/skyblock`, then run setup again.

## After a Minecraft update

The iPhone updates Minecraft by itself, and the server must match its version. When you can no longer join:

```bash
npm run setup -- --accept-eula --update    # new server version, same world, add-on re-installed
npm start
```

## Testing status

**Tested here against the real Bedrock Dedicated Server 1.26.65** with `npm run verify`. Of 12 full runs (the last from a clean clone following this README), 11 passed every check; one run failed a single check once and it did not recur (see "Known limits" in the architecture document). What the test covers:

- Setup: server download, void world creation, add-on install.
- The AI joins as a player with health, hunger and inventory.
- It observes the real world, including a generator running on real water and lava physics.
- Instruction to verified result: it takes the pickaxe from the chest, mines real cobblestone, picks it up, stores it in the chest, and reports the true counts.
- Walking, cutting logs, crafting, placing blocks, dying and respawning.
- Permission requests, `!status`, the web page, spending limits being recorded.
- The model link for OpenAI-compatible servers, using a stand-in server that speaks that format.

**Not tested here. Please verify these yourself:**

| What | How to check |
|---|---|
| Joining from the iPhone | Follow "Play from the iPhone". If the server cannot be reached, check the firewall; if it still fails, set `transport=raknet` in `bds/server.properties` and restart. |
| Chat from a real player reaching the AI | Say `!status` in game chat. The AI's player should answer in chat within a couple of seconds. |
| A real AI model (Claude or Ollama) | Save your key or model on the web page, stop `npm start`, then run `npm run verify -- --live`. It sends the same instruction through your model and checks the chest. This costs a few cents on Claude. |
| `ant auth login` credentials | Run `ant auth login`, leave the key blank, then `npm run verify -- --live`. |
| How the AI's player looks on your screen | It should appear as a normal player with the default skin. |
| Playing by itself (`!auto on`) | Experimental. Watch the first few tasks and the usage line. |

## Run the test yourself

```bash
npm run verify             # real server, real actions, scripted decisions, no AI cost (about 1 minute)
npm run verify -- --live   # same, but your configured AI model makes the decisions
```

It uses a throwaway world and leaves yours alone. Stop `npm start` first.

## What the AI can and cannot do today

Can: look around, walk, mine with the right tool, pick up drops, place blocks, plant saplings, use chests, craft, run the cobblestone harvesting routine, chat, remember places and notes.

Cannot yet: buckets, farming, smelting, fighting, eating. It will say so if asked. See the roadmap in the architecture document.
