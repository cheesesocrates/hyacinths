# Hyacinths

**Play it: [hyacinths.vercel.app](https://hyacinths.vercel.app)** (bring your own AI key, or play offline)

A 2D terrain-shaping game where you walk a 16x16 pixel character across an infinite procedural world. Use **WASD** to move (character stays centered; world scrolls beneath you), and type natural-language terrain commands into the top bar to shape your surroundings. An AI model (from whichever provider you bring a key for) replies with generation parameters; the client-side noise engine grows terrain frame-by-frame from your current position.

The world is infinite, but you're bounded: you can only wander ~300 pixels into the white void beyond solid ground, forcing you to shape terrain with commands to explore further. **Zoom** with the mouse wheel, `+`/`−` keys, or on-screen buttons (bottom right, ~0.35x to 2.5x). **Undo** (↶ button) reverts up to 10 generations.

### Terrain & Biomes

Nine biomes grow from your commands: **grass** (green base), **desert** (tan, sparse cacti), **forest** (dense walk-through micro-trees with depth sorting), **savannah** (golden, acacia trees), **mountain** (gray rock, snow-capped peaks), **tundra** (snow; auto-freezes water into walkable ice), **river** (adjustable width, auto-connects nearby water), **lake** (small water blob), and **ocean** (huge swimmable water). Water sprites are distinct from land; borders blend organically except water/ice (crisp edges).

### Wildlife (predator–prey)

Toggle **animals** on and two little ecosystems come alive, each confined to its biome. **Savanna:** lions hunt zebras — a lion ambles and searches, then sprints when a zebra strays within reach; zebras graze with long pauses and bolt (faster than any lion) the moment one gets close, running until it's well clear. **Forest:** wolves hunt deer the same way, and roam in **packs** — wandering wolves that meet up travel together, peeling off only to chase their own prey. **Bears hunt the wolves:** one or two wolves flee a pursuing bear, but a pack of three or more turns and brawls it, after which two wolves and the bear fall and respawn elsewhere. Bears and deer ignore each other. Caught prey respawns elsewhere in its biome; animals that end up off their home biome (e.g. terrain repainted under them) despawn. Everything bounces as it moves, spawns on-screen, and appears in the shared world image. The whole sim is deliberately cheap — small capped herds updated on a coarse "think" tick with squared-distance math, not per-frame.

Animals start **off**. Toggle them with the switch in the right-side wildlife panel, by asking the AI (`"add animals"`, `"remove the wildlife"`), or with the `/animal` function.

### Commands, Functions & Confirmation

Type commands as natural language: `"create grass"`, `"carve a river"`, `"turn desert into forest"`. A single command can ask for several features at once — `"a desert and an ocean together"` builds both. Type **`/`** in the bar to see the available **functions**: `/overwrite` (force new terrain to replace what exists), `/cloud` (toggle clouds), `/animal` (toggle wildlife), and `/share` + `/load` (world codes, below). Otherwise, when the AI decides an action would overwrite existing terrain, a glass popup asks for confirmation (Enter/yes to proceed, Backspace/Delete/no to cancel). Rivers may also first ask `"connect to nearby river?"` the same way. Prompting is locked while terrain animates.

### Sharing worlds

Type **`/share`** (or hit the **⧉** button) to copy a **world code** — a string like `HYA1.NY3BDQQhDM...` that rebuilds your world anywhere. Send it to someone; they paste it into the command bar after **`/load`**, or just paste the bare code and hit shape. The world appears instantly, and they can keep building on it and re-share it.

The trick is that a code doesn't contain any pixels — it contains the **recipe**. Every feature you make resolves to a handful of numbers (terrain, center, radius, noise seed, roughness) and the noise is seeded and pure, so replaying those numbers in order rebuilds the same land tile for tile. A nine-feature, 386,000-tile world fits in a **171-character** code; even a 50-feature world stays around 1,000 characters. Nothing is uploaded and no server is involved — the code *is* the world, so it works offline and never expires.

Two caveats worth knowing. When one command creates several features at once, their growth animations interleave, while a loaded code applies them one after another — so features that overlapped *while both were still growing* can settle their shared border a pixel or two differently. And codes carry terrain only: clouds, wildlife and zoom stay however the person loading has them set.

### Screens & scaling

The game fits any window, from a tiled desktop pane to a phone. The UI reflows at three breakpoints — the create bar goes fluid (the input yields, the buttons hold their size), the confirm popup moves from beside the bar to the bottom center, the `/` menu breaks out of the narrowed input, and everything respects notch/rounded-corner safe areas.

The world scales too. The player sprite is drawn at a fixed on-screen size, so on a phone it would have filled a quarter of the screen with almost no world around it. Below a 720px viewport short side, the sprite **and** the world scale down together (`SCENE_STEPS` in `engine.js`), so a 390px phone shows ~780px of world instead of 390 and the character drops from 25% of the screen's width to 12%. The steps are chosen so the 16px sprite always lands on a whole multiple (6x/5x/4x/3x) — a fractional scale would round some sprite pixels to 3 screen pixels and their neighbours to 4, which reads as a wobble.

Because the sprite's size and the world's render scale both carry that factor, it cancels out of every screen→world conversion: **scaling changes how much world you see, never how much world the character occupies**. Collision, the feet line, the trample footprint and depth-sorting are identical at every window size, and walking covers the same screen distance per second.

Movement is still keyboard (WASD) — there are no touch controls, so a phone can shape, zoom, share and load worlds, but walking needs a keyboard.

### AI Awareness

Each command also sends the AI a text-grid snapshot of the world around you — a 120x64 character map (`'.'` void, `'G'` grass, `'D'` desert, `'F'` forest, `'R'` river/lake, `'T'` tundra, `'I'` ice, `'O'` ocean, `'S'` savannah, `'M'` mountains, `'P'` player) plus world-coordinate origin, so it places terrain relative to what already exists. It is not an image — just text rows.

### Bring your own key

Hyacinths ships with **no API key**. Every player uses their own, from whichever provider they like: hit the **🔑** button (bottom right, also on the splash screen), pick a provider, and paste a key. Each provider can also take a model override.

| Provider | Default model | Get a key |
| --- | --- | --- |
| Google Gemini | `gemini-flash-latest` | [aistudio.google.com](https://aistudio.google.com/apikey) (free tier) |
| OpenAI | `gpt-4.1-mini` | [platform.openai.com](https://platform.openai.com/api-keys) |
| Anthropic Claude | `claude-opus-5-5` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| Groq | `llama-3.3-70b-versatile` | [console.groq.com](https://console.groq.com/keys) (free tier) |
| OpenRouter | `meta-llama/llama-3.3-70b-instruct` | [openrouter.ai](https://openrouter.ai/keys) (hundreds of models) |
| Mistral | `mistral-small-latest` | [console.mistral.ai](https://console.mistral.ai/api-keys) |
| DeepSeek | `deepseek-chat` | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| Custom | — | any OpenAI-compatible endpoint (Together, Fireworks, xAI, local Ollama/LM Studio…): give it a base URL and model; the key is optional |

There is no backend. The game is a static site, and the browser calls the provider directly with your key:

- Keys are kept only in your browser's `localStorage`, one per provider. **forget keys** in the panel wipes them all.
- Each key goes only to its own provider. Gemini's goes in the `x-goog-api-key` header, never the URL; Anthropic's goes in `x-api-key`; the rest are sent as bearer tokens. The site's Content-Security-Policy (`vercel.json`) allows scripts only from the site itself, so nothing third-party can run on the page and read them.
- A custom endpoint must allow cross-origin requests from the site. For a local server, that means e.g. setting `OLLAMA_ORIGINS`.

### Providers & Fallback

The provider you pick in the panel answers first. If it fails (bad key, rate limit, outage), every **other** provider you've saved a key for is tried next, in the table's order. With no key, or when every provider fails, an offline keyword parser keeps the game playable (tagged `[offline mode]` in notifications). Provider errors, such as `API key not valid`, surface in the toast.

## Setup

```
npm install
npm run dev
```

Open http://localhost:5173 and add your key with the 🔑 button. There is no `.env` to fill in: the app reads no environment variables, so a build can never bake a key in.

## Deploying

It's a plain Vite static build (`npm run build` → `dist/`), so any static host works. On Vercel, import the repo (or run `vercel --prod`) and leave **Environment Variables empty**, since nothing reads them. `vercel.json` adds the security headers, and `.vercelignore` keeps any stray local `.env` out of CLI uploads.

## Structure

- `src/ai/terrain.js` — runs in the browser: `requestTerrain` sends `{command, charX, charY, map}` with the system prompt in `src/ai/systemPrompt.js` to the player's chosen provider, then to their other saved providers. It speaks three request shapes (Gemini, Anthropic, OpenAI-compatible), sanitizes the JSON reply (a single action or an array of them) and falls back to offline parsing on error.
- `src/ai/providers.js` — the provider catalogue (endpoint, default model, key link, per-provider quirks). Adding an OpenAI-compatible provider is one entry here.
- `src/ai/keys.js` — the bring-your-own-key store: loads/saves/forgets the player's provider choice, keys and models in `localStorage`, degrading to keys-for-this-visit when storage is blocked.
- `src/game/engine.js` — canvas engine: WASD movement, sprite animation, tile grid, seeded-noise blob growth, Catmull-Rom river carving, zoom, undo stack (10 steps), the wildlife predator–prey sim, and the world's build recipe (`_resolveAction` bakes each AI action down to plain numbers; `_runAction` executes one, live or instantly on replay).
- `src/game/sharecode.js` — world-code codec: the build recipe as compact tuples, deflated and base64url'd behind a versioned `HYA1.` prefix (`HYA0.` uncompressed where `CompressionStream` is missing). Malformed codes decode to `null` rather than throwing.
- `src/App.jsx` — command bar, `/` function menu, toast + transient tips, wildlife panel, undo/zoom/share/code/key controls, and the 🔑 key panel. The splash→normal GSAP transition measures both ends off the live elements rather than hardcoding pixel targets, so the stylesheet stays the only place responsive geometry is defined.
- `src/styles.css` — glass UI, with the responsive rules collected in one block at the bottom.
- `assets/` — character sprites; `assets/nature_pack/` — terrain sprites (tree, acacia, cactus, mountain, snowtree) and animals (`savanna/lion`, `savanna/zebra`, `forest/wolf`, `forest/deer`, `forest/bear`). Any PNG under `nature_pack/**` auto-loads, grouped by name.

## License

[MIT](LICENSE) © 2026 Ayan Arsalan
