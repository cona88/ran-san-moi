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
- Fixed coordinate space `MAX_GRID = 25`; `cellToWorld(x, z)` centers cells on the origin using the constant `HALF`, so cell coords never need remapping when the arena resizes.
- **Dynamic arena**: `arenaMargin` is how many cells are walled off on each side. `buildArena()` disposes and rebuilds the floor/grid/frame meshes at the current `activeSize()` (= `MAX_GRID - 2*arenaMargin`), centered at origin. Every `SHRINK_EVERY` (10) foods the margin grows by 1 (walls close in), up to `MAX_MARGIN`. Wall-collision bounds and `placeFood()` both read the live margin.
- Snake state: `snake[]` array of `{x, z}` objects (index 0 = head), plus `direction` / `nextDirection` for the input buffer. The head mesh is scaled up (1.25) so the thinner body still reads clearly.
- Discrete tick loop: time accumulated with `THREE.Clock`; each `tickInterval` ms a `step()` runs. `tickInterval` starts at `BASE_TICK` and decreases by `TICK_STEP` ms per point (floor: `MIN_TICK`).
- Visual interpolation: `prevPos[]` stores world positions before each step; meshes lerp between `prevPos` and the new target within the tick window for smooth movement.
- Game states: `'ready'` → `'playing'` → `'gameover'`, controlled via the `state` variable that gates the tick and the overlay visibility.
- High score persisted in `localStorage` under key `neonSnakeBest`.
- **Init order matters**: `resetGame()` (which calls `buildArena()`) must run before `animate()`, since the render loop reads `frame`. Don't reintroduce the `Timer` addon import — `three/addons/misc/Timer.js` is a 404 on the pinned CDN version and a failed ES import silently kills the whole module (no canvas, no key listeners).

**Key constants to tweak**
| Constant | Default | Purpose |
|---|---|---|
| `MAX_GRID` | 25 | Fixed coordinate space / max board extent |
| `START_MARGIN` | 2 | Initial walled-off cells per side (→ 21×21 arena) |
| `MAX_MARGIN` | 8 | Tightest arena (→ 9×9) |
| `SHRINK_EVERY` | 10 | Foods between each wall closing |
| `BASE_TICK` | 300 ms | Starting speed |
| `MIN_TICK` | 80 ms | Maximum speed |
| `TICK_STEP` | 4 ms | Speed-up per food eaten |
| `bloom strength` | 0.9 | Glow intensity |
