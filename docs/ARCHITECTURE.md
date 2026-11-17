# Architecture, feasibility findings and limits

## What was asked

An AI that plays Skyblock as a teammate in Minecraft Bedrock while the human plays on an iPhone: a real player, not a chatbot and not an NPC that pretends.

## Feasibility findings

Each finding says how it was established.

| Question | Finding | Evidence |
|---|---|---|
| Can an add-on on the iPhone itself run an AI teammate? | No. Add-ons on phones cannot make network requests, so they cannot reach a model. | The HTTP module (`@minecraft/server-net`) loads only on Bedrock Dedicated Server; the server's own `permissions.json` is where it is switched on. |
| Can a server add-on create a real player? | Yes. `spawnSimulatedPlayer` creates a player that is not tied to a test. | Mojang's API definitions for 1.26.65, and run here: the server logged `Player Spawned: Claude`; the player had health 20 and hunger 20 and broke dirt by hand in 0.8 s. |
| Can server scripts reach a backend? | Yes, over HTTP. | Run here against a local backend. |
| Can a void Skyblock world be made on a headless server? | Yes, by editing `level.dat`. | Run here: all probed ground blocks were air. |
| Does a generator built by script behave like a real one? | Yes, if the liquids are placed by command. Placed by a plain scripted block change, water stayed frozen and the lava turned the wrong cell to cobblestone. | Found and fixed during testing here. |
| Can a third-party program use a claude.ai login or subscription? | No. | Anthropic's documentation: "Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products… Use the API key authentication methods". |
| Is there a mature bot library for Bedrock like Mineflayer for Java? | No. `bedrock-protocol` handles packets only; movement, mining and inventory would have to be written from scratch and re-fixed for each game version. | Project documentation; not built here. |

## The three ways to put an AI in the world

| | What it is | Verdict |
|---|---|---|
| **Scripted NPC** | A custom entity; the script edits the world on its behalf. | Rejected. This is what the first version of this project was. It is not a player: no hunger, no real mining or placing. |
| **Simulated player** (chosen) | A real `Player` entity created by the server and driven by script instead of by a phone or console. | Chosen: real player rules with a small, testable amount of code. |
| **Protocol client** | A separate program that logs in over the network exactly like a phone does. | Not chosen: the truest form, but needs a second Microsoft account or an unauthenticated server, and a very large amount of fragile code. Possible later. |

### How real the simulated player is

It is the same kind of entity as your own player: it is in the player list, has health, hunger and a 36-slot inventory, takes damage, dies, and plays under survival rules. It has no game client, which decides what is real and what the script has to assist:

| Action | How it is done | Real game mechanics? |
|---|---|---|
| Walking | The player's own legs along a route planned by the add-on | Yes |
| Breaking blocks | `breakBlock`: swings until the block breaks, with the held tool | Yes: real time, real drops, tool wear |
| Picking up drops | Walking next to them | Yes |
| Placing blocks, planting | Uses the held item on a block face | Yes |
| Chat | The player speaks in chat | Yes |
| Health, hunger, death | Normal player systems | Yes |
| Chests | Walks up and opens the chest; the script then moves the items | **Assisted**: a simulated player has no inventory screen |
| Crafting | The script removes ingredients and adds the result from its own recipe table (about 150 recipes), enforcing the crafting-table rule | **Assisted**: no crafting screen exists for it |
| Being saved | Its inventory and position are stored in world data and restored when the server restarts | **Assisted**: the game does not save simulated players |

Other differences from a human player: it uses the default skin, has no Microsoft account, and exists only while the server runs the add-on.

## Parts

