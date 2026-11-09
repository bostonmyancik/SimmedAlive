# Life sim

Three evolving species competing for food, water, and territory on a map with drifting weather.

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

- Click the map to drop food.
- Space pauses and resumes.
- "New world" generates new lakes and weather fronts from a new seed.
- The current seed is shown under the map. Open `http://127.0.0.1:5000/?seed=123` to start from a particular world.

## Where things live

- `app.py`: the Flask server (one route).
- `templates/index.html`: page layout and styles.
- `static/ui.js`: drawing, controls, and the animation loop.
- `static/sim/`: the simulation. No page code, so it also runs under Node.
  - `params.js`: every tuning value (species traits, balance settings, fixed rules).
  - `sim.js`: world generation and the per-tick rules. Start reading here.
  - `world.js`: map size, lakes, distance to water, temperature.
  - `creatures.js`: starting creatures and mutated offspring.
  - `grid.js`: fast "nearest thing" lookups.
  - `rng.js`: seeded random numbers.
- `tests/`: Node tests for the simulation.

## Tests

Needs Node 20 or newer; there is nothing to install.

```bash
npm test
```

## Tuning

All values are in `static/sim/params.js`.

Species starting traits are the `SPECIES` array (`speed`, `vision`, `strength`, `preferredTemp`).

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
| `huntEnergy` | Energy below which a creature will hunt weaker species |
| `fleeDistance` | Distance at which a creature flees a much stronger one |
| `strengthUpkeep` | Energy upkeep cost of strength |
| `stressCost` | Energy cost per degree of temperature stress |
| `maxBreedingStress` | Max stress at which a creature can still reproduce |
| `tempMutationScale` | How fast preferred temperature mutates |

Less commonly changed rules (energy from food, population cap, lifespan, trait limits) are in `RULES` in the same file.
