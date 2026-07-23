# Hyacinths

A 2D terrain-shaping game where you walk a 16x16 pixel character across an infinite procedural world. Use **WASD** to move (character stays centered; world scrolls beneath you), and type natural-language terrain commands into the top bar to shape your surroundings. The AI (Gemini by default) replies with generation parameters; the client-side noise engine grows terrain frame-by-frame from your current position.

The world is infinite, but you're bounded: you can only wander ~300 pixels into the white void beyond solid ground, forcing you to shape terrain with commands to explore further. **Zoom** with the mouse wheel, `+`/`−` keys, or on-screen buttons (bottom right, ~0.35x to 2.5x). **Undo** (↶ button) reverts up to 10 generations.

### Terrain & Biomes

Nine biomes grow from your commands: **grass** (green base), **desert** (tan, sparse cacti), **forest** (dense walk-through micro-trees with depth sorting), **savannah** (golden, acacia trees), **mountain** (gray rock, snow-capped peaks), **tundra** (snow; auto-freezes water into walkable ice), **river** (adjustable width, auto-connects nearby water), **lake** (small water blob), and **ocean** (huge swimmable water). Water sprites are distinct from land; borders blend organically except water/ice (crisp edges).

### Wildlife (predator–prey)

Toggle **animals** on and two little ecosystems come alive, each confined to its biome. **Savanna:** lions hunt zebras — a lion ambles and searches, then sprints when a zebra strays within reach; zebras graze with long pauses and bolt (faster than any lion) the moment one gets close, running until it's well clear. **Forest:** wolves hunt deer the same way, and roam in **packs** — wandering wolves that meet up travel together, peeling off only to chase their own prey. **Bears hunt the wolves:** one or two wolves flee a pursuing bear, but a pack of three or more turns and brawls it, after which two wolves and the bear fall and respawn elsewhere. Bears and deer ignore each other. Caught prey respawns elsewhere in its biome; animals that end up off their home biome (e.g. terrain repainted under them) despawn. Everything bounces as it moves, spawns on-screen, and appears in the shared world image. The whole sim is deliberately cheap — small capped herds updated on a coarse "think" tick with squared-distance math, not per-frame.

Animals start **off**. Toggle them with the switch in the right-side wildlife panel, by asking the AI (`"add animals"`, `"remove the wildlife"`), or with the `/animal` function.

### Commands, Functions & Confirmation

Type commands as natural language: `"create grass"`, `"carve a river"`, `"turn desert into forest"`. A single command can ask for several features at once — `"a desert and an ocean together"` builds both. Type **`/`** in the bar to see the available **functions**: `/overwrite` (force new terrain to replace what exists), `/cloud` (toggle clouds), and `/animal` (toggle wildlife). Otherwise, when the AI decides an action would overwrite existing terrain, a glass popup asks for confirmation (Enter/yes to proceed, Backspace/Delete/no to cancel). Rivers may also first ask `"connect to nearby river?"` the same way. Prompting is locked while terrain animates.

### AI Awareness

Each command also sends the AI a text-grid snapshot of the world around you — a 120x64 character map (`'.'` void, `'G'` grass, `'D'` desert, `'F'` forest, `'R'` river/lake, `'T'` tundra, `'I'` ice, `'O'` ocean, `'S'` savannah, `'M'` mountains, `'P'` player) plus world-coordinate origin, so it places terrain relative to what already exists. It is not an image — just text rows.

### Providers & Fallback

**Gemini** is the primary provider. If you set `GROQ_API_KEY`, **Groq** serves as fallback. Without an API key, an offline keyword parser activates as the last resort (tagged `[offline mode]` in notifications). Full API errors surface in the toast.

## Setup

```
npm install
copy .env.example .env    # then paste your Gemini API key into .env
npm run dev
```

Open http://localhost:5173.

Without an API key the server falls back to a simple offline keyword parser, so the game still works — notifications are tagged `[offline mode]`.

## Structure

- `server/index.js` — Express server: POST `/api/terrain` forwards `{command, charX, charY, map}` to Gemini with system prompt in `server/systemPrompt.js`; sanitizes the JSON reply (a single action or an array of them) and falls back to offline parsing on error.
- `src/game/engine.js` — canvas engine: WASD movement, sprite animation, tile grid, seeded-noise blob growth, Catmull-Rom river carving, zoom, undo stack (10 steps), and the wildlife predator–prey sim.
- `src/App.jsx` — command bar, `/` function menu, toast + transient tips, wildlife panel, undo/zoom/share controls, and server fetch.
- `assets/` — character sprites; `assets/nature_pack/` — terrain sprites (tree, acacia, cactus, mountain, snowtree) and animals (`savanna/lion`, `savanna/zebra`, `forest/wolf`, `forest/deer`, `forest/bear`). Any PNG under `nature_pack/**` auto-loads, grouped by name.
