# Co-op design

Multiplayer used to be a *spectator* system. Plot state was broadcast so the farm
"stayed visually in sync", but the farm was the only shared thing — every player
had their own gold, and every action paid out locally. Two consequences:

- **Harvest capture.** Till → water → plant is three actions of labour; harvest is
  one action and banked 100% of the value. You could farm a field your partner
  planted and they got nothing.
- **Shared debt, private gold.** The weekly bill was broadcast to everyone, but
  `payDebt` spent only the local wallet. Whoever paid quietly subsidised the rest.

Plus quest rewards paid locally while `completedQuests` synced, so a partner
completing a shared quest pocketed the reward *and* deleted it from your list.

## The rule now

**Single player is unchanged.** Every system here is inert unless a partner is
actually connected (`coopActive()`). Solo keeps one wallet, solo-speed work and
the same numbers it always had. The only thing solo gains is a crew role.

In co-op the split follows ownership:

| Income | Goes to |
| --- | --- |
| Crops, ranch produce, chest sales, quest + contract rewards, farm windfalls | **Team purse** |
| Mining, fishing, foraging, salvage, loot, treasure, bounties | **Your wallet** |

Farm expenses — the weekly bill, upgrades, seed — draw the purse first, then your
own pocket. So the bill is a goal you sweat together, and buying a scythe is the
farm investing in itself.

## The purse is derived, not stored

`farmLedger` holds `{ earned, paid }` per player. Both only ever go up, so peers
merge by taking the higher of each and every client converges on the same balance
regardless of packet order — no central authority, and no lost income when two
players sell at the same moment. `farmFundBalance()` is `Σ earned − Σ paid`.

The ledger doubles as the fix for invisible contribution: click the 🌾 pill to see
who paid in what. (`sharedStats` still ratchets by max because shared quest
progress depends on it; the ledger is the per-player record.)

The purse is session-only. On disconnect or on loading a save, whatever is left
folds into your wallet (`settleFarmFund`), so nothing is ever stranded.

## Crew roles — `[C]`

Soft specialisation. No hard locks, swappable any time, available in single
player. In co-op, a crew whose roles are **all different** earns +10% farm income,
so splitting the work beats both of you doing the same job.

| Role | Effect |
| --- | --- |
| Grower | `roleGrowMult` 1.18 (higher = faster), 25% chance of +1 crop |
| Hauler | +35% carry, +10% speed, −20% stamina on gathers |
| Trader | +12% sell, −10% seed cost |
| Prospector | −25% gather time, 30% chance of +1 loot |

Tune these in `CREW_ROLES` and the `role*()` helpers.

## Teamwork

Heavy jobs (stone, wood) run at `teamworkMult()` = 0.55 duration and +1 yield when
another player is within `TEAMWORK_RADIUS` (96px, ~3 tiles) in the same zone. This
is a **bonus for working together, never a penalty for playing alone** — solo
timings are untouched, which is why co-op speeds up rather than solo slowing down.

Plots record who worked them (`noteTend` on till/water/plant). A crop tended by
someone other than the harvester pays a +2 team bonus and says so.
