# Hyacinths

A 2D terrain-shaping game where you walk a 16x16 pixel character across an infinite procedural world. Use **WASD** to move (character stays centered; world scrolls beneath you), and type natural-language terrain commands into the top bar to shape your surroundings. The AI (Gemini by default) replies with generation parameters; the client-side noise engine grows terrain frame-by-frame from your current position.

The world is infinite, but you're bounded: you can only wander ~300 pixels into the white void beyond solid ground, forcing you to shape terrain with commands to explore further. **Zoom** with the mouse wheel, `+`/`−` keys, or on-screen buttons (bottom right, ~0.35x to 2.5x). **Undo** (↶ button) reverts up to 10 generations.

### Terrain & Biomes

Nine biomes grow from your commands: **grass** (green base), **desert** (tan, sparse cacti), **forest** (dense walk-through micro-trees with depth sorting), **savannah** (golden, acacia trees), **mountain** (gray rock, snow-capped peaks), **tundra** (snow; auto-freezes water into walkable ice), **river** (adjustable width, auto-connects nearby water), **lake** (small water blob), and **ocean** (huge swimmable water). Water sprites are distinct from land; borders blend organically except water/ice (crisp edges).

### Commands & Confirmation

Type commands as natural language: `"create grass"`, `"carve a river"`, `"turn desert into forest"`. Append `/overwrite` anywhere in a command to force replacement without confirmation. Otherwise, when the AI decides an action would overwrite existing terrain, a glass popup asks for confirmation (Enter/yes to proceed, Backspace/Delete/no to cancel). Rivers may also first ask `"connect to nearby river?"` the same way. Prompting is locked while terrain animates.

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

- `server/index.js` — Express server: POST `/api/terrain` forwards `{command, charX, charY, worldGrid, gridOriginX, gridOriginY}` to Gemini with system prompt in `server/systemPrompt.js`; sanitizes JSON reply and falls back to offline parsing on error.
- `src/game/engine.js` — canvas engine: WASD movement, sprite animation, tile grid, seeded-noise blob growth, Catmull-Rom river carving, zoom, and undo stack (10 steps).
- `src/App.jsx` — command bar, toast notifications, undo button, zoom controls, and server fetch.
- `assets/` — character sprites; `assets/nature_pack/` — terrain sprites (tree, acacia, cactus, mountain, snowtree).
