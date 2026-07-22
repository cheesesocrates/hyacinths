export const TILE = 3; // fine terrain pixel size on screen
export const SCALE = 5; // fine tiles per AI grid unit (the AI thinks in ~15px cells)

export const TERRAIN = {
  VOID: 0,
  GRASS: 1,
  DESERT: 2,
  FOREST: 3,
  RIVER: 4,
  TUNDRA: 5,
  ICE: 6,
  OCEAN: 7,
  SAVANNAH: 8,
  MOUNTAIN: 9
};

export const TERRAIN_CODES = {
  grass: TERRAIN.GRASS,
  desert: TERRAIN.DESERT,
  forest: TERRAIN.FOREST,
  river: TERRAIN.RIVER,
  lake: TERRAIN.RIVER, // lakes are water — same tiles, blob-shaped
  tundra: TERRAIN.TUNDRA,
  ocean: TERRAIN.OCEAN,
  savannah: TERRAIN.SAVANNAH,
  mountain: TERRAIN.MOUNTAIN
};

export const COLORS = {
  [TERRAIN.GRASS]: '#8bd84e',
  [TERRAIN.DESERT]: '#f4e542',
  [TERRAIN.FOREST]: '#6b973f',
  [TERRAIN.RIVER]: '#7b8fe4',
  [TERRAIN.TUNDRA]: '#eaf3ff', // bright, slightly-blue snow-white
  [TERRAIN.ICE]: '#c9e8f5',
  [TERRAIN.OCEAN]: '#7b8fe4', // all liquid water is one color; only ice differs
  [TERRAIN.SAVANNAH]: '#d9c565',
  [TERRAIN.MOUNTAIN]: null // grassy ground beneath the peaks — set from GRASS below
};
COLORS[TERRAIN.MOUNTAIN] = COLORS[TERRAIN.GRASS];

// Liquid water (ice is frozen solid — walkable, not swimmable).
const WATER = new Set([TERRAIN.RIVER, TERRAIN.OCEAN]);

const CHUNK = 64; // fine tiles per chunk side (192px canvases)
const CHAR_DRAW = 96; // 16px sprite drawn at 6x
const CHAR_SPEED = 220; // px per second, at zoom 1
const WORLD_MARGIN = 220; // walkable padding beyond the painted world's bounding box
const BLOB_FRONT_SPEED = 160; // fine tiles of effective distance revealed per second
const WALK_FPS = 8;
const WATER_FPS = 2;
const IDLE_SPF = 1; // seconds per idle frame, per design
const RIVER_RADIUS = 2.4; // fine tiles at width 1 — ~14px wide water
const RIVER_EDGE_WAVE = 0.5; // fixed edge waviness (tiles); NOT scaled by width, so wide rivers stay clean
const CONNECT_RANGE = 100; // fine tiles — max gap auto-bridged between rivers
const HISTORY_LIMIT = 10;

const ZOOM_MIN = 0.35; // a good amount of zoom out — ~3x more world visible
const ZOOM_MAX = 2.5;
const ZOOM_DEFAULT = 1;

// Map snapshots sent to the terrain AI: a big, detailed near-field grid
// around the player, plus a bounded coarse overview of the whole painted
// world (see Engine#_overviewSnapshot) so the AI has some big-picture
// awareness without ever sending an unbounded payload as the world grows.
const MAP_NEAR_W = 220;
const MAP_NEAR_H = 130;
const MAP_OVERVIEW_MAX = 60;

// The player's footfall no longer paints the ground (no dirt trail), but
// walking still displaces small decor underfoot — TRAMPLE_FOOTPRINT is the
// footprint SIZE that reach is judged against (world px at zoom 1, scaled
// by 1/zoom just like the old trail was) so stepping behavior is unchanged.
const TRAMPLE_FOOTPRINT = 12;

// Water ripples: while swimming and moving, ripples spawn at the feet and
// recolor the water's pixels to white in a ring that expands outward over
// its life — tile-quantized pixel blocks, not a drawn circle.
const RIPPLE_LIFE = 0.6; // seconds a ripple lives
const RIPPLE_STEP = 16; // world px between spawns while swimming — keeps rings distinct
const RIPPLE_MIN_RADIUS = 2; // world px at birth
const RIPPLE_MAX_RADIUS = 15; // world px at death — visible pixel expansion

// Trample interaction timing (see Engine#_updateTrample): drop into the
// ground quickly when stepped on, stay gone for about the same beat the
// dirt mark lasts, then spring back fast. Anything whose base sits on a
// "walked pixel" (inside the dirt footprint) is what gets removed.
const TRAMPLE_SINK = 0.12; // quick vanish
const TRAMPLE_REGROW_DELAY = 0.5; // gone for ~0.5s after last stepped on (matches the dirt)
const TRAMPLE_GROW = 0.25; // springs back quickly

const TUMBLEWEED_MAX = 5;
const TUMBLEWEED_SPAWN_CHECK = 1.6; // seconds between spawn attempts
const TUMBLEWEED_DESPAWN_DIST = 1600;
const TUMBLEWEED_GUST_CHANCE = 0.12; // chance per second of a random rebound
const TUMBLEWEED_SIZE = 34; // bigger — reads clearly as it rolls past
const TUMBLEWEED_BOUNCE = 13; // world-px hop height, so it visibly bounces
const TUMBLEWEED_BOUNCE_RATE = 0.2; // hop cadence per unit of roll speed

// Clouds blanket the whole map (not just near the player) and their count
// grows with the land: roughly one cloud per CLOUD_AREA of world, clamped.
const CLOUD_AREA = 480 * 480; // world px² of map per cloud (~half as many as before)
const CLOUD_MIN = 4;
const CLOUD_MAX = 80;
const CLOUD_EDGE_MARGIN = 400; // clouds roam this far beyond the land's bounds
const CLOUD_SIZE = 170; // base draw width in world px
const CLOUD_ALPHA = 1; // opaque
// Every cloud drifts the same way, like wind. Slight downward tilt so it
// isn't perfectly horizontal.
const CLOUD_WIND = { x: Math.cos(0.18), y: Math.sin(0.18) };
const CLOUD_BOB_AMP = 3; // screen px of vertical jiggle
const CLOUD_BOB_RATE = 5.5; // how fast the jiggle steps

const FOREST_TREE_DENSITY = 0.9;

// Decor renders at ONE fixed scale — its base cell spacing and base draw
// size — at every zoom level. Zooming out simply shows more of these same
// small sprites (the world scales under them); there is deliberately no
// level-of-detail that thins the lattice or grows sprites into stand-ins
// for a group.
//
// Decoration fields: jittered lattices keyed by world position, so sprites
// are deterministic, need no storage, and exist wherever their biome does.
// cell = lattice pitch in fine tiles, density = fraction of cells occupied
// (or a baseline for drift fields — see below), w/h = draw size in world px.
//
// Optional per-type extras (all opt-in, so new decor can pick and choose
// exactly what it needs):
//   interact: 'trample'    — walking onto it sinks it into the ground and
//                            fades it out, then it regrows once the player
//                            has moved off for a bit (Engine#_updateTrample).
//   scaleJitter: true      — each instance gets a small random size variance.
//   regionalVariant: true  — nearby instances lean toward the same pool
//                            variant (reads like a patch/species) instead
//                            of a pure per-cell random pick.
//
// Forest stays dense and leafy; the rest are sparser set-dressing. Meadow
// flowers use `drift`: coverage is a smooth, continuously-varying
// probability field — never a hard-edged patch — so meadows read as an
// organic, mostly-covered field rather than scattered blotches.
const DECOR = {
  [TERRAIN.FOREST]: { img: 'tree', cell: 5, density: FOREST_TREE_DENSITY, w: 30, h: 30, interact: 'trample' },
  [TERRAIN.SAVANNAH]: { img: 'acacia', cell: 14, density: 0.2, w: 39, h: 36, interact: 'trample' },
  [TERRAIN.DESERT]: { img: 'cactus', cell: 22, density: 0.06, w: 42, h: 54, interact: 'trample' },
  [TERRAIN.MOUNTAIN]: { img: 'mountain', cell: 10, density: 0.28, w: 184, h: 176 },
  [TERRAIN.TUNDRA]: { img: 'snowtree', cell: 12, density: FOREST_TREE_DENSITY * 0.75, w: 27, h: 30, interact: 'trample' },
  [TERRAIN.GRASS]: {
    img: 'flower',
    cell: 8,
    density: 0.06,
    w: 18,
    h: 18,
    drift: true,
    interact: 'trample',
    scaleJitter: true,
    regionalVariant: true
  }
};

