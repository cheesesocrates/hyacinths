// World share codes.
//
// A world isn't stored as pixels — it's stored as the RECIPE that built it.
// Every piece of terrain comes from one resolved action (a seeded noise blob
// or a river spline), and the noise is pure, so replaying the same actions in
// the same order reproduces the same world tile for tile. That makes a code
// for a 40-action world a few hundred characters instead of a few hundred KB.
//
// Wire format:  HYA1.<base64url(deflate-raw(json))>
//               HYA0.<base64url(json)>            — no CompressionStream
//
// The JSON is an array of tuples rather than objects, since key names would
// otherwise be most of the payload:
//   blob   [k, x, y, r, seed, roughness, overwrite]
//   river  [6, overwrite, width, x0, y0, x1, y1, ...]   (k === RIVER_K)
//
// Codes are versioned by prefix so a future format can be added without
// invalidating everything already shared.

// Index = the number written into a tuple. APPEND ONLY — reordering this
// list would silently turn every existing code's deserts into forests.
export const SHARE_TERRAINS = [
  'grass',
  'desert',
  'forest',
  'savannah',
  'mountain',
  'tundra',
  'river',
  'lake',
  'ocean'
];

const RIVER_K = SHARE_TERRAINS.indexOf('river');

const PREFIX_DEFLATE = 'HYA1';
const PREFIX_PLAIN = 'HYA0';

// Blob centers/radii live on the fine-tile grid and rivers are splines, so
// neither needs sub-pixel precision; seed and roughness only shift noise.
// Rounding here is what keeps codes short. The engine rounds to these same
// precisions when it records an action, so the world you share is exactly
// the world the code rebuilds — no drift between the two.
const round = (n, places) => {
  const f = 10 ** places;
  return Math.round(Number(n) * f) / f;
};

export const SEED_PLACES = 3;
export const ROUGH_PLACES = 3;
export const POINT_PLACES = 2;

function toTuple(a) {
  if (a.k === 'river') {
    const t = [RIVER_K, a.o ? 1 : 0, round(a.w, 2)];
    for (const p of a.p) t.push(round(p.x, POINT_PLACES), round(p.y, POINT_PLACES));
    return t;
  }
  const k = SHARE_TERRAINS.indexOf(a.k);
  if (k < 0) return null;
  return [k, round(a.x, 1), round(a.y, 1), round(a.r, 1), round(a.s, SEED_PLACES), round(a.g, ROUGH_PLACES), a.o ? 1 : 0];
}

function fromTuple(t) {
  if (!Array.isArray(t) || !Number.isFinite(t[0])) return null;
  const k = t[0];
  if (k === RIVER_K) {
    // [k, overwrite, width, x0, y0, ...] — needs at least two points.
    if (t.length < 7 || (t.length - 3) % 2 !== 0) return null;
    const p = [];
    for (let i = 3; i < t.length; i += 2) {
      if (!Number.isFinite(t[i]) || !Number.isFinite(t[i + 1])) return null;
      p.push({ x: t[i], y: t[i + 1] });
    }
    return { k: 'river', o: !!t[1], w: Number(t[2]) || 1, p };
  }
  const name = SHARE_TERRAINS[k];
  if (!name || name === 'river' || t.length !== 7) return null;
  for (let i = 1; i <= 5; i++) if (!Number.isFinite(t[i])) return null;
  return { k: name, x: t[1], y: t[2], r: t[3], s: t[4], g: t[5], o: !!t[6] };
}

// base64url (no padding) — safe to drop straight into a URL or a chat message
// without anything mangling it.
function bytesToCode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function codeToBytes(code) {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function pipeThrough(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

// Recipe -> code. Falls back to uncompressed (HYA0) wherever
// CompressionStream is missing; both forms decode everywhere.
export async function encodeRecipe(recipe) {
  const tuples = (recipe || []).map(toTuple).filter(Boolean);
  if (!tuples.length) return null;
  const json = JSON.stringify(tuples);
  const bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'undefined') {
    return PREFIX_PLAIN + '.' + bytesToCode(bytes);
  }
  try {
    return PREFIX_DEFLATE + '.' + bytesToCode(await pipeThrough(bytes, new CompressionStream('deflate-raw')));
  } catch {
    return PREFIX_PLAIN + '.' + bytesToCode(bytes);
  }
}

// Code -> recipe. Returns null for anything malformed rather than throwing,
// so the caller can just say "that code doesn't look right".
export async function decodeRecipe(code) {
  const trimmed = String(code || '').trim();
  const dot = trimmed.indexOf('.');
  if (dot < 0) return null;
  const prefix = trimmed.slice(0, dot).toUpperCase();
  const body = trimmed.slice(dot + 1).replace(/\s+/g, '');
  if (prefix !== PREFIX_DEFLATE && prefix !== PREFIX_PLAIN) return null;
  let json;
  try {
    let bytes = codeToBytes(body);
    if (prefix === PREFIX_DEFLATE) {
      if (typeof DecompressionStream === 'undefined') return null;
      bytes = await pipeThrough(bytes, new DecompressionStream('deflate-raw'));
    }
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!Array.isArray(json) || !json.length) return null;
  const recipe = json.map(fromTuple);
  if (recipe.some((a) => a === null)) return null;
  return recipe;
}

// True for anything shaped like a code, so the command bar can tell a paste
// apart from a sentence before trying to decode it.
export function looksLikeCode(text) {
  return /^HYA[01]\.[A-Za-z0-9\-_]+$/i.test(String(text || '').trim());
}
