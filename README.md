[![best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/c/best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/musemosmouses/makefun-flight-game/rank.svg)](https://make.fun/c/best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/musemosmouses/makefun-flight-game/reward.svg)](https://make.fun/c/best-flight-game-20261126-0057)

# Skyhook Valley — Bush Plane Ring Run

A complete, original flight game that runs offline in a desktop browser from
static files. Take off from a dirt strip in a seeded valley, thread **12 glowing
rings** — low over the lake, through the canyon gap, around the peak — then land
back on the runway before fuel or time runs out.

## What you fly

- **12 rings** in a fixed course, each +100 pts and +6 s
- **6 live instruments**: attitude indicator, airspeed + altitude tapes, compass
  heading, vertical speed, fuel and hull gauges, throttle lever
- **2 cameras**: chase and cockpit (C), with a full panel in cockpit view
- **Fuel + hull**: fuel burns with throttle and only refuels on the runway;
  hard landings cost hull, a crash ends the sortie
- **Wind gusts** (seeded), stall below 47 kt, flaps, brakes, ground handling
- **Valley map** (minimap), next-ring arrow + distance, sortie timer and score
- **Synth audio**: engine drone, wind, ring chime, stall horn — no audio files

## Controls

| Key | Action |
| --- | --- |
| W / S | Throttle up / down |
| ↑ / ↓ | Pitch (climb / descend) |
| ← / → or A / D | Bank and turn |
| Q / E | Rudder |
| F | Flaps |
| B | Brakes |
| C | Chase / cockpit camera |
| P | Pause |
| R | Restart sortie |
| M | Mute |
| Mouse drag | Steer |

## Play

```sh
# serve game/ with any static server, then open it in desktop Chrome
python3 -m http.server 8080 --directory game
# or: node serve via the repo root
```

No build step, no network at runtime: every file the game loads lives under
`game/`. The world (terrain, lake, runway, rings, weather) is seeded, so every
run flies the same valley.

## Entry layout

- `main.ts` — the entry program (Node 22): copies `game/` + `screenshots/` to
  `/output` and writes `dossier.json` via `vendor/makefun-game.ts`
- `game/` — the playable game (`index.html` + `src/*.js`, custom WebGL, no library)
- `screenshots/` — 4 real renders of the game, staged deterministically with
  `?shot=cover|cockpit|takeoff|rings`
- `vendor/makefun-game.ts` — the kit's dossier library, unchanged

Built for the [best-flight-game-20261126-0057](https://make.fun/c/best-flight-game-20261126-0057)
bounty on [make.fun](https://make.fun).