// Mountains form clusters instead of scattering uniformly. A coarse
// "formation" lattice — sized off the mountain's own cell and independent
// of zoom — decides where a range exists at all and picks one of three
// shapes: mostly a near-horizontal ridge (a handful of peaks stacked
// together reads beautifully even zoomed way out), or a round blob/small
// group for variety. Only fine-lattice candidates landing inside an active
// formation's shape are eligible, at a much higher fill chance than a plain
// scatter would use.
const MOUNTAIN_CLUSTER_MULT = 5.5;
const MOUNTAIN_CLUSTER_CHANCE = 0.55;
const MOUNTAIN_FILL_CHANCE = 0.85;

function mountainFormation(fgx, fgy, cellSize) {
  if (hash(fgx, fgy, 601.3) > MOUNTAIN_CLUSTER_CHANCE) return null;
  const typeRoll = hash(fgx, fgy, 602.7);
  const type = typeRoll < 0.6 ? 'ridge' : typeRoll < 0.82 ? 'blob' : 'group';
  // Near-horizontal but never dead flat — a slight random tilt per formation.
  const angle = (hash(fgx, fgy, 603.1) - 0.5) * 0.55;
  return {
    type,
    angle,
    reach: cellSize * (0.42 + hash(fgx, fgy, 604.9) * 0.18), // spans roughly 4-5 peaks
    cx: fgx * cellSize + hash(fgx, fgy, 605.3) * cellSize,
    cy: fgy * cellSize + hash(fgx, fgy, 606.1) * cellSize
  };
}

function inMountainFormation(px, py, f) {
  const dx = px - f.cx;
  const dy = py - f.cy;
  if (f.type === 'group') return Math.hypot(dx, dy) <= f.reach * 0.32;
  if (f.type === 'blob') return Math.hypot(dx, dy) <= f.reach * 0.62;
  // Ridge: a bounded segment along `angle` with a wider perpendicular band
  // than before, so peaks sit together but jitter up/down a bit rather
  // than lining up perfectly straight.
  const nx = Math.cos(f.angle);
  const ny = Math.sin(f.angle);
  const along = dx * nx + dy * ny;
  const perp = -dx * ny + dy * nx;
  return Math.abs(along) <= f.reach && Math.abs(perp) <= f.reach * 0.32;
}

function fract(n) {
  return n - Math.floor(n);
}

function hash(x, y, seed) {
  return fract(Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123);
}

// Bilinearly interpolated value noise over an integer lattice.
function smoothNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// A tile's "effective distance" from the blob center: euclidean distance
// distorted by low-frequency lobes (big organic bulges) and a mid-frequency
// crinkle octave — both smooth/correlated noise, so the boundary they trace
// is a continuous curve. Land blobs ALSO get a per-tile independent jitter
// ("jag") for a rough, jagged edge; water bodies skip it entirely (smooth
// = true) so lakes/oceans/rivers rasterize as one clean, contiguous body
// with no stray isolated pixels at the edge.
function effectiveDistance(x, y, cx, cy, maxRadius, seed, roughness, smooth) {
  const dist = Math.hypot(x - cx, y - cy);
  const lobe = (smoothNoise(x * 0.016, y * 0.016, seed) - 0.5) * 2;
  const mid = (smoothNoise(x * 0.09, y * 0.09, seed + 31) - 0.5) * 2;
  let d = dist + lobe * maxRadius * 0.45 * roughness + mid * maxRadius * 0.1 * roughness;
  if (!smooth) {
    const jag = (hash(x, y, seed + 99) - 0.5) * 2;
    d += jag * (1 + roughness * 3);
  }
  return d;
}

// All tiles belonging to a noisy blob, sorted nearest-first so the engine
// can reveal them frame-by-frame as an expanding front.
export function blobTiles(cx, cy, maxRadius, seed, roughness, smooth) {
  const margin = Math.ceil(maxRadius * 0.55 * roughness + roughness * 3 + 4);
  const reach = maxRadius + margin;
  const tiles = [];
  for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y++) {
    for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x++) {
      const d = effectiveDistance(x, y, cx, cy, maxRadius, seed, roughness, smooth);
      if (d <= maxRadius) tiles.push({ x, y, d });
    }
  }
  tiles.sort((a, b) => a.d - b.d);
  return tiles;
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
  };
}

// Rasterizes a smooth Catmull-Rom curve through waypoints (fine-tile
// coordinates) into tiles tagged with arc length, so the river carves
// point-by-point. Sampling density adapts to segment length; radius sets
// the water's half-width in fine tiles. Rivers already use smooth
// (correlated) edge noise below, so they never needed the jag fix.
export function riverTiles(points, radius = RIVER_RADIUS) {
  if (!points || points.length < 2) return [];
  const pts = [points[0], ...points, points[points.length - 1]];
  const cells = new Map();
  let arc = 0;
  let prev = null;
  for (let i = 0; i < pts.length - 3; i++) {
    const chord = Math.hypot(pts[i + 2].x - pts[i + 1].x, pts[i + 2].y - pts[i + 1].y);
    const steps = Math.max(8, Math.ceil(chord / 0.6));
    for (let s = 0; s < steps; s++) {
      const p = catmullRom(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], s / steps);
      if (prev) arc += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
      const rMax = radius + RIVER_EDGE_WAVE + 1;
      for (let ty = Math.floor(p.y - rMax); ty <= Math.ceil(p.y + rMax); ty++) {
        for (let tx = Math.floor(p.x - rMax); tx <= Math.ceil(p.x + rMax); tx++) {
          const r = radius + (smoothNoise(tx * 0.12, ty * 0.12, 7.3) - 0.5) * 2 * RIVER_EDGE_WAVE;
          if (Math.hypot(tx - p.x, ty - p.y) > r) continue;
          const key = tx + ',' + ty;
          if (!cells.has(key)) cells.set(key, { x: tx, y: ty, d: arc });
        }
      }
    }
  }
  return [...cells.values()].sort((a, b) => a.d - b.d);
}

