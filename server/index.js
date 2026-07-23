import 'dotenv/config';
import express from 'express';
import { SYSTEM_PROMPT } from './systemPrompt.js';

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 3001;
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// Optional Gemini "thinking" budget. Left UNSET by default: several models
// (e.g. gemini-flash-lite-latest) reject an explicit thinkingBudget of 0
// with a 400 INVALID_ARGUMENT, and the lite/default models don't think
// anyway — so we simply omit thinkingConfig unless a budget is configured.
// Set GEMINI_THINKING_BUDGET (e.g. 0 to force-disable thinking on a model
// that supports it, or -1 for dynamic) only if your chosen model accepts it.
const _rawThinkingBudget = process.env.GEMINI_THINKING_BUDGET;
const THINKING_BUDGET =
  _rawThinkingBudget != null && _rawThinkingBudget.trim() !== '' && Number.isFinite(Number(_rawThinkingBudget))
    ? Number(_rawThinkingBudget)
    : null;

const TERRAINS = new Set(['grass', 'desert', 'forest', 'river', 'lake', 'tundra', 'ocean', 'savannah', 'mountain']);

const INVALID = (notification = 'I cannot create that environment yet.') => ({
  notification,
  engine_data: { terrain: null, overwrite: false }
});

// Pulls the first balanced {...} object out of arbitrary model text. Models
// sometimes append trailing junk (or wrap the JSON in commentary/fences)
// after an otherwise-valid object, which breaks a naive JSON.parse. This
// walks brace depth while respecting string literals/escapes so it finds
// exactly the first complete top-level object and ignores anything after it.
function extractFirstJson(text) {
  const raw = String(text ?? '');
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = cleaned.indexOf('{');
  if (start === -1) throw new Error(`No JSON object found in model response.\nRaw response: ${raw}`);
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      stack.push(ch);
    } else if (ch === '}' || ch === ']') {
      stack.pop();
      if (stack.length === 0) {
        const slice = cleaned.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch (e) {
          throw new Error(`Failed to parse JSON from model response: ${e.message}\nRaw response: ${raw}`);
        }
      }
    }
  }
  // Ran out of text with scopes still open — the response was cut off
  // mid-object (observed in the wild from Gemini). Close the dangling
  // string and every open scope, then retry.
  let repaired = cleaned.slice(start);
  if (inString) repaired += '"';
  repaired = repaired.replace(/[,\s]+$/, '');
  for (let i = stack.length - 1; i >= 0; i--) repaired += stack[i] === '{' ? '}' : ']';
  try {
    const parsed = JSON.parse(repaired);
    console.warn('[extractFirstJson] repaired truncated model JSON');
    return parsed;
  } catch (e) {
    throw new Error(`Model response is truncated and could not be repaired: ${e.message}\nRaw response: ${raw}`);
  }
}

// Defensively validates the client-supplied coarse-grid text map before it
// ever reaches a prompt. Anything malformed collapses to null rather than
// being rejected outright, since the map is a nice-to-have hint, not a
// required field.
function validateMap(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const { originX, originY, width, height, rows } = map;
  if (!Number.isInteger(originX) || !Number.isInteger(originY)) return null;
  if (!Array.isArray(rows) || !rows.every((r) => typeof r === 'string')) return null;
  const result = {
    originX,
    originY,
    width,
    height,
    rows: rows.slice(0, 150).map((r) => r.slice(0, 240))
  };
  const overview = validateOverview(map.overview);
  if (overview) result.overview = overview;
  return result;
}

// Same idea as validateMap, but for the optional coarse whole-world summary
// grid. Missing or malformed input simply means the field is omitted from
// the validated map entirely — it's a nice-to-have for big-picture awareness,
// never a reason to reject or throw.
function validateOverview(overview) {
  if (!overview || typeof overview !== 'object' || Array.isArray(overview)) return null;
  const { originX, originY, block, width, height, rows } = overview;
  if (!Number.isInteger(originX) || !Number.isInteger(originY) || !Number.isInteger(block)) return null;
  if (!Array.isArray(rows) || !rows.every((r) => typeof r === 'string')) return null;
  return {
    originX,
    originY,
    block,
    width,
    height,
    rows: rows.slice(0, 60).map((r) => r.slice(0, 90))
  };
}

