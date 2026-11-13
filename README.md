# Life sim

Evolving species competing for food, water, and territory on a map with terrain and drifting weather. Whole species evolve over time, lineages that drift far enough split into new species, a rare few gain special abilities, and a food web forms between plant-eaters, meat-eaters and scavengers.

## Run it

From the project folder:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

Open http://127.0.0.1:5000 in a browser. Stop the server with Ctrl+C.

After the first setup, starting it again is just:

```bash
source .venv/bin/activate && python3 app.py
```

## Controls

- **Map**: drag to pan (the world wraps around east-west), scroll or pinch to zoom, or use the + / − / Fit buttons.
- **Tools** (left rail, keys `1` to `6`):
  - Select inspects the creature you click.
  - Food scatters plants as you drag.
  - Terrain paints water, fertile land, plain, desert or mountain.
  - Warm and Cool change the temperature of an area; the change fades over a few thousand ticks.
  - Meteor strikes where you click: everything in the circle dies and the land is scorched.
  - With a brush tool active, pan by dragging with the right or middle button, or with two fingers.
- **Layers** (top of the map): terrain (fertile land, plain, desert, mountains), temperature, fertility (how readily food grows), or territory (which species dominates each area).
- **On the map**: green dots are plants, crosses are carcasses, a blue ring means thirsty, and a bigger body means stronger. Mountains and water block movement.
- **Sidebar tabs**: Species (every living species; click a card's header to fold it down to its name and population, or use Collapse all), Inspector (the selected creature, its ancestry, and a Follow button), Charts (population or any trait over time, plus the species family tree; "Open in a window" or "Expand here" shows every chart at once, large, with a readout of each species' value under the pointer), Events (the log) and Settings. On a narrow screen the sidebar is a sheet at the bottom; tap a tab to open it.
- **Timeline** (across the bottom): each species' share of the population over the last 16,000 ticks, with marks for new species, extinctions, booms, crashes and disasters. Hover to read the tick and any event there. Drag it to rewind: the world jumps back to that moment and pauses. You can scrub back and forth, or press "Back to now". Pressing Resume, or changing the world, continues from where you are and drops what came after. Rewinding reaches back to the start of the timeline, or to when the page was last loaded if that is more recent.
- **Pop-up alerts**: as the world runs, events pop up in the top-right corner of the map (at most three at a time; a burst shows the newest with a count of the rest). Each fades after six seconds; click one to open the Events tab, or × to dismiss it. In Settings under "Notifications", switch them off altogether or choose which kinds pop up: new species, extinctions, booms and crashes, evolution stages, abilities spreading or lost, newborns gaining an ability (off by default, as it is frequent), heat, cold and droughts, and plagues and meteors. Only events from the running world pop up, not ones you cause with the disaster buttons or pass while rewinding. The choices are remembered by the browser.
- **Bottom bar**: pause (or Space), speed, and the tick, year and season.
- **Your own species** (Settings, "Founding species"): every new world starts with the species listed there. Change each one's name, colour, starting number, speed, strength, vision, preferred temperature and share of meat in its diet; add species (up to 8) or remove them; "Restore the originals" brings back the four the sim ships with. Numbers outside the allowed range are pulled back into it. The list is remembered by the browser and applies to the next new world, not the one running.
- **Your own map** (Settings, "Your own map"): "Start a blank map" gives open land with no water; "Clear and edit this map" keeps the present terrain but removes everything living. Either way the world waits, empty, while you paint it with the Terrain tool, and a bar on the map offers "Release the species" when you are ready. There must be some water with land beside it, since creatures need to drink. Each species starts in the band of latitude that suits its climate if there is room there, and anywhere livable otherwise. To keep a map, save the world under a name before or after releasing.
- **Settings**: food supply, mutation rate, the share born able to swim, disasters (heat wave, cold snap, drought, plague, and a "Random disasters" switch that lets them and meteors strike by themselves about once a year), the world seed, and saved worlds. The running world is autosaved every five seconds and picked up again when the page loads, so a refresh or restart loses at most a few seconds. You can also save worlds under a name and load or delete them later. A loaded world carries on exactly where it left off, charts included. "New world" picks a new seed; the same seed always builds the same world, and the address bar (`/?seed=123`) can be shared. Opening an address whose seed differs from the autosave starts that world fresh.

