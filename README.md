# Life sim

Three evolving species competing for food, water, and territory on a map with drifting weather.

## Run it

```bash
cd lifesim
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

Open http://127.0.0.1:5000 in a browser. Stop the server with Ctrl+C.

After the first setup, starting it again is just:

```bash
cd lifesim && source .venv/bin/activate && python3 app.py
```

## Controls

- Click the map to drop food.
- Space pauses and resumes.
- "New world" generates new lakes and weather fronts.

## Where things live

- `app.py`: the Flask server (one route).
- `templates/index.html`: page layout and styles.
- `static/core.js`: the simulation rules. No DOM code, so it also runs under Node for testing.
- `static/ui.js`: drawing, controls, and the animation loop. The tuning constants (`makeSim.P`) are at the top.

## Tuning

Species starting traits are the `SP` array near the top of `core.js`
(`sp` speed, `se` vision, `st` strength, `tp` preferred temperature).

The constants in `makeSim.P` in `ui.js`:

| Key | Meaning |
|---|---|
| `TOL` | Degrees from preferred temperature a creature tolerates before stress |
| `grad` | North-south temperature spread (plus or minus this around 18°C) |
| `sea` | Size of the seasonal swing |
| `fa` | Strength of the hot and cold fronts |
| `fm` | Food growth multiplier |
| `dmg` | Combat damage per tick per point of strength |
| `away` | Damage multiplier when fighting outside your climate |
| `hun` | Energy below which a creature will hunt weaker species |
| `fl` | Distance at which a creature flees a much stronger one |
| `stc` | Energy upkeep cost of strength |
| `exc` | Energy cost per degree of temperature stress |
| `rex` | Max stress at which a creature can still reproduce |
| `tpk` | How fast preferred temperature mutates |
