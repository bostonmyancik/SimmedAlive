# Life sim

Evolving species competing for food, water, and territory on a map with terrain and drifting weather. Lineages that drift far enough split into new species, and a food web forms between plant-eaters, meat-eaters and scavengers.

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
  - Select inspects the creature or base you click.
  - Food scatters plants as you drag.
  - Terrain paints water, fertile land, plain, desert or mountain.
  - Warm and Cool change the temperature of an area; the change fades over a few thousand ticks.
  - Meteor strikes where you click: everything in the circle dies and the land is scorched.
  - With a brush tool active, pan by dragging with the right or middle button, or with two fingers.
- **Layers** (top of the map): terrain (fertile land, plain, desert, mountains), temperature, fertility (how readily food grows), or territory (which species dominates each area).
- **On the map**: green dots are plants, crosses are carcasses, a blue ring means thirsty, and a bigger body means stronger. Mountains and water block movement. A tent, fort or castle in a species' colour is one of its bases: the shaded circle is the ground it shelters, a dashed green ring marks its fields, the green bar is its food store and a red bar appears when its walls are damaged. A dot on a creature's back is food it is carrying home.
- **Sidebar tabs**: Species (every living species; click a card's header to fold it down to its name and population, or use Collapse all), Inspector (the selected creature, its ancestry, and a Follow button), Charts (population or any trait over time, plus the species family tree; "Open in a window" or "Expand here" shows every chart at once, large, with a readout of each species' value under the pointer), Events (the log) and Settings. On a narrow screen the sidebar is a sheet at the bottom; tap a tab to open it.
- **Timeline** (across the bottom): each species' share of the population over the last 16,000 ticks, with marks for new species, extinctions, booms, crashes and disasters. Hover to read the tick and any event there. Drag it to rewind: the world jumps back to that moment and pauses. You can scrub back and forth, or press "Back to now". Pressing Resume, or changing the world, continues from where you are and drops what came after. Rewinding reaches back to the start of the timeline, or to when the page was last loaded if that is more recent.
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
- `static/sim/`: the simulation. No page code, so it also runs under Node.
  - `params.js`: every tuning value (species traits, balance settings, fixed rules).
  - `sim.js`: world generation and the per-tick rules. Start reading here.
  - `world.js`: map size, lakes, terrain, distance to water, temperature.
  - `creatures.js`: starting creatures and mutated offspring.
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
- **Diet.** Every creature has a `diet` from 0 (plants only) to 1 (meat only). A plant is worth less the more meat is in the diet, and a carcass is worth more. Every death leaves a carcass that rots after a while. Meat-eaters bite harder and hunt weaker species when hungry.
- **Swimming.** A share of creatures (20% by default, set in Settings) are born able to swim. Swimmers cross water, more slowly and at an energy cost, and reach the plants that grow in it; everyone else goes around. Swimming is a matter of chance at birth, not inherited.
- **Getting around obstacles.** A creature blocked by water or mountains slides along the edge and holds that course for a while before heading for its target again, so it works its way round instead of pacing in front of it. A creature caught under newly painted water or mountains can always walk out.
- **Speciation.** Traits mutate at each birth. A newborn that has drifted too far from its species' founder joins a closely related species it resembles, or founds a new one. A species and the one it split from do not fight; all other species do. A new species is announced once it has 10 members.
- **Bases.** A species builds a camp once it has 120 members, a second at 240 and a third at 360, never more than three. A camp goes where plenty of its members live, in a climate they like, and no closer than 150 pixels to any other base. It grows steadily, becoming a fort and, after a full year, a castle; along the way the number of creatures it shelters rises from 6 to 30, its food store from 20 meals to 80, and its walls get stronger.
  - *Shelter.* Members standing at their base, up to as many as it holds, are spared 10 degrees of cold and take half damage. In the cold, members head for a base that has room and stay there.
  - *Storing food.* A well-fed member near a base carries the food it finds home instead of eating it, until the store is full. Hungry members eat from the store. A species that hoards grows more slowly at first but has a reserve for droughts and winters.
  - *Farming.* A fort or castle may take up farming (on average after about half a year); plants then sprout in the fields around it.
  - *Newcomers.* Every 2,500 ticks a base whose walls are at half strength or better raises new members of its species there: one at a camp, rising to three at a castle. Each takes after a living member picked at random. A damaged base raises none until it is repaired.
  - *Attack.* Hungry creatures that see an enemy base with food in it go for it, and any creature at the middle of an enemy base tears at its walls. The walls only give way once nobody is sheltering inside, so attackers have to kill or drive off the defenders first. A base that falls spills its store on the ground for anyone to eat. Walls are repaired when left alone for a while.
  - *Defence.* When an enemy comes within 45 pixels of a base, every member within 320 pixels that is not thirsty goes for it, however strong it is. Each base also keeps a garrison of up to half the number it can shelter: members with nothing else to do go and stand in it, and while on guard they leave food lying unless they are hungry.
  - *Loss.* A base nobody has sheltered in for 3,000 ticks, or whose species has died out, passes to a closely related species (one that split from the owners, or the one they split from) that has members nearby and fewer than three bases; if there is none, it is lost. A base is also lost if a meteor hits it, or if water or mountains are painted over it.
- **Events.** The sim logs bases built, grown, farmed and lost, new species, extinctions, booms and crashes (a population doubling or halving between checks), and every disaster.
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
| `fleeDistance` | Distance at which a creature flees a much stronger one |
| `strengthUpkeep` | Energy upkeep cost of strength |
| `stressCost` | Energy cost per degree of temperature stress |
| `maxBreedingStress` | Max stress at which a creature can still reproduce |
| `tempMutationScale` | How fast preferred temperature mutates |
| `swimmerShare` | Chance that a creature is born able to swim |
| `autoDisasters` | Whether disasters strike by themselves (the "Random disasters" switch) |
| `autoDisasterEvery` | Average ticks between random disasters |
| `speciationDistance` | How far traits must drift from a species' founder before a lineage splits off |
| `basePopulation` | Members a species needs for each base it holds |
| `maxBases` | Most bases one species can hold (0 turns bases off) |
| `farmChance` | Chance, every 100 ticks, that a fort or castle takes up farming |

Less commonly changed rules (energy from plants and carcasses, terrain fertility, population cap, lifespan, trait limits, the cap on living species, disaster strengths, and the sizes, ranges and thresholds for bases) are in `RULES` in the same file.