export class Engine {
  constructor(canvas, images) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.images = images;
    // Per-biome sprite variant pools, e.g. { acacia: [img, img, img] }.
    this.decor = images.decor || {};
    // Per-pool variant weights (bluish flowers thinned to ~1/3), classified
    // from the actual sprite pixels so it survives asset renames/swaps.
    this.variantWeights = {};
    const fw = this._bluishFlowerWeights(this.decor.flower);
    if (fw) this.variantWeights.flower = fw;
    this.keys = new Set();
    this.jobs = [];
    this.time = 0;
    this.moving = false;
    // World is chunked and unbounded; the character lives in world pixels
    // and the camera keeps them dead-center on screen.
    this.chunks = new Map();
    this.charX = 0;
    this.charY = 0;
    this.zoom = ZOOM_DEFAULT;
    this.history = [];
    this.riverEndpoints = [];
    // Growing bounding box of everything painted so far — the walkable
    // world is a simple rectangle around it (see #update), and it's also
    // what the share feature and the AI's world overview key off of.
    this.worldBounds = null;
    this.ripples = [];
    this._rippleDist = 0;
    this._lastRipplePos = null;
    // key -> { state: 'sinking'|'hidden'|'growing', since, lastNear }
    this.trample = new Map();
    this.tumbleweeds = [];
    this._twSpawnT = 0;
    this.clouds = [];
    this.cloudsOn = false;
    this.resize(window.innerWidth, window.innerHeight);
  }

  // Builds per-variant selection weights for the flower pool so bluish
  // blooms appear about a third as often as they otherwise would. Weight is
  // N/(3N+2B) for each bluish variant vs 1 for each non-bluish, which works
  // out to each bluish flower landing at ~1/3 of its plain uniform rate
  // (the non-bluish ones absorb the freed-up frequency). Returns null when
  // there's nothing to rebalance (no pool, or all/none bluish).
  _bluishFlowerWeights(pool) {
    if (!pool || pool.length < 2) return null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const bluish = pool.map((img) => this._isBluishSprite(img, canvas, ctx));
    const B = bluish.filter(Boolean).length;
    const N = pool.length - B;
    if (B === 0 || N === 0) return null;
    const bw = N / (3 * N + 2 * B);
    const weights = bluish.map((b) => (b ? bw : 1));
    const total = weights.reduce((s, w) => s + w, 0);
    return { weights, total };
  }

  // True if a sprite's dominant non-green, reasonably-saturated hue is in
  // the blue→purple band. Samples the actual pixels (green stems/leaves and
  // washed-out pixels ignored) so it tracks whatever art is dropped in.
  _isBluishSprite(img, canvas, ctx) {
    const w = img.width;
    const h = img.height;
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    let data;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch {
      return false;
    }
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      const d = max - min;
      if (d < 0.12 || l < 0.12 || l > 0.9) continue; // too grey / dark / light
      let hue;
      if (max === r) hue = ((g - b) / d) % 6;
      else if (max === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
      if (hue >= 80 && hue <= 165) continue; // green stems/leaves
      const bucket = Math.floor(hue / 20) * 20;
      buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
    }
    let best = -1;
    let bestN = 0;
    for (const [bucket, n] of buckets) {
      if (n > bestN) {
        bestN = n;
        best = bucket;
      }
    }
    return best >= 195 && best <= 300;
  }

  setZoom(z) {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  }

  zoomBy(factor) {
    this.setZoom(this.zoom * factor);
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
  }

  setKey(code, down) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  chunkAt(cx, cy, create) {
    const key = cx + ',' + cy;
    let chunk = this.chunks.get(key);
    if (!chunk && create) {
      const canvas = document.createElement('canvas');
      canvas.width = CHUNK * TILE;
      canvas.height = CHUNK * TILE;
      chunk = { grid: new Uint8Array(CHUNK * CHUNK), canvas, ctx: canvas.getContext('2d') };
      this.chunks.set(key, chunk);
    }
    return chunk || null;
  }

  // World fine-tile lookup; unpainted space is void.
  tileAt(tx, ty) {
    const cx = Math.floor(tx / CHUNK);
    const cy = Math.floor(ty / CHUNK);
    const chunk = this.chunks.get(cx + ',' + cy);
    if (!chunk) return TERRAIN.VOID;
    return chunk.grid[(ty - cy * CHUNK) * CHUNK + (tx - cx * CHUNK)];
  }

  // The AI thinks in coarse units (SCALE fine tiles each); may be negative.
  charTile() {
    return {
      x: Math.floor(this.charX / (TILE * SCALE)),
      y: Math.floor(this.charY / (TILE * SCALE))
    };
  }

  // Coarse-grid text map of the world around the player for the AI:
  // '.' void, 'G' grass, 'D' desert, 'F' forest, 'R' water, 'P' player.
  // Also includes a bounded coarse `overview` of the ENTIRE painted world
  // so the AI has some big-picture awareness ("there's an ocean far to the
  // north") without the payload growing unbounded as the world grows.
  mapSnapshot() {
    const here = this.charTile();
    const W = MAP_NEAR_W;
    const H = MAP_NEAR_H;
    const originX = here.x - Math.floor(W / 2);
    const originY = here.y - Math.floor(H / 2);
    const rows = [];
    for (let r = 0; r < H; r++) {
      let row = '';
      for (let c = 0; c < W; c++) {
        if (originX + c === here.x && originY + r === here.y) {
          row += 'P';
          continue;
        }
        const t = this.tileAt((originX + c) * SCALE + 2, (originY + r) * SCALE + 2);
        row += '.GDFRTIOSM'[t] || '.';
      }
      rows.push(row);
    }
    return { originX, originY, width: W, height: H, rows, overview: this._overviewSnapshot() };
  }

  // Coarse, bounded-size summary of the whole painted world: each cell
  // samples a small grid of points across a block of the fine AI grid and
  // reports whichever terrain showed up most (majority vote).
  _overviewSnapshot() {
    const b = this.worldBounds;
    if (!b) return null;
    const unit = TILE * SCALE;
    const x0 = Math.floor(b.minX / unit) - 2;
    const y0 = Math.floor(b.minY / unit) - 2;
    const x1 = Math.ceil(b.maxX / unit) + 2;
    const y1 = Math.ceil(b.maxY / unit) + 2;
    const spanX = Math.max(1, x1 - x0);
    const spanY = Math.max(1, y1 - y0);
    const block = Math.max(1, Math.ceil(Math.max(spanX, spanY) / MAP_OVERVIEW_MAX));
    const W = Math.min(MAP_OVERVIEW_MAX, Math.ceil(spanX / block));
    const H = Math.min(MAP_OVERVIEW_MAX, Math.ceil(spanY / block));
    const legend = '.GDFRTIOSM';
    const rows = [];
    for (let r = 0; r < H; r++) {
      let row = '';
      for (let c = 0; c < W; c++) {
        const counts = {};
        let best = TERRAIN.VOID;
        let bestN = -1;
        for (let sy = 0; sy < 3; sy++) {
          for (let sxi = 0; sxi < 3; sxi++) {
            const gx = x0 + c * block + Math.floor(((sxi + 0.5) * block) / 3);
            const gy = y0 + r * block + Math.floor(((sy + 0.5) * block) / 3);
            const t = this.tileAt(gx * SCALE + 2, gy * SCALE + 2);
            if (t === TERRAIN.VOID) continue;
            const n = (counts[t] = (counts[t] || 0) + 1);
            if (n > bestN) {
              bestN = n;
              best = t;
            }
          }
        }
        row += legend[best] || '.';
      }
      rows.push(row);
    }
    return { originX: x0, originY: y0, block, width: W, height: H, rows };
  }

  // Renders one tile onto its chunk canvas as a flat, crisp color — no
  // blending toward neighbors, so biome borders are clean hard edges
  // instead of a soft gradient.
  paintCell(tx, ty) {
    const code = this.tileAt(tx, ty);
    if (code === TERRAIN.VOID) return;
    const cx = Math.floor(tx / CHUNK);
    const cy = Math.floor(ty / CHUNK);
    const chunk = this.chunkAt(cx, cy, true);
    chunk.ctx.fillStyle = COLORS[code];
    chunk.ctx.fillRect((tx - cx * CHUNK) * TILE, (ty - cy * CHUNK) * TILE, TILE, TILE);
  }

  paint(tx, ty, code, overwrite) {
    const cx = Math.floor(tx / CHUNK);
    const cy = Math.floor(ty / CHUNK);
    const chunk = this.chunkAt(cx, cy, true);
    const i = (ty - cy * CHUNK) * CHUNK + (tx - cx * CHUNK);
    const cur = chunk.grid[i];
    // Tundra is cold: any liquid water it covers freezes to ice, no
    // overwrite needed — that's the biome's nature.
    let target = code;
    if (code === TERRAIN.TUNDRA && WATER.has(cur)) {
      target = TERRAIN.ICE;
    } else if (!overwrite) {
      // Ocean is special: when NOT overwriting it fills only truly empty
      // void, never touching existing terrain (not even grass) — so "no"
      // to the overwrite prompt still lays an ocean into the white space
      // around the land without changing a single existing pixel.
      if (code === TERRAIN.OCEAN) {
        if (cur !== TERRAIN.VOID) return;
      } else if (code === TERRAIN.GRASS) {
        // Grass is the base layer: features may settle on empty ground or
        // grass, but never silently eat other features unless overwriting.
        if (cur !== TERRAIN.VOID) return;
      } else if (cur !== TERRAIN.VOID && cur !== TERRAIN.GRASS) {
        return;
      }
    }
    if (cur === target) return;
    chunk.grid[i] = target;
    this.paintCell(tx, ty);
    this._growBounds(tx, ty);
  }

  _growBounds(tx, ty) {
    const x0 = tx * TILE;
    const y0 = ty * TILE;
    const x1 = x0 + TILE;
    const y1 = y0 + TILE;
    if (!this.worldBounds) {
      this.worldBounds = { minX: x0, minY: y0, maxX: x1, maxY: y1 };
      return;
    }
    const b = this.worldBounds;
    if (x0 < b.minX) b.minX = x0;
    if (y0 < b.minY) b.minY = y0;
    if (x1 > b.maxX) b.maxX = x1;
    if (y1 > b.maxY) b.maxY = y1;
  }

  // Nearest existing water tile to a fine-tile point, searching only the
  // chunks that intersect the connect range.
  nearestRiverTile(px, py) {
    let best = null;
    let bestD = Infinity;
    const c0x = Math.floor((px - CONNECT_RANGE) / CHUNK);
    const c1x = Math.floor((px + CONNECT_RANGE) / CHUNK);
    const c0y = Math.floor((py - CONNECT_RANGE) / CHUNK);
    const c1y = Math.floor((py + CONNECT_RANGE) / CHUNK);
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const chunk = this.chunks.get(cx + ',' + cy);
        if (!chunk) continue;
        for (let ly = 0; ly < CHUNK; ly++) {
          for (let lx = 0; lx < CHUNK; lx++) {
            if (!WATER.has(chunk.grid[ly * CHUNK + lx])) continue;
            const d = Math.hypot(cx * CHUNK + lx - px, cy * CHUNK + ly - py);
            if (d < bestD) {
              bestD = d;
              best = { x: cx * CHUNK + lx, y: cy * CHUNK + ly, d };
            }
          }
        }
      }
    }
    return best;
  }

  // True when either end of a proposed river path (AI coarse coords) is
  // within auto-connect range of existing water — used by the UI to ask
  // the player whether to join them.
  hasRiverNear(points) {
    const pts = (points || [])
      .map((p) => ({ x: Number(p.x) * SCALE + SCALE / 2, y: Number(p.y) * SCALE + SCALE / 2 }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pts.length < 2) return false;
    const head = this.nearestRiverTile(pts[0].x, pts[0].y);
    const tail = this.nearestRiverTile(pts[pts.length - 1].x, pts[pts.length - 1].y);
    const pick = [head, tail].filter(Boolean).sort((a, b) => a.d - b.d)[0];
    return !!(pick && pick.d > 2 && pick.d <= CONNECT_RANGE);
  }

  // Deep-copies world state so a prompt can be undone.
  snapshot() {
    const chunks = new Map();
    for (const [key, chunk] of this.chunks) chunks.set(key, Uint8Array.from(chunk.grid));
    this.history.push({
      chunks,
      riverEndpoints: this.riverEndpoints.map((e) => ({ ...e })),
      bounds: this.worldBounds ? { ...this.worldBounds } : null
    });
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
  }

  undo() {
    const snap = this.history.pop();
    if (!snap) return false;
    this.jobs = [];
    this.riverEndpoints = snap.riverEndpoints;
    this.worldBounds = snap.bounds;
    this.chunks = new Map();
    for (const [key, grid] of snap.chunks) {
      const [cx, cy] = key.split(',').map(Number);
      this.chunkAt(cx, cy, true).grid.set(grid);
    }
    // All grids restored first, then repaint so cross-chunk blends see the
    // final state.
    for (const [key, chunk] of this.chunks) {
      const [cx, cy] = key.split(',').map(Number);
      chunk.ctx.clearRect(0, 0, CHUNK * TILE, CHUNK * TILE);
      for (let ly = 0; ly < CHUNK; ly++) {
        for (let lx = 0; lx < CHUNK; lx++) {
          if (chunk.grid[ly * CHUNK + lx] !== TERRAIN.VOID) this.paintCell(cx * CHUNK + lx, cy * CHUNK + ly);
        }
      }
    }
    return true;
  }

  isBusy() {
    return this.jobs.length > 0;
  }

  applyEngineData(data) {
    if (!data || !data.terrain || !(data.terrain in TERRAIN_CODES)) return false;
    const code = TERRAIN_CODES[data.terrain];
    const overwrite = !!data.overwrite;

    if (data.terrain === 'river') {
      const pts = (data.points || [])
        .map((p) => ({ x: Number(p.x) * SCALE + SCALE / 2, y: Number(p.y) * SCALE + SCALE / 2 }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (pts.length < 2) return false;

      // Join to the closest existing river unless the AI says not to.
      if (data.connect !== false) {
        const head = this.nearestRiverTile(pts[0].x, pts[0].y);
        const tail = this.nearestRiverTile(pts[pts.length - 1].x, pts[pts.length - 1].y);
        const pick = [head, tail].filter(Boolean).sort((a, b) => a.d - b.d)[0];
        if (pick && pick.d > 2 && pick.d <= CONNECT_RANGE) {
          if (pick === head) pts.unshift({ x: pick.x, y: pick.y });
          else pts.push({ x: pick.x, y: pick.y });
        }
      }

      const width = Math.min(5, Math.max(0.4, Number(data.width) || 1));
      const tiles = riverTiles(pts, RIVER_RADIUS * width);
      if (!tiles.length) return false;
      this.snapshot();
      this.riverEndpoints.push({ x: pts[0].x, y: pts[0].y }, { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
      const total = tiles[tiles.length - 1].d;
      this.jobs.push({ tiles, idx: 0, front: 0, speed: Math.max(70, total / 1.4), code, overwrite });
    } else {
      const here = this.charTile();
      const isLake = data.terrain === 'lake';
      const isOcean = data.terrain === 'ocean';
      const coarseX = Number.isFinite(Number(data.centerX)) ? Number(data.centerX) : here.x;
      const coarseY = Number.isFinite(Number(data.centerY)) ? Number(data.centerY) : here.y;
      const coarseR = Math.min(160, Math.max(3, Number(data.maxRadius) || (isLake ? 12 : isOcean ? 38 : 40)));
      const seed = Number.isFinite(Number(data.seed)) ? Number(data.seed) : Math.random() * 1000;
      const roughness = Math.min(0.8, Math.max(0.3, Number(data.roughness) || 0.55));
      let cx = coarseX * SCALE + SCALE / 2;
      let cy = coarseY * SCALE + SCALE / 2;

      // Lakes can snap onto the mouth of an existing river.
      if (isLake && data.atRiverEnd) {
        let target = null;
        let bestD = Infinity;
        for (const e of this.riverEndpoints) {
          const d = Math.hypot(e.x - cx, e.y - cy);
          if (d < bestD) {
            bestD = d;
            target = e;
          }
        }
        if (!target) target = this.nearestRiverTile(cx, cy);
        if (target) {
          cx = target.x;
          cy = target.y;
        }
      }

      // Water bodies skip the per-pixel jag noise (smooth=true) so lakes
      // and oceans rasterize as one clean, contiguous body with no stray
      // isolated pixels fraying off the edge.
      const tiles = blobTiles(cx, cy, coarseR * SCALE, seed, roughness, WATER.has(code));
      this.snapshot();
      this.jobs.push({ tiles, idx: 0, front: 0, speed: BLOB_FRONT_SPEED, code, overwrite });
    }
    return true;
  }

  // Feet position in world px — used for ground checks (water/collision),
  // deliberately zoom-INDEPENDENT since gameplay shouldn't change as you
  // zoom. (Rendering's depth-sort anchor is different — see #draw.)
  feetY() {
    return this.charY + CHAR_DRAW * 0.42;
  }

  // Where the sprite's feet VISUALLY land in world px at the current zoom.
  // The player is drawn at a fixed on-screen size, so its feet correspond
  // to a world offset that shrinks as you zoom in and grows as you zoom
  // out (÷zoom). Ripples and the trample check both anchor here so they
  // track the sprite exactly instead of drifting away as zoom changes.
  visualFeetY() {
    return this.charY + (CHAR_DRAW * 0.42) / this.zoom;
  }

  inWater() {
    return WATER.has(this.tileAt(Math.floor(this.charX / TILE), Math.floor(this.feetY() / TILE)));
  }

  // Trample is tested from the sprite's visual feet, so "walked pixel"
  // means exactly the ground underfoot. Because the footprint is small and
  // sits at the feet, decor just ahead of the player (drawn in front, above
  // the feet) isn't touched until you actually step onto its base — the
  // depth illusion survives.
  _interactionPoint() {
    return { x: this.charX, y: this.visualFeetY() };
  }

  // Radius of the footfall in world px at the current zoom — the reach
  // within which decor counts as "on a walked pixel" and gets trampled.
  _trampleRadius() {
    return (TRAMPLE_FOOTPRINT / this.zoom) * 0.5;
  }

  update(dt) {
    this.time += dt;
    let vx = 0;
    let vy = 0;
    if (this.keys.has('KeyW')) vy -= 1;
    if (this.keys.has('KeyS')) vy += 1;
    if (this.keys.has('KeyA')) vx -= 1;
    if (this.keys.has('KeyD')) vx += 1;
    this.moving = vx !== 0 || vy !== 0;
    if (this.moving) {
      const len = Math.hypot(vx, vy);
      // Screen-space speed stays constant across zoom levels: zoomed out,
      // more world is visible, so moving faster underfoot keeps the same
      // pace on screen instead of feeling like a crawl.
      const speed = CHAR_SPEED / this.zoom;
      const dx = (vx / len) * speed * dt;
      const dy = (vy / len) * speed * dt;
      const b = this.worldBounds;
      const nx = this.charX + dx;
      const ny = this.charY + dy;
      this.charX = b ? Math.min(b.maxX + WORLD_MARGIN, Math.max(b.minX - WORLD_MARGIN, nx)) : nx;
      this.charY = b ? Math.min(b.maxY + WORLD_MARGIN, Math.max(b.minY - WORLD_MARGIN, ny)) : ny;
    }

    this._updateRipples(dt);
    this._updateTrample(dt);
    this._updateTumbleweeds(dt);
    this._updateClouds(dt);

    for (const job of this.jobs) {
      job.front += job.speed * dt;
      while (job.idx < job.tiles.length && job.tiles[job.idx].d <= job.front) {
        const t = job.tiles[job.idx++];
        this.paint(t.x, t.y, job.code, job.overwrite);
      }
    }
    this.jobs = this.jobs.filter((j) => j.idx < j.tiles.length);
  }

  // Small expanding rings spawned at the feet while swimming and moving —
  // each grows from RIPPLE_MIN_RADIUS to RIPPLE_MAX_RADIUS over its life
  // then vanishes. No ground pixels are touched; this is purely an overlay.
  _updateRipples(dt) {
    if (this.ripples.length) this.ripples = this.ripples.filter((r) => this.time - r.born < RIPPLE_LIFE);
    if (!this.moving || !this.inWater()) {
      this._lastRipplePos = null;
      this._rippleDist = 0;
      return;
    }
    const fx = this.charX;
    const fy = this.visualFeetY();
    if (this._lastRipplePos) {
      this._rippleDist += Math.hypot(fx - this._lastRipplePos.x, fy - this._lastRipplePos.y);
    }
    this._lastRipplePos = { x: fx, y: fy };
    if (this._rippleDist < RIPPLE_STEP) return;
    this._rippleDist = 0;
    this.ripples.push({ x: fx, y: fy, born: this.time });
  }

  // Generic per-decor trample interaction: for every decor TYPE that opts
  // in via `interact: 'trample'`, check the small neighborhood of lattice
  // cells around the player's interaction point (NOT a radius around the
  // player scooping up everything nearby — each candidate is tested
  // against its own tight footprint). Standing on one sinks it into the
  // ground and fades it out; once the player has moved off it for a bit,
  // it grows back. New decor types opt into this for free just by adding
  // `interact: 'trample'` to their DECOR entry.
  _updateTrample(dt) {
    const pt = this._interactionPoint();
    const now = this.time;

    // Pass 1 — detection only: sweep the lattice cells overlapping the
    // footfall. A decor counts as trampled when its BASE sits on a walked
    // pixel — i.e. within the trample radius (plus a touch of its own trunk
    // width). Standing on one starts it sinking, or (if already
    // mid-animation) just refreshes when it was last stood on.
    const trampleR = this._trampleRadius();
    const nearNow = new Set();
    for (const codeKey of Object.keys(DECOR)) {
      const cfg = DECOR[codeKey];
      if (!cfg.interact) continue;
      const codeNum = Number(codeKey);
      const pitch = cfg.cell * TILE;
      const gx0 = Math.floor(pt.x / pitch);
      const gy0 = Math.floor(pt.y / pitch);
      const reach = Math.max(1, Math.ceil((trampleR + cfg.w * 0.5) / pitch));
      for (let oy = -reach; oy <= reach; oy++) {
        for (let ox = -reach; ox <= reach; ox++) {
          const item = this.decorAt(codeNum, cfg, gx0 + ox, gy0 + oy);
          if (!item) continue;
          if (Math.hypot(item.x - pt.x, item.y - pt.y) > trampleR + item.w * 0.15) continue;
          nearNow.add(item.key);
          const st = this.trample.get(item.key);
          if (!st || st.state === 'up') {
            this.trample.set(item.key, { state: 'sinking', since: now, lastNear: now });
          } else {
            st.lastNear = now;
            if (st.state === 'growing') {
              st.state = 'sinking';
              st.since = now;
            }
          }
        }
      }
    }

    // Pass 2 — advance every currently-tracked entry's timer regardless of
    // whether the player is anywhere near it right now. Without this, a
    // long walk through the forest would leave every earlier tree frozen
    // mid-animation forever (or until the player happened to walk back
    // over that exact spot) instead of quietly healing on its own once
    // enough time has passed since it was last stood on.
    for (const [key, st] of this.trample) {
      if (st.state === 'sinking' && now - st.since >= TRAMPLE_SINK) {
        st.state = 'hidden';
        st.since = now;
      } else if (st.state === 'hidden' && !nearNow.has(key) && now - st.lastNear >= TRAMPLE_REGROW_DELAY) {
        st.state = 'growing';
        st.since = now;
      } else if (st.state === 'growing' && now - st.since >= TRAMPLE_GROW) {
        this.trample.delete(key);
      }
    }
  }

  _updateTumbleweeds(dt) {
    this._twSpawnT += dt;
    if (this._twSpawnT >= TUMBLEWEED_SPAWN_CHECK) {
      this._twSpawnT = 0;
      if (this.tumbleweeds.length < TUMBLEWEED_MAX) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 200 + Math.random() * 700;
        const px = this.charX + Math.cos(ang) * dist;
        const py = this.charY + Math.sin(ang) * dist;
        if (this.tileAt(Math.floor(px / TILE), Math.floor(py / TILE)) === TERRAIN.DESERT) {
          const dirAng = Math.random() * Math.PI * 2;
          this.tumbleweeds.push({
            x: px,
            y: py,
            dx: Math.cos(dirAng),
            dy: Math.sin(dirAng),
            ang: 0,
            bob: Math.random() * Math.PI * 2, // hop phase, so they don't bounce in sync
            speed: 40 + Math.random() * 35
          });
        }
      }
    }

    this.tumbleweeds = this.tumbleweeds.filter(
      (tw) => Math.hypot(tw.x - this.charX, tw.y - this.charY) < TUMBLEWEED_DESPAWN_DIST
    );
    const b = this.worldBounds;
    for (const tw of this.tumbleweeds) {
      // Random gusts occasionally send it off in a new direction, even
      // with nothing blocking it.
      if (Math.random() < TUMBLEWEED_GUST_CHANCE * dt) {
        const a = Math.random() * Math.PI * 2;
        tw.dx = Math.cos(a);
        tw.dy = Math.sin(a);
      }
      const nx = tw.x + tw.dx * tw.speed * dt;
      const ny = tw.y + tw.dy * tw.speed * dt;
      const onDesert = this.tileAt(Math.floor(nx / TILE), Math.floor(ny / TILE)) === TERRAIN.DESERT;
      const inBounds =
        !b ||
        (nx >= b.minX - WORLD_MARGIN && nx <= b.maxX + WORLD_MARGIN && ny >= b.minY - WORLD_MARGIN && ny <= b.maxY + WORLD_MARGIN);
      if (onDesert && inBounds) {
        tw.x = nx;
        tw.y = ny;
        // Rolls in the direction it's moving — rotation tracks distance
        // traveled like a wheel — and hops up and down as it goes, so it
        // reads as a bouncing tumbleweed rather than a sprite sliding flat.
        tw.ang += (tw.speed * dt) / (TUMBLEWEED_SIZE * 0.5);
        tw.bob += tw.speed * dt * TUMBLEWEED_BOUNCE_RATE;
      } else {
        // Hit a biome edge or the map's edge — rebound, with a little
        // randomness so it doesn't just ping-pong the same line forever.
        tw.dx = -tw.dx + (Math.random() - 0.5) * 0.6;
        tw.dy = -tw.dy + (Math.random() - 0.5) * 0.6;
        const len = Math.hypot(tw.dx, tw.dy) || 1;
        tw.dx /= len;
        tw.dy /= len;
      }
    }
  }

  // The rectangle clouds live in: the whole painted world plus a margin
  // (so they drift a bit past the coastline), or a patch around the player
  // before any land exists.
  _cloudRegion() {
    const b = this.worldBounds;
    const m = CLOUD_EDGE_MARGIN;
    if (b) return { minX: b.minX - m, minY: b.minY - m, maxX: b.maxX + m, maxY: b.maxY + m };
    return { minX: this.charX - 800, minY: this.charY - 800, maxX: this.charX + 800, maxY: this.charY + 800 };
  }

  _cloudTarget(region) {
    const r = region || this._cloudRegion();
    const area = (r.maxX - r.minX) * (r.maxY - r.minY);
    return Math.max(CLOUD_MIN, Math.min(CLOUD_MAX, Math.round(area / CLOUD_AREA)));
  }

  _spawnCloud(region) {
    const r = region || this._cloudRegion();
    return {
      x: r.minX + Math.random() * (r.maxX - r.minX),
      y: r.minY + Math.random() * (r.maxY - r.minY),
      speed: 8 + Math.random() * 10,
      scale: 0.8 + Math.random() * 0.5,
      puff: Math.floor(Math.random() * 100),
      face: Math.random() < 0.01, // 1-in-100: this one is the cloudface
      bob: Math.random() * Math.PI * 2 // vertical-jiggle phase, out of sync per cloud
    };
  }

  // Spreads clouds evenly across the whole map and keeps the flock sized to
  // the land — adding more as the world grows (trimming if it shrinks).
  _stockClouds() {
    const region = this._cloudRegion();
    const target = this._cloudTarget(region);
    while (this.clouds.length < target) this.clouds.push(this._spawnCloud(region));
    if (this.clouds.length > target) this.clouds.length = target;
  }

  _updateClouds(dt) {
    if (!this.cloudsOn) return;
    this._stockClouds(); // grow the flock as more land appears
    const r = this._cloudRegion();
    for (const c of this.clouds) {
      // Every cloud drifts the same way (wind), and jiggles vertically.
      c.x += CLOUD_WIND.x * c.speed * dt;
      c.y += CLOUD_WIND.y * c.speed * dt;
      c.bob += dt * CLOUD_BOB_RATE;
      // Drifted off the downwind edge — respawn on the UPWIND edge (fresh
      // look and a new 1-in-100 face chance) so it blows back across.
      if (c.x < r.minX || c.x > r.maxX || c.y < r.minY || c.y > r.maxY) {
        const fresh = this._spawnCloud(r);
        if (Math.abs(CLOUD_WIND.x) >= Math.abs(CLOUD_WIND.y)) fresh.x = CLOUD_WIND.x >= 0 ? r.minX : r.maxX;
        else fresh.y = CLOUD_WIND.y >= 0 ? r.minY : r.maxY;
        Object.assign(c, fresh);
      }
    }
  }

  // Purely decorative sky layer, toggled by telling the AI something like
  // "add clouds" / "turn off the clouds" (see App.jsx) rather than a UI
  // button. Draws the real cloud PNGs (assets/nature_pack/sky/cloud1.png,
  // cloud2.png — auto-loaded as the `cloud` pool, same convention as all
  // decor), and falls back to a simple drawn puff shape if none exist yet.
  // The special `cloudface` sprite is a rare surprise: any given cloud has
  // a ~1-in-100 chance of being the face instead of a plain cloud.
  setClouds(on) {
    this.cloudsOn = !!on;
    if (this.cloudsOn) this._stockClouds();
    else this.clouds = [];
  }

  // Maps a coherence value in [0,1) to a variant index using per-variant
  // weights (a CDF walk), so heavily-weighted variants occupy more of the
  // range. Used to make certain flower colors rarer — see variantWeights.
  static weightedVariant(t, wspec) {
    let r = t * wspec.total;
    const w = wspec.weights;
    for (let i = 0; i < w.length - 1; i++) {
      if (r < w[i]) return i;
      r -= w[i];
    }
    return w.length - 1;
  }

  // Core per-lattice-cell decor logic, shared by the viewport sweep
  // (visibleDecor) and the interaction sweep (_updateTrample) so they can
  // never disagree about what exists where. Everything renders at the decor
  // type's single base cell/size (no LOD). Returns null when this cell has
  // nothing, or an item descriptor otherwise.
  decorAt(codeNum, cfg, gx, gy) {
    const cell = cfg.cell;
    const poolNames = Array.isArray(cfg.img) ? cfg.img : [cfg.img];
    const pools = poolNames.map((n) => this.decor[n]).filter((p) => p && p.length);
    if (!pools.length) return null;
    const tx = gx * cell + Math.floor(hash(gx, gy, 5.1 + codeNum) * cell);
    const ty = gy * cell + Math.floor(hash(gx, gy, 9.7 + codeNum) * cell);
    // Cheapest rejection first: if this spot isn't the decor's own biome,
    // bail before the (much costlier) formation / drift-noise / density
    // gates below. Zoomed out, most lattice cells fall outside their biome,
    // so this skips a lot of sin()-heavy noise work every frame.
    if (this.tileAt(tx, ty) !== codeNum) return null;
    if (codeNum === TERRAIN.MOUNTAIN) {
      const clusterCell = cfg.cell * MOUNTAIN_CLUSTER_MULT;
      const fgx = Math.floor(tx / clusterCell);
      const fgy = Math.floor(ty / clusterCell);
      let inside = false;
      for (let oy = -1; oy <= 1 && !inside; oy++) {
        for (let ox = -1; ox <= 1 && !inside; ox++) {
          const f = mountainFormation(fgx + ox, fgy + oy, clusterCell);
          if (f && inMountainFormation(tx, ty, f)) inside = true;
        }
      }
      if (!inside || hash(gx, gy, 12.9 + codeNum) > MOUNTAIN_FILL_CHANCE) return null;
    } else if (cfg.drift) {
      // Continuous coverage: a smooth noise field modulates local density
      // up/down, but there is no hard on/off threshold — so the meadow
      // never shows a sharp patch edge, just organic denser/sparser drifts
      // averaging to "covers most of the ground".
      const localDensity = cfg.density * (0.55 + 0.45 * smoothNoise(tx * 0.02, ty * 0.02, 77.7));
      if (hash(gx, gy, 12.9 + codeNum) > localDensity) return null;
    } else if (hash(gx, gy, 12.9 + codeNum) > cfg.density) {
      return null;
    }

    let pool = pools[0];
    if (pools.length > 1) {
      const region = smoothNoise(tx * 0.011 + 313.7, ty * 0.011, 88.8);
      let si = Math.floor(region * pools.length * 1.999) % pools.length;
      if (hash(gx, gy, 55.5 + codeNum) < 0.12) si = Math.floor(hash(gx, gy, 56.6 + codeNum) * pools.length) % pools.length;
      pool = pools[si];
    }
    // Per-variant weighting (e.g. bluish flowers thinned out) is keyed by
    // the pool name; only applies to single-pool decor like flowers.
    const wspec = poolNames.length === 1 ? this.variantWeights[poolNames[0]] : null;
    let vi = Math.floor(hash(gx, gy, 41.3 + codeNum) * pool.length) % pool.length;
    if (cfg.regionalVariant && pool.length > 1) {
      // Nearby cells lean toward the same variant (reads like a patch of
      // one species) with occasional strays, instead of a pure per-cell
      // random pick.
      const region = smoothNoise(tx * 0.02 + 91.1, ty * 0.02, 141.4 + codeNum);
      const stray = hash(gx, gy, 61.2 + codeNum) < 0.18;
      const t = stray ? hash(gx, gy, 62.4 + codeNum) : region;
      vi = wspec ? Engine.weightedVariant(t, wspec) : Math.floor(t * pool.length * 1.999) % pool.length;
    }
    const scaleJ = cfg.scaleJitter ? 0.8 + hash(gx, gy, 201.3 + codeNum) * 0.42 : 1;
    return {
      key: codeNum + ':' + gx + ':' + gy,
      x: tx * TILE + TILE / 2,
      y: ty * TILE + TILE / 2,
      w: cfg.w * scaleJ,
      h: cfg.h * scaleJ,
      img: pool[vi],
      interact: cfg.interact || null
    };
  }

  // Deterministic decoration sprites (trees, cacti, peaks, ...) over their
  // biomes inside the viewport, collected across every DECOR lattice and
  // depth-sorted together. Every type renders at its single base cell/size
  // regardless of zoom.
  visibleDecor(camX, camY, viewW, viewH) {
    const decor = [];
    for (const codeKey of Object.keys(DECOR)) {
      const codeNum = Number(codeKey);
      const cfg = DECOR[codeKey];
      const pitch = cfg.cell * TILE;
      const pad = Math.max(cfg.h, cfg.w) + 8;
      const g0x = Math.floor((camX - pad) / pitch);
      const g1x = Math.floor((camX + viewW + pad) / pitch);
      const g0y = Math.floor((camY - pad) / pitch);
      const g1y = Math.floor((camY + viewH + pad) / pitch);
      for (let gy = g0y; gy <= g1y; gy++) {
        for (let gx = g0x; gx <= g1x; gx++) {
          const item = this.decorAt(codeNum, cfg, gx, gy);
          if (item) decor.push(item);
        }
      }
    }
    decor.sort((a, b) => a.y - b.y);
    return decor;
  }

  // Renders the ENTIRE painted world — every chunk plus decor at full
  // detail, not just what's on screen — onto an offscreen canvas for the
  // share feature, downscaled to fit within maxDim on its longest side so
  // huge worlds stay a reasonably sized image.
  renderFullMap(maxDim = 2200) {
    const b = this.worldBounds;
    if (!b) return null;
    const pad = 60;
    const fullW = b.maxX - b.minX + pad * 2;
    const fullH = b.maxY - b.minY + pad * 2;
    const scale = Math.min(1.5, maxDim / Math.max(fullW, fullH));
    const outW = Math.max(1, Math.round(fullW * scale));
    const outH = Math.max(1, Math.round(fullH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    const ox = -b.minX + pad;
    const oy = -b.minY + pad;
    const span = CHUNK * TILE;

    for (const [key, chunk] of this.chunks) {
      const [cx, cy] = key.split(',').map(Number);
      const x = Math.round((cx * span + ox) * scale);
      const y = Math.round((cy * span + oy) * scale);
      const w = Math.round(span * scale);
      const h = Math.round(span * scale);
      if (w > 0 && h > 0) ctx.drawImage(chunk.canvas, x, y, w, h);
    }

    const decor = this.visibleDecor(b.minX - pad, b.minY - pad, fullW, fullH);
    for (const d of decor) {
      const w = Math.max(1, Math.round(d.w * scale));
      const h = Math.max(1, Math.round(d.h * scale * (d.img.height / d.img.width)));
      ctx.drawImage(d.img, 0, 0, d.img.width, d.img.height, Math.round((d.x + ox) * scale) - (w >> 1), Math.round((d.y + oy) * scale) - h, w, h);
    }

    // Mark the player's own position so the shared picture shows where
    // their journey has been.
    const px = Math.round((this.charX + ox) * scale);
    const py = Math.round((this.charY + oy) * scale);
    ctx.fillStyle = '#e6483f';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(3, 5 * scale), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    ctx.stroke();

    return canvas;
  }

  draw() {
    const { ctx, canvas } = this;
    const zoom = this.zoom;
    // The visible window in world pixels grows as you zoom out; the camera
    // keeps the player centered within it.
    const viewW = canvas.width / zoom;
    const viewH = canvas.height / zoom;
    const camX = this.charX - viewW / 2;
    const camY = this.charY - viewH / 2;
    // World → screen. Chunks round their EDGES through this so adjacent
    // chunks always share the exact same device pixel — a scale transform
    // instead leaves subpixel gaps that show as white grid lines when
    // zoomed out.
    const sx = (wx) => (wx - camX) * zoom;
    const sy = (wy) => (wy - camY) * zoom;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;

    const span = CHUNK * TILE;
    const c0x = Math.floor(camX / span);
    const c1x = Math.floor((camX + viewW) / span);
    const c0y = Math.floor(camY / span);
    const c1y = Math.floor((camY + viewH) / span);
    for (let cy = c0y; cy <= c1y; cy++) {
      const y0 = Math.round(sy(cy * span));
      const y1 = Math.round(sy((cy + 1) * span));
      for (let cx = c0x; cx <= c1x; cx++) {
        const chunk = this.chunks.get(cx + ',' + cy);
        if (!chunk) continue;
        const x0 = Math.round(sx(cx * span));
        const x1 = Math.round(sx((cx + 1) * span));
        ctx.drawImage(chunk.canvas, x0, y0, x1 - x0, y1 - y0);
      }
    }

    // Water ripples: recolor the water's pixels to white in an expanding ring
    // at the feet while swimming — tile-quantized pixel blocks (pixel-art
    // style), not a drawn circle. Only water tiles are recolored, fully opaque.
    // Drawn under decor/the player like the old trail was.
    if (this.ripples.length) {
      ctx.fillStyle = '#f2fbff';
      for (const r of this.ripples) {
        const t = Math.min(1, (this.time - r.born) / RIPPLE_LIFE);
        const radius = RIPPLE_MIN_RADIUS + (RIPPLE_MAX_RADIUS - RIPPLE_MIN_RADIUS) * t;
        const txMin = Math.floor((r.x - radius - TILE) / TILE);
        const txMax = Math.ceil((r.x + radius + TILE) / TILE);
        const tyMin = Math.floor((r.y - radius - TILE) / TILE);
        const tyMax = Math.ceil((r.y + radius + TILE) / TILE);
        for (let ty = tyMin; ty <= tyMax; ty++) {
          for (let tx = txMin; tx <= txMax; tx++) {
            const cxw = (tx + 0.5) * TILE;
            const cyw = (ty + 0.5) * TILE;
            const dist = Math.hypot(cxw - r.x, cyw - r.y);
            if (Math.abs(dist - radius) > TILE) continue;
            if (!WATER.has(this.tileAt(tx, ty))) continue;
            const px = Math.round(sx(tx * TILE));
            const py = Math.round(sy(ty * TILE));
            ctx.fillRect(px, py, Math.round(sx((tx + 1) * TILE)) - px, Math.round(sy((ty + 1) * TILE)) - py);
          }
        }
      }
    }

    // Depth-sorted scene: decorations above the player's feet render behind
    // them, ones below render in front, so walking "through" a forest or
    // mountain range reads correctly. Decor is pre-sorted top-to-bottom so
    // sprites stack cleanly.
    const { idle, walk, water } = this.images;
    const decor = this.visibleDecor(camX, camY, viewW, viewH);
    if (this.tumbleweeds.length) {
      const twPool = this.decor.tumbleweed;
      if (twPool && twPool.length) {
        for (const tw of this.tumbleweeds) {
          // Depth-sorts by its ground y (tw.y); the hop is a purely visual
          // upward draw offset applied at render time, so bouncing never
          // reshuffles what's in front of/behind it.
          const bob = Math.abs(Math.sin(tw.bob)) * TUMBLEWEED_BOUNCE;
          decor.push({ x: tw.x, y: tw.y, w: TUMBLEWEED_SIZE, h: TUMBLEWEED_SIZE, img: twPool[0], rot: tw.ang, bob, key: null, interact: null });
        }
        decor.sort((a, b) => a.y - b.y);
      }
    }
    // The player's own on-screen size never changes with zoom (the camera
    // always keeps them dead-center), but the world-space "feet" line decor
    // depth-sorts against must scale with 1/zoom to match that fixed box,
    // or the split point drifts away from the true sprite as you zoom.
    const playerBase = this.charY + (CHAR_DRAW / 2) / zoom;
    const swimming = this.inWater();

    const drawDecor = (t) => {
      let scaleY = 1;
      let alpha = 1;
      let shiftY = 0;
      if (t.interact) {
        const st = this.trample.get(t.key);
        if (st) {
          if (st.state === 'hidden') return; // ground's clear — nothing to draw
          const dur = st.state === 'sinking' ? TRAMPLE_SINK : TRAMPLE_GROW;
          const p = Math.min(1, (this.time - st.since) / dur);
          const k = st.state === 'sinking' ? p : 1 - p; // 0 = normal, 1 = fully sunk
          scaleY = 1 - k * 0.85;
          alpha = 1 - k;
          shiftY = k * t.h * 0.5;
        }
      }
      const w = Math.max(1, Math.round(t.w * zoom));
      const h = Math.max(1, Math.round(t.h * zoom * (t.img.height / t.img.width) * scaleY));
      if (alpha < 1) ctx.globalAlpha = Math.max(0, alpha);
      if (t.rot) {
        // Rolling entities (tumbleweed) pivot around their own center,
        // not a ground-anchored base — and lift by their current hop
        // height (bob), scaled into screen px.
        ctx.save();
        ctx.translate(Math.round(sx(t.x)), Math.round(sy(t.y) - (t.bob || 0) * zoom));
        ctx.rotate(t.rot);
        ctx.drawImage(t.img, 0, 0, t.img.width, t.img.height, -(w >> 1), -(h >> 1), w, h);
        ctx.restore();
      } else {
        ctx.drawImage(t.img, 0, 0, t.img.width, t.img.height, Math.round(sx(t.x)) - (w >> 1), Math.round(sy(t.y) + shiftY * zoom) - h, w, h);
      }
      if (alpha < 1) ctx.globalAlpha = 1;
    };
    const drawPlayer = () => {
      // Fixed on-screen size regardless of zoom — the camera always keeps
      // the player exactly at canvas center (sx(charX)/sy(charY) reduce to
      // that by construction), so we can draw straight in device pixels
      // without going through the world scale at all.
      const size = CHAR_DRAW;
      const dx = Math.round(canvas.width / 2 - size / 2);
      let dy = Math.round(canvas.height / 2 - size / 2);
      if (swimming && water) {
        const frame = Math.floor(this.time * WATER_FPS) % 2;
        ctx.drawImage(water, frame * 16, 0, 16, 16, dx, dy, size, size);
        return;
      }
      if (this.moving && walk) {
        const frame = Math.floor(this.time * WALK_FPS) % 2;
        ctx.drawImage(walk, frame * 16, 0, 16, 16, dx, dy, size, size);
        return;
      }
      if (idle) {
        const frames = Math.max(1, Math.floor(idle.width / 16));
        if (frames >= 2) {
          const frame = Math.floor(this.time / IDLE_SPF) % frames;
          ctx.drawImage(idle, frame * 16, 0, 16, 16, dx, dy, size, size);
        } else {
          // Single idle frame: fake the second frame with a gentle
          // breathing bob on the same 1s cadence.
          dy += Math.floor(this.time / IDLE_SPF) % 2 === 0 ? 0 : 3;
          ctx.drawImage(idle, 0, 0, 16, 16, dx, dy, size, size);
        }
      }
    };

    let i = 0;
    while (i < decor.length && decor[i].y <= playerBase) {
      drawDecor(decor[i]);
      i++;
    }
    drawPlayer();
    while (i < decor.length) {
      drawDecor(decor[i]);
      i++;
    }

    // Clouds are in the sky — drawn above everything, big and a little
    // transparent so they cast a soft presence over the map without fully
    // hiding what's underneath.
    if (this.cloudsOn && this.clouds.length) {
      const pool = this.decor.cloud;
      const facePool = this.decor.cloudface;
      ctx.globalAlpha = CLOUD_ALPHA;
      for (const c of this.clouds) {
        const w = CLOUD_SIZE * c.scale;
        const h = CLOUD_SIZE * 0.53 * c.scale;
        const ccx = Math.round(sx(c.x));
        // Stepped (rounded) vertical offset — the cloud hops between whole
        // pixel positions rather than sliding, for a pixel-art jiggle.
        const ccy = Math.round(sy(c.y)) + Math.round(Math.sin(c.bob) * CLOUD_BOB_AMP);
        // Rare face cloud when one is present; otherwise a normal cloud.
        const img =
          c.face && facePool && facePool.length
            ? facePool[0]
            : pool && pool.length
            ? pool[c.puff % pool.length]
            : null;
        if (img) {
          const dw = Math.max(1, Math.round(w * zoom));
          const dh = Math.max(1, Math.round(w * zoom * (img.height / img.width)));
          ctx.drawImage(img, 0, 0, img.width, img.height, ccx - (dw >> 1), ccy - (dh >> 1), dw, dh);
        } else {
          // No cloud sprite dropped into assets/nature_pack yet — draw a
          // simple puffy shape so the feature works out of the box; add a
          // nature_pack/*/cloud*.png later and it takes over automatically.
          const rw = (w / 2) * zoom;
          const rh = (h / 2) * zoom;
          ctx.fillStyle = '#f4f7fa';
          ctx.beginPath();
          ctx.ellipse(ccx - rw * 0.35, ccy, rw * 0.62, rh * 0.75, 0, 0, Math.PI * 2);
          ctx.ellipse(ccx + rw * 0.32, ccy, rw * 0.68, rh * 0.8, 0, 0, Math.PI * 2);
          ctx.ellipse(ccx, ccy - rh * 0.28, rw * 0.7, rh * 0.72, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