**Bedrock Dedicated Server** (Mojang's, unmodified) hosts the world. The iPhone joins it like any server.

**Add-on** (`addon/behavior_pack`, server-side only; nothing is installed on the phone)
- `island.js` builds the island and, for the milestone kit, the generator.
- `bot.js` owns the AI's player: creation, inventory, walking, respawn.
- `pathfind.js` plans walking routes: solid ground only, up 1, down at most 3, never next to lava.
- `actions.js` implements each action and checks the result afterwards (inventory before and after, the block that is actually there). It also holds the safety checks that require the human's approval.
- `net.js` polls the backend a few times a second for commands and posts back results and events.

**Backend** (`backend/`, Node.js on the host)
- `game.js` queues commands for the add-on and matches results.
- `agent.js` turns chat into tasks, runs the model loop, asks for approvals, handles `!` commands.
- `providers/` holds one adapter for Claude (official SDK) and one for any OpenAI-compatible server (Ollama and others).
- `budget.js` enforces the daily spending and token limits.
- `index.js` serves the web page and the add-on's endpoint.

**Host scripts** (`server/`): `setup.mjs`, `run.mjs`, `verify.mjs`, and `leveldat.mjs` (world file editor).

## The loop

1. You say something in chat. The add-on forwards it to the backend.
2. The backend starts a task with a fresh model conversation containing the AI's notes, the last few task outcomes, and a current observation: position, health, hunger, inventory, known places, every nearby block with coordinates, entities.
3. The model picks an action. The add-on carries it out with the player and returns what actually happened.
4. Repeat until the model answers in words, which is posted to chat. Limits: steps per task, spending per day.

Division of labour: **code** does movement, timing, collecting, verification, safety checks and whole routines such as harvesting the generator (one model call, many actions). The **model** decides what to do and words the report.

When the model is unreachable or the budget is used up, the AI says so in chat and stands by; `!status`, `!stop` and `!come` keep working because they do not use the model.

## Safety

- **Irreversible actions need your yes.** Mining a block that touches water or lava (other than the generator's own cobblestone), cutting a log with no sapling in the inventory or planted nearby, pouring lava. The check runs in the add-on; the model cannot set the approval itself.
- **Pathfinding** never routes next to lava or across gaps, and the bot will not mine the block it stands on if only void is below.
- **Credentials** live in `data/` on the host with owner-only permissions. The add-on's endpoint accepts requests only from the same machine with a shared token that setup generates.
- **The web page** is reachable from your home network and can change settings. Set the `SKYAI_UI_PASSWORD` environment variable to require a password. Do not expose it to the internet.

## What testing found

Every item below was a real failure seen on the real server and then fixed:

1. Liquids placed by script did not flow; the generator made cobblestone in the wrong cell.
2. The AI walked into the generator trench to fetch a drop and died in the lava. Routes now avoid lava, and the generator has a standing spot from which drops are in pick-up range.
3. Drops one block below the player's feet are not picked up; it now stands level with the drop.
4. After dying, the old player lingered and the saved inventory was restored on top of the dropped items. Death now empties the saved inventory and the player is re-created cleanly.
5. Stopping the host script left the Minecraft server running when the terminal's input was closed.

## Known limits

- **Version coupling.** Simulated players and script HTTP are "Beta APIs". The server must match the phone's Minecraft version, and the add-on must name that version's API. `npm run setup -- --accept-eula --update` handles both, but Mojang can change beta APIs in any release, which may require code changes here.
- **Not a network client.** See the table above. If Mojang removed simulated players, the fallback would be the protocol-client approach.
- **Actions not built yet:** buckets, farming, smelting, fighting, eating. The model is told this and says so when asked.
- **One AI player, one island, the overworld only.**
- **Local models** must support tool calling, and small ones may plan poorly. Not tested here.
- **One unexplained test failure.** Across 12 full runs of the milestone test on the real server, 11 passed every check. In one run the check "after the human said no, the block was left alone" failed and could not be reproduced; the test now prints what the AI saw when that check fails, so a repeat can be diagnosed.

## Roadmap toward autonomous progression

1. **Verify on your setup:** join from the iPhone, chat round trip, `npm run verify -- --live` with Claude and with a local model.
2. **Finish the player's abilities,** each with a check in `verify`: buckets and ice (to build a generator from the classic kit), hoe, seeds and bone meal, furnace use, eating, fighting.
3. **Routines in code,** like the generator harvest: tree cycle (cut, collect saplings, replant), platform and bridge building, crop harvest and replant.
4. **Progression planner:** the classic challenge list as explicit goals with completion checks read from the world, so "play by yourself" has verifiable milestones instead of free-form play.
5. **Better teamwork:** follow the player, hand over items, a shared task list on the web page, a spoken summary when you join.
6. **Hardening:** automatic server updates, backups of the world before risky approved actions, a second island or the Nether.
