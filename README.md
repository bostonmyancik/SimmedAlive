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
  - Select inspects the creature you click.
  - Food scatters plants as you drag.
  - Terrain paints water, fertile land, plain, desert or mountain.
  - Warm and Cool change the temperature of an area; the change fades over a few thousand ticks.
  - Meteor strikes where you click: everything in the circle dies and the land is scorched.
  - With a brush tool active, pan by dragging with the right or middle button, or with two fingers.
- **Layers** (top of the map): terrain (fertile land, plain, desert, mountains), temperature, fertility (how readily food grows), or territory (which species dominates each area).
- **On the map**: green dots are plants, crosses are carcasses, a blue ring means thirsty, and a bigger body means stronger. Mountains and water block movement.
- **Sidebar tabs**: Species (every living species; click a card's header to fold it down to its name and population, or use Collapse all), Inspector (the selected creature, its ancestry, and a Follow button), Charts (population or any trait over time, plus the species family tree), Events (the log) and Settings. On a narrow screen the sidebar is a sheet at the bottom; tap a tab to open it.
- **Timeline** (across the bottom): each species' share of the population over the last 16,000 ticks, with marks for new species, extinctions, booms, crashes and disasters. Hover to read the tick and any event there. Drag it to rewind: the world jumps back to that moment and pauses. You can scrub back and forth, or press "Back to now". Pressing Resume, or changing the world, continues from where you are and drops what came after. Rewinding reaches back to the start of the timeline, or to when the page was last loaded if that is more recent.
- **Bottom bar**: pause (or Space), speed, and the tick, year and season.
- **Settings**: food supply, mutation rate, the share born able to swim, disasters (heat wave, cold snap, drought, plague), the world seed, and saved worlds. The running world is autosaved every five seconds and picked up again when the page loads, so a refresh or restart loses at most a few seconds. You can also save worlds under a name and load or delete them later. A loaded world carries on exactly where it left off, charts included. "New world" picks a new seed; the same seed always builds the same world, and the address bar (`/?seed=123`) can be shared. Opening an address whose seed differs from the autosave starts that world fresh.

## Where things live

- `app.py`: the Flask server: the page and the saved-worlds API (`/api/saves`).
- `storage.py`: saved worlds in a SQLite file, `data/lifesim.db` by default. Set the `LIFESIM_DB` environment variable to put it elsewhere. This is the one module to replace if the app ever moves to a hosted database.
- `templates/index.html`: page layout and styles.
- `static/ui/`: the page.
  - `main.js`: animation loop, tools, panels and bottom bar. Start reading here.
  - `camera.js`: zoom and pan.
  - `mapview.js`: draws the world and the map layers.
  - `charts.js`: the line chart, the family tree and the timeline strip.
  - `saves.js`: calls the saved-worlds API.
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
- **Events.** The sim logs new species, extinctions, booms and crashes (a population doubling or halving between checks), and every disaster.
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
| `speciationDistance` | How far traits must drift from a species' founder before a lineage splits off |

Less commonly changed rules (energy from plants and carcasses, terrain fertility, population cap, lifespan, trait limits, the cap on living species, disaster strengths) are in `RULES` in the same file.
