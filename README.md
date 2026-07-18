# Hyacinths

A small 2D terrain-shaping game. Walk a 16x16 pixel character around an HTML5 Canvas with WASD, and type natural-language commands ("create grass", "carve a river", "turn desert into forest") into the top bar. A local Node server sends the command to Gemini, which replies with strict JSON generation parameters; the client-side noise engine grows the terrain outward from the character frame-by-frame.

The world is infinite: the camera always follows the character, keeping it centered on screen while the terrain scrolls beneath it, so charX/charY can be any integer, positive or negative. Outside generated terrain lies an empty white void — you can only wander a short distance into it before being stopped, so you have to create terrain with commands to travel further. Forests spawn dense micro-trees that the player walks through rather than around, with depth sorting so trees in front of the player (lower on screen) draw over them and trees behind (higher on screen) draw underneath.

## Setup

```
npm install
copy .env.example .env    # then paste your Gemini API key into .env
npm run dev
```

Open http://localhost:5173.

Without an API key the server falls back to a simple offline keyword parser, so the game still works — notifications are tagged `[offline mode]`.

## Structure

- `server/index.js` — Express server: POST `/api/terrain` forwards `{command, charX, charY}` to Gemini with the system prompt in `server/systemPrompt.js`, sanitizes the JSON reply, and falls back to offline parsing on error.
- `src/game/engine.js` — canvas engine: WASD movement, sprite animation, tile grid, seeded-noise blob growth, and Catmull-Rom river carving.
- `src/App.jsx` — command bar, notifications, and fetch to the server.
- `assets/` — `everything.png` (idle frame) and `everything_walks.png` (two walk frames).