## Where things live

- `app.py`: the Flask server: the page and the saved-worlds API (`/api/saves`).
- `storage.py`: saved worlds in a SQLite file, `data/lifesim.db` by default. Set the `LIFESIM_DB` environment variable to put it elsewhere. This is the one module to replace if the app ever moves to a hosted database.
- `templates/index.html`: page layout and styles.
- `templates/charts.html`: the large charts view, shown in its own window or expanded over the page. It reads live data from the main page.
- `static/ui/`: the page.
  - `main.js`: animation loop, tools, panels and bottom bar. Start reading here.
  - `camera.js`: zoom and pan.
  - `mapview.js`: draws the world and the map layers.
  - `charts.js`: the line chart, the family tree and the timeline strip.
  - `saves.js`: calls the saved-worlds API.
  - `popout.js`: the large charts view.
  - `toasts.js`: pop-up alerts for events and which kinds to show.
- `static/sim/`: the simulation. No page code, so it also runs under Node.
  - `params.js`: every tuning value (species traits, balance settings, fixed rules).
  - `sim.js`: world generation and the per-tick rules. Start reading here.
  - `world.js`: map size, lakes, terrain, distance to water, temperature.
  - `creatures.js`: starting creatures and mutated offspring.
  - `abilities.js`: special abilities: which ones a creature can gain, inheriting them, and how strong they are.
  - `species.js`: trait distance between creatures and species, and names and colours for new species.
  - `grid.js`: fast "nearest thing" lookups.
  - `rng.js`: seeded random numbers.
  - `pack.js`: packs the map grids into text for saved worlds.
- `tests/`: Node tests for the simulation, and Python tests for the saved-worlds API.

## Tests

Needs Node 20 or newer; there is nothing to install.

```bash
npm test
```

The saved-worlds API has Python tests, which use a temporary database:

```bash
python3 -m unittest discover tests
```

## How the world works

- **Terrain.** Plants grow best on fertile land near water, poorly in desert, and not at all on mountains. A few grow in water. Mountains cannot be crossed, and water only by swimmers.
- **Diet.** Every creature has a `diet` from 0 (plants only) to 1 (meat only). A plant is worth less the more meat is in the diet, and a carcass is worth more. An in-between diet digests both kinds less well than a specialist, so a half-and-half eater gets about 44% of a plant or a carcass rather than half (`dietSpecialization`). That keeps mixed eaters from out-competing the hunters for carcasses. Every death leaves a carcass that rots after a while. Meat-eaters bite harder and hunt weaker species they see unless they are nearly full: a pure meat-eater hunts below 200 energy, which is above where it splits.
- **Swimming.** A share of creatures (20% by default, set in Settings) are born able to swim. Swimmers cross water, more slowly and at an energy cost, and reach the plants that grow in it; everyone else goes around. Swimming is a matter of chance at birth, not inherited.
- **Getting around obstacles.** A creature blocked by water or mountains slides along the edge and holds that course for a while before heading for its target again, so it works its way round instead of pacing in front of it. A creature caught under newly painted water or mountains can always walk out.
- **Size.** Strength makes a creature hit harder, but a heavier body is slower: each point of strength above 1 costs a quarter of its top speed, so a strength-3 creature moves at two thirds of its speed and a strength-5 one at half (`sizeSlowdown`). Small creatures can outrun big ones and reach food first, so a world keeps a mix of sizes instead of every species growing ever bigger.
- **Breeding.** A well-fed creature in its own climate splits in two, sharing its energy with the child. Small creatures need less energy to split and big ones more: 70 plus 30 for each point of strength, so a strength-1 creature splits above 100 and a strength-4 one above 190 (`breedEnergyBase` and `breedEnergyPerStrength` in `RULES`).
- **Evolution.** Every 2,000 ticks each established species shifts part of the way toward the average of its members, so a species changes as a whole instead of only ever splitting. When it has changed far enough since its last stage it reaches a new stage, which the event log describes ("faster, stronger and more meat-eating"). A stage takes much longer than a split; a species usually reaches one every 10,000 to 20,000 ticks.
- **Speciation.** Traits mutate at each birth. A newborn that has drifted too far from its species' current traits joins a closely related species it resembles, or founds a new one. A species and the one it split from do not fight; all other species do. A new species is announced once it has 10 members.
- **Special abilities.** A newborn rarely gains an ability (about 1 in 2,500 births at stage 1, more often at each later stage), and its offspring inherit it, though 1 in 100 loses it. Weak creatures can only gain the weak abilities and strong ones the weapons, and every ability is stronger in a stronger creature. Having one costs a little energy each tick, and each use costs energy and needs a rest before the next.
  - **Camouflage** (strength below 1.6): enemies only notice it within 12 pixels.
  - **Dash** (below 2.2): a burst of over twice its speed when fleeing.
  - **Spit** (1.3 and up): spits at an enemy out of reach. The spit flies and hits the first enemy in its path.
  - **Freeze** (1.9 and up): freezes every enemy around it, so they cannot move or fight for a while.
  - **Pull** (2.4 and up): drags a weaker enemy to it and holds it briefly.

  Creatures with an ability have a coloured dot in the middle, and frozen ones a white ring. Species cards show each ability's share. The log notes each newborn that gains one, and when an ability spreads through 40% of a species or falls below 10%. Switch abilities off in Settings.
