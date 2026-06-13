# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the game

This project is a single `index.html` file with no build step. Because it uses ES module importmaps, it **must be served over HTTP** (not opened directly as `file://`):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Architecture

Everything lives in `index.html` — HTML structure, inline `<style>`, an importmap, and a single `<script type="module">`. There is no bundler, no npm, no build output.

**Three.js (0.184.0) via importmap/CDN (unpkg)**
- `three` → `three.module.js` (core)
- `three/addons/` → `examples/jsm/` (EffectComposer, RenderPass, UnrealBloomPass, Timer)

**Rendering pipeline**
`WebGLRenderer` → `EffectComposer` with `RenderPass` + `UnrealBloomPass` (synthwave glow). Camera is a fixed `PerspectiveCamera` at an isometric angle above the board.

**Game logic (all in the script)**
- `GRID = 17` — board size in cells; `cellToWorld(x, z)` maps grid coords to Three.js world space.
- Snake state: `snake[]` array of `{x, z}` objects (index 0 = head), plus `direction` / `nextDirection` for the input buffer.
- Discrete tick loop: time is accumulated with `Timer`; each `tickInterval` ms a `step()` is called. `tickInterval` starts at 220 ms and decreases by 3 ms per point (floor: 90 ms).
- Visual interpolation: `prevPos[]` stores world positions before each step; meshes lerp between `prevPos` and the new target within the tick window for smooth movement.
- Game states: `'ready'` → `'playing'` → `'gameover'`, controlled via the `state` variable that gates the tick and the overlay visibility.
- High score persisted in `localStorage` under key `neonSnakeBest`.

**Key constants to tweak**
| Constant | Default | Purpose |
|---|---|---|
| `GRID` | 17 | Board size (N×N) |
| `BASE_TICK` | 220 ms | Starting speed |
| `MIN_TICK` | 90 ms | Maximum speed |
| `bloom strength` | 0.9 | Glow intensity |