function userContent(command, charX, charY, map) {
  const content = { command, charX, charY };
  if (map) content.map = map;
  return content;
}

async function askGemini(command, charX, charY, map) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(userContent(command, charX, charY, map)) }] }],
      generationConfig: {
        temperature: 0.9,
        responseMimeType: 'application/json',
        maxOutputTokens: 4096,
        // Only include a thinking budget when one is explicitly configured;
        // otherwise omit it entirely (see THINKING_BUDGET above).
        ...(THINKING_BUDGET !== null ? { thinkingConfig: { thinkingBudget: THINKING_BUDGET } } : {})
      }
    })
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  try {
    return extractFirstJson(text);
  } catch (e) {
    throw new Error(`(finishReason: ${data.candidates?.[0]?.finishReason ?? 'unknown'}) ${e.message}`);
  }
}

async function askGroq(command, charX, charY, map) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(userContent(command, charX, charY, map)) }
      ],
      temperature: 0.9,
      response_format: { type: 'json_object' }
    })
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  return extractFirstJson(text);
}

// Clamps ONE engine_data action from the model into exactly what the engine
// accepts, or returns null if it's neither a supported terrain nor a toggle.
// Shared by single- and multi-action responses (see sanitize).
function sanitizeAction(ed, charX, charY) {
  if (!ed || typeof ed !== 'object' || Array.isArray(ed)) return null;
  const terrain = TERRAINS.has(ed.terrain) ? ed.terrain : null;
  if (!terrain) {
    // A pure toggle action (clouds or wildlife) carries no terrain at all.
    const toggles = {};
    if (typeof ed.clouds === 'boolean') toggles.clouds = ed.clouds;
    if (typeof ed.animals === 'boolean') toggles.animals = ed.animals;
    if (Object.keys(toggles).length) return { terrain: null, overwrite: false, ...toggles };
    return null;
  }
  const overwrite = ed.overwrite === true;
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

  if (terrain === 'river') {
    const points = (Array.isArray(ed.points) ? ed.points : [])
      .map((p) => ({ x: Math.round(Number(p?.x)), y: Math.round(Number(p?.y)) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .slice(0, 12);
    if (points.length < 2) return null;
    const connect = ed.connect === false ? false : ed.connect === true ? true : 'ask';
    const width = Math.min(5, Math.max(0.4, num(ed.width, 1)));
    return { terrain, points, overwrite: ed.overwrite === false ? false : true, connect, width };
  }

  if (terrain === 'lake') {
    return {
      terrain,
      centerX: Math.round(num(ed.centerX, charX)),
      centerY: Math.round(num(ed.centerY, charY)),
      maxRadius: Math.min(60, Math.max(4, num(ed.maxRadius, 12))),
      seed: num(ed.seed, Math.random() * 1000),
      roughness: Math.min(0.8, Math.max(0.3, num(ed.roughness, 0.55))),
      atRiverEnd: ed.atRiverEnd === true,
      overwrite
    };
  }

  if (terrain === 'ocean') {
    return {
      terrain,
      centerX: Math.round(num(ed.centerX, charX)),
      centerY: Math.round(num(ed.centerY, charY)),
      maxRadius: Math.min(140, Math.max(20, num(ed.maxRadius, 38))),
      seed: num(ed.seed, Math.random() * 1000),
      roughness: Math.min(0.8, Math.max(0.3, num(ed.roughness, 0.55))),
      overwrite
    };
  }

  return {
    terrain,
    centerX: Math.round(num(ed.centerX, charX)),
    centerY: Math.round(num(ed.centerY, charY)),
    maxRadius: Math.min(160, Math.max(5, num(ed.maxRadius, 40))),
    seed: num(ed.seed, Math.random() * 1000),
    roughness: Math.min(0.8, Math.max(0.3, num(ed.roughness, 0.55))),
    overwrite
  };
}

// The model is instructed to return strict JSON, but the engine only ever
// receives values that survive this clamp. engine_data may be a single action
// object (as before) OR an array of them ("a desert and an ocean") — the
// client accepts either shape.
function sanitize(raw, charX, charY) {
  if (!raw || typeof raw !== 'object' || !raw.engine_data) return INVALID();
  const notification = typeof raw.notification === 'string' ? raw.notification.slice(0, 200) : 'The land shifts.';
  const ed = raw.engine_data;
  if (Array.isArray(ed)) {
    const actions = ed.map((e) => sanitizeAction(e, charX, charY)).filter(Boolean).slice(0, 8);
    if (!actions.length) return INVALID(notification);
    // A single surviving action needn't stay wrapped.
    return { notification, engine_data: actions.length === 1 ? actions[0] : actions };
  }
  const action = sanitizeAction(ed, charX, charY);
  if (!action) return INVALID(notification);
  return { notification, engine_data: action };
}

// Detects a relative direction ("left", "north", etc.) mentioned in the
// command so the offline fallback can nudge generation that way, mirroring
// the DIRECTIONAL PLACEMENT directive given to the LLM providers.
function detectDirection(text) {
  let dx = 0;
  let dy = 0;
  if (/\bleft\b/.test(text) || /\bwest\b/.test(text)) dx -= 1;
  if (/\bright\b/.test(text) || /\beast\b/.test(text)) dx += 1;
  if (/\bup\b/.test(text) || /\bnorth\b/.test(text)) dy -= 1;
  if (/\bdown\b/.test(text) || /\bsouth\b/.test(text)) dy += 1;
  if (dx === 0 && dy === 0) return null;
  return { dx, dy };
}

// Decides whether a river should auto-join nearby existing rivers, mirroring
// the RIVER CONNECTIVITY directive given to the LLM providers. Three states:
// false when the player explicitly wants a separate/disconnected river, true
// when the player explicitly asks to connect/join/merge, and 'ask' otherwise
// (the client UI will prompt the player when it did not say either way).
function detectConnectState(text) {
  if (/\b(separate|disconnected|standalone)\b/.test(text) || /\bits own\b/.test(text)) return false;
  const negNearConnect =
    /\b(not|don't|dont)\b(?:\s+\S+){0,3}\s+connect/i.test(text) ||
    /connect(?:\s+\S+){0,3}\s+\b(not|don't|dont)\b/i.test(text);
  if (negNearConnect) return false;
  if (/\b(connect|join|merge|link)\b/.test(text)) return true;
  return 'ask';
}

// Builds one offline engine_data action for a terrain, fanned out by `idx` so
// several features in one command don't stack on the same spot. Mirrors the
// single-feature shapes the offline builders below produce.
function offlineTerrainAction(terrain, charX, charY, text, dir, idx) {
  const rnd = () => Math.random() * 1000;
  const rough = () => 0.4 + Math.random() * 0.3;
  let cx = charX + (dir ? dir.dx * 25 : 0);
  let cy = charY + (dir ? dir.dy * 25 : 0);
  if (idx > 0) {
    const ang = idx * 2.2; // fan subsequent features around the player
    const off = 34 + idx * 8;
    cx += Math.round(Math.cos(ang) * off);
    cy += Math.round(Math.sin(ang) * off);
  }
  const overwrite = /(turn|into|replace|overwrite|change|convert|instead)/.test(text);
  if (terrain === 'river') {
    const points = [];
    let x = cx + Math.round((Math.random() - 0.5) * 8);
    for (let i = 0; i < 7; i++) {
      points.push({ x, y: cy - 21 + i * 7 });
      x += Math.round((Math.random() - 0.5) * 9);
    }
    return { terrain, points, overwrite: true, connect: detectConnectState(text), width: 1 };
  }
  if (terrain === 'lake') {
    return { terrain, centerX: cx, centerY: cy, maxRadius: 12, seed: rnd(), roughness: rough(), atRiverEnd: false, overwrite };
  }
  if (terrain === 'ocean') {
    return { terrain, centerX: cx, centerY: cy, maxRadius: 38, seed: rnd(), roughness: rough(), overwrite };
  }
  return { terrain, centerX: cx, centerY: cy, maxRadius: 40, seed: rnd(), roughness: rough(), overwrite };
}

// Keyword parser used when no API key is configured or every provider is
// down, so the game stays playable offline. Picks the LAST terrain
// mentioned, so "turn desert into forest" resolves to forest.
function offlineFallback(command, charX, charY, apiFailed, debug) {
  const text = String(command).toLowerCase();
  const suffix = apiFailed ? ' [AI unreachable — offline mode]' : ' [offline mode — no API key]';

  // Clouds are a standalone toggle, independent of terrain — handle it first
  // and skip the terrain synonym scan entirely when this is what's meant.
  if (/\bclouds?\b/i.test(text)) {
    const cloudsOff = /\b(remove|hide|clear|off|no|stop|disable)\b/i.test(text);
    const result = {
      notification: 'Clouds drifting in overhead.' + suffix,
      engine_data: { terrain: null, overwrite: false, clouds: !cloudsOff }
    };
    if (debug) result.debug = debug;
    return result;
  }

  // Wildlife is a standalone toggle too — same short-circuit as clouds, before
  // the terrain scan (so an animal word never reads as a biome).
  if (/\b(animals?|wildlife|lions?|zebras?|wolf|wolves|bears?|deers?|predators?|prey)\b/i.test(text)) {
    const animalsOff = /\b(remove|hide|clear|off|no|stop|disable|kill|without)\b/i.test(text);
    const result = {
      notification: (animalsOff ? 'The wildlife wanders off.' : 'Wildlife roams the savanna and forest.') + suffix,
      engine_data: { terrain: null, overwrite: false, animals: !animalsOff }
    };
    if (debug) result.debug = debug;
    return result;
  }

  const synonyms = {
    grass: ['grass', 'meadow', 'field', 'plains'],
    desert: ['desert', 'sand', 'dune'],
    forest: ['forest', 'tree', 'woods', 'jungle'],
    river: ['river', 'water', 'stream', 'creek'],
    lake: ['lake', 'pond', 'lagoon'],
    tundra: ['tundra', 'snow', 'arctic', 'frozen', 'winter', 'ice'],
    ocean: ['ocean', 'sea'],
    savannah: ['savannah', 'savanna', 'acacia'],
    mountain: ['mountain', 'mountains', 'rocky', 'peak', 'cliff']
  };

  // Multiple features in one breath ("a desert and an ocean together"): only
  // when the phrasing joins them ("and"/comma/plus) AND isn't a transformation
  // ("turn X into Y" is a single overwrite, not two features). Build one action
  // per distinct terrain, fanned out so they don't stack on the same spot.
  const joined = /\band\b|,|\bplus\b|&|\bwith\b|\bthen\b/.test(text);
  const transform = /(turn|into|replace|overwrite|convert|instead)/.test(text);
  if (joined && !transform) {
    const found = [];
    for (const [name, words] of Object.entries(synonyms)) {
      let idx = Infinity;
      for (const w of words) {
        const i = text.indexOf(w);
        if (i >= 0 && i < idx) idx = i;
      }
      if (idx !== Infinity) found.push({ name, idx });
    }
    if (found.length >= 2) {
      found.sort((a, b) => a.idx - b.idx);
      const dir = detectDirection(text);
      const actions = found.map((f, i) => offlineTerrainAction(f.name, charX, charY, text, dir, i));
      const result = { notification: `Shaping ${found.map((f) => f.name).join(' and ')} together.` + suffix, engine_data: actions };
      if (debug) result.debug = debug;
      return result;
    }
  }

  let terrain = null;
  let bestIdx = -1;
  for (const [name, words] of Object.entries(synonyms)) {
    for (const w of words) {
      const idx = text.lastIndexOf(w);
      if (idx > bestIdx) {
        bestIdx = idx;
        terrain = name;
      }
    }
  }

  // "make a lake on the river end" mentions "river" after "lake", so the
  // last-index scan above would otherwise resolve to "river". When a lake
  // word acts on a river word (lake is the subject), prefer "lake".
  const hasLakeWord = synonyms.lake.some((w) => text.includes(w));
  const hasRiverWord = synonyms.river.some((w) => text.includes(w));
  if (hasLakeWord && hasRiverWord && /(lake|pond|lagoon).*(river|stream)/.test(text)) {
    terrain = 'lake';
  }

  let result;
  if (!terrain) {
    result = INVALID('I cannot create that environment yet.' + suffix);
  } else {
    const overwrite = /(turn|into|replace|overwrite|change|convert|instead)/.test(text);
    const dir = detectDirection(text);

    if (terrain === 'river') {
      const points = [];
      let x = charX + Math.round((Math.random() - 0.5) * 8);
      for (let i = 0; i < 7; i++) {
        points.push({ x, y: charY - 21 + i * 7 });
        x += Math.round((Math.random() - 0.5) * 9);
      }
      if (dir) {
        for (const p of points) {
          p.x += dir.dx * 20;
          p.y += dir.dy * 20;
        }
      }
      const connect = detectConnectState(text);
      const riverOverwrite = /(don'?t|do not|no|without|avoid)[^.]*overwrit/.test(text) ||
        /\boverwrit\w*\b[^.]*\b(not|no)\b/.test(text)
        ? false
        : true;
      let width = 1;
      if (/\b(wide|broad|big|huge|thick)\b/.test(text)) width = 2;
      else if (/\b(thin|narrow|small|tiny)\b/.test(text)) width = 0.6;
      result = {
        notification: 'Carving a winding river path.' + suffix,
        engine_data: { terrain, points, overwrite: riverOverwrite, connect, width }
      };
    } else if (terrain === 'lake') {
      let centerX = charX;
      let centerY = charY;
      if (dir) {
        centerX += dir.dx * 25;
        centerY += dir.dy * 25;
      }
      const atRiverEnd =
        /\b(river|stream)\b(?:\s+\S+){0,4}\s+\b(end|mouth|edge)\b/.test(text) ||
        /\b(end|mouth|edge)\b(?:\s+\S+){0,4}\s+\b(river|stream)\b/.test(text);
      result = {
        notification: 'Pooling a calm lake here.' + suffix,
        engine_data: {
          terrain,
          centerX,
          centerY,
          maxRadius: 12,
          seed: Math.random() * 1000,
          roughness: 0.4 + Math.random() * 0.3,
          atRiverEnd,
          overwrite
        }
      };
    } else if (terrain === 'ocean') {
      let centerX = charX;
      let centerY = charY;
      if (dir) {
        centerX += dir.dx * 25;
        centerY += dir.dy * 25;
      }
      result = {
        notification: 'Spreading a vast ocean here.' + suffix,
        engine_data: {
          terrain,
          centerX,
          centerY,
          maxRadius: 38,
          seed: Math.random() * 1000,
          roughness: 0.4 + Math.random() * 0.3,
          overwrite
        }
      };
    } else {
      let centerX = charX;
      let centerY = charY;
      if (dir) {
        centerX += dir.dx * 25;
        centerY += dir.dy * 25;
      }
      result = {
        notification: `Shaping ${terrain} around you.` + suffix,
        engine_data: {
          terrain,
          centerX,
          centerY,
          maxRadius: 40,
          seed: Math.random() * 1000,
          roughness: 0.4 + Math.random() * 0.3,
          overwrite
        }
      };
    }
  }
  if (debug) result.debug = debug;
  return result;
}

app.post('/api/terrain', async (req, res) => {
  const body = req.body ?? {};
  const command = String(body.command ?? '');
  const charX = Math.round(Number(body.charX)) || 0;
  const charY = Math.round(Number(body.charY)) || 0;
  const map = validateMap(body.map);

  if (!API_KEY && !GROQ_API_KEY) {
    res.json(offlineFallback(command, charX, charY, false));
    return;
  }

  const errors = [];

  if (API_KEY) {
    try {
      const raw = await askGemini(command, charX, charY, map);
      res.json(sanitize(raw, charX, charY));
      return;
    } catch (err) {
      console.error('[gemini]', err.message);
      errors.push(`gemini: ${err.message}`);
    }
  }

  if (GROQ_API_KEY) {
    try {
      const raw = await askGroq(command, charX, charY, map);
      res.json(sanitize(raw, charX, charY));
      return;
    } catch (err) {
      console.error('[groq]', err.message);
      errors.push(`groq: ${err.message}`);
    }
  }

  res.json(offlineFallback(command, charX, charY, true, errors.join(' | ')));
});

app.listen(PORT, () => {
  console.log(`Terrain server listening on http://localhost:${PORT}`);
  if (!API_KEY && !GROQ_API_KEY) {
    console.warn('No GEMINI_API_KEY or GROQ_API_KEY set — running in offline keyword mode. Copy .env.example to .env and add your key.');
  }
});