- **Events.** The sim logs new species, evolution stages, abilities, extinctions, booms and crashes (a population doubling or halving between checks), and every disaster.
- **Disasters.** A drought cuts plant growth and raises thirst for 2,500 ticks. A plague kills about 60% of the most numerous species. A meteor kills everything within 90 pixels.

## Tuning

All values are in `static/sim/params.js`.

The founding species are the `SPECIES` array (`speed`, `vision`, `strength`, `preferredTemp`, `diet`).

The balance settings are `DEFAULT_PARAMS`:

| Key | Meaning |
|---|---|
| `tempTolerance` | Degrees from preferred temperature a creature tolerates before stress |
| `tempGradient` | North-south temperature spread (plus or minus this around 18°C) |
| `seasonSwing` | Size of the seasonal swing |
| `frontStrength` | Strength of the hot and cold fronts |
| `foodGrowth` | Food growth multiplier |
| `combatDamage` | Combat damage per tick per point of strength |
| `awayDamageFactor` | Damage multiplier when fighting outside your climate |
| `huntEnergy` | Energy below which a half-meat-eater hunts weaker species (scales with diet) |
| `dietDamageBonus` | Extra combat damage for meat-eaters |
| `dietSpecialization` | Above 1, in-between diets get less from both plants and meat |
| `fleeDistance` | Distance at which a creature flees a much stronger one |
| `strengthUpkeep` | Energy upkeep cost of strength |
| `sizeSlowdown` | Share of top speed lost per point of strength above 1 |
| `stressCost` | Energy cost per degree of temperature stress |
| `maxBreedingStress` | Max stress at which a creature can still reproduce |
| `tempMutationScale` | How fast preferred temperature mutates |
| `swimmerShare` | Chance that a creature is born able to swim |
| `autoDisasters` | Whether disasters strike by themselves (the "Random disasters" switch) |
| `autoDisasterEvery` | Average ticks between random disasters |
| `speciationDistance` | How far traits must drift from a species' current traits before a lineage splits off |
| `evolveEvery` | Ticks between each species shifting toward its members |
| `evolveRate` | Share of the gap between a species and its members closed each time |
| `evolveStep` | How far a species must change to reach a new stage |
| `abilities` | Whether creatures gain and use special abilities (the "Special abilities" switch) |
| `abilityChance` | Chance a newborn gains an ability, times its species' stage |

Less commonly changed rules (energy from plants and carcasses, terrain fertility, population cap, lifespan, trait limits, the cap on living species, disaster strengths, each ability's strength range, power and cooldown) are in `RULES` in the same file.
