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
  [TERRAIN.TUNDRA]: '#e8eff3',
  [TERRAIN.ICE]: '#c9e8f5',
  [TERRAIN.OCEAN]: '#7b8fe4', // all liquid water is one color; only ice differs
  [TERRAIN.SAVANNAH]: '#d9c565',
  [TERRAIN.MOUNTAIN]: null // grassy ground beneath the peaks — set from GRASS below
};
COLORS[TERRAIN.MOUNTAIN] = COLORS[TERRAIN.GRASS];

// Liquid water (ice is frozen solid — walkable, not swimmable).
const WATER = new Set([TERRAIN.RIVER, TERRAIN.OCEAN]);
// Water and ice render flat and crisp — they never gradient-mix with land.
const NO_BLEND = new Set([TERRAIN.RIVER, TERRAIN.OCEAN, TERRAIN.ICE]);

const CHUNK = 64; // fine tiles per chunk side (192px canvases)
const CHAR_DRAW = 96; // 16px sprite drawn at 6x
const CHAR_SPEED = 220; // px per second
const LEASH_PX = 300; // how far into the white void you can wander from solid ground
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

// Decoration fields: jittered lattices keyed by world position, so sprites
// are deterministic, need no storage, and exist wherever their biome does.
// cell = lattice pitch in fine tiles, density = fraction of cells occupied,
// w/h = draw size in world px. Forest stays dense and leafy; the others
// are sparser set-dressing.
const DECOR = {
  [TERRAIN.FOREST]: { img: 'tree', cell: 5, density: 0.9, w: 30, h: 30 },
  [TERRAIN.SAVANNAH]: { img: 'acacia', cell: 14, density: 0.2, w: 39, h: 36 },
  [TERRAIN.DESERT]: { img: 'cactus', cell: 22, density: 0.06, w: 21, h: 27 },
  [TERRAIN.MOUNTAIN]: { img: 'mountain', cell: 17, density: 0.28, w: 92, h: 88 },
  [TERRAIN.TUNDRA]: { img: 'snowtree', cell: 12, density: 0.3, w: 27, h: 30 }
};

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

// Biome border blending: each painted tile shades toward the nearest
// different biome within this offset ring (sorted nearest-first), with
// per-tile dithering, so borders read as organic gradients instead of
// hard seams.
const BLEND_OFFSETS = (() => {
  const offs = [];
  for (let oy = -2; oy <= 2; oy++) {
    for (let ox = -2; ox <= 2; ox++) {
      if (ox === 0 && oy === 0) continue;
      const d = Math.hypot(ox, oy);
      if (d <= 2) offs.push({ x: ox, y: oy, d });
    }
  }
  offs.sort((a, b) => a.d - b.d);
  return offs;
})();

const RGB = Object.fromEntries(
  Object.entries(COLORS).map(([code, hex]) => [
    code,
    [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
  ])
);

function blendColor(codeA, codeB, f) {
  const a = RGB[codeA];
  const b = RGB[codeB];
  const r = Math.round(a[0] + (b[0] - a[0]) * f);
  const g = Math.round(a[1] + (b[1] - a[1]) * f);
  const bl = Math.round(a[2] + (b[2] - a[2]) * f);
  return `rgb(${r},${g},${bl})`;
}

// A tile's "effective distance" from the blob center: euclidean distance
// distorted by low-frequency lobes (big organic bulges), a mid-frequency
// crinkle octave, and per-tile jitter (pixel-dust edge speckle).
function effectiveDistance(x, y, cx, cy, maxRadius, seed, roughness) {
  const dist = Math.hypot(x - cx, y - cy);
  const lobe = (smoothNoise(x * 0.016, y * 0.016, seed) - 0.5) * 2;
  const mid = (smoothNoise(x * 0.09, y * 0.09, seed + 31) - 0.5) * 2;
  const jag = (hash(x, y, seed + 99) - 0.5) * 2;
  return dist + lobe * maxRadius * 0.45 * roughness + mid * maxRadius * 0.1 * roughness + jag * (1 + roughness * 3);
}

// All tiles belonging to a noisy blob, sorted nearest-first so the engine
// can reveal them frame-by-frame as an expanding front.
export function blobTiles(cx, cy, maxRadius, seed, roughness) {
  const margin = Math.ceil(maxRadius * 0.55 * roughness + roughness * 3 + 4);
  const reach = maxRadius + margin;
  const tiles = [];
  for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y++) {
    for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x++) {
      const d = effectiveDistance(x, y, cx, cy, maxRadius, seed, roughness);
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
// the water's half-width in fine tiles.
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
          // Smooth low-amplitude edge wave (fixed size, independent of
          // river width) instead of per-tile spray, so banks read as clean
          // water — especially on wide rivers.
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
    this.lastSolid = { x: 0, y: 0 };
    this.history = [];
    this.riverEndpoints = [];
    this.resize(window.innerWidth, window.innerHeight);
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
  mapSnapshot() {
    const here = this.charTile();
    const W = 120;
    const H = 64;
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
    return { originX, originY, width: W, height: H, rows };
  }

  // Renders one tile onto its chunk canvas, blended toward the nearest
  // different biome so borders grade into each other.
  paintCell(tx, ty) {
    const code = this.tileAt(tx, ty);
    if (code === TERRAIN.VOID) return;
    const cx = Math.floor(tx / CHUNK);
    const cy = Math.floor(ty / CHUNK);
    const chunk = this.chunkAt(cx, cy, true);
    let color = COLORS[code];
    // Water and ice render as flat, crisp colors — no gradient mixing with
    // land, which looked muddy at the banks.
    if (!NO_BLEND.has(code)) {
      for (const o of BLEND_OFFSETS) {
        const n = this.tileAt(tx + o.x, ty + o.y);
        // Skip void, water, and ice neighbors: only land biomes blend into
        // each other, so land keeps a clean edge against water.
        if (n !== TERRAIN.VOID && n !== code && !NO_BLEND.has(n)) {
          const falloff = (1 - (o.d - 1) / 1.5) * 0.5;
          const dither = 0.6 + 0.8 * hash(tx, ty, 3.7);
          const f = Math.min(0.5, Math.max(0, falloff * dither));
          color = blendColor(code, n, f);
          break;
        }
      }
    }
    chunk.ctx.fillStyle = color;
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
      // Grass is the base layer: features may settle on empty ground or
      // grass, but never silently eat other features unless overwriting.
      if (code === TERRAIN.GRASS) {
        if (cur !== TERRAIN.VOID) return;
      } else if (cur !== TERRAIN.VOID && cur !== TERRAIN.GRASS) {
        return;
      }
    }
    if (cur === target) return;
    chunk.grid[i] = target;
    this.paintCell(tx, ty);
    // Refresh neighbors so both sides of a border pick up the gradient.
    // When this tile REPLACED another biome, same-code neighbors may hold
    // stale blends toward the old color, so everything nearby repaints;
    // fresh paint on void only needs the differing side refreshed.
    const changedBiome = cur !== TERRAIN.VOID;
    for (const o of BLEND_OFFSETS) {
      const n = this.tileAt(tx + o.x, ty + o.y);
      if (n === TERRAIN.VOID) continue;
      if (changedBiome || n !== target) this.paintCell(tx + o.x, ty + o.y);
    }
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
    this.history.push({ chunks, riverEndpoints: this.riverEndpoints.map((e) => ({ ...e })) });
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
  }

  undo() {
    const snap = this.history.pop();
    if (!snap) return false;
    this.jobs = [];
    this.riverEndpoints = snap.riverEndpoints;
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
      const coarseR = Math.min(80, Math.max(3, Number(data.maxRadius) || (isLake ? 12 : isOcean ? 38 : 40)));
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

      const tiles = blobTiles(cx, cy, coarseR * SCALE, seed, roughness);
      this.snapshot();
      this.jobs.push({ tiles, idx: 0, front: 0, speed: BLOB_FRONT_SPEED, code, overwrite });
    }
    return true;
  }

  // Feet position in world px — used for ground checks and depth sorting.
  feetY() {
    return this.charY + CHAR_DRAW * 0.42;
  }

  inWater() {
    return WATER.has(this.tileAt(Math.floor(this.charX / TILE), Math.floor(this.feetY() / TILE)));
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
      const dx = (vx / len) * CHAR_SPEED * dt;
      const dy = (vy / len) * CHAR_SPEED * dt;
      // Walking off the map is allowed only a short way: the void "doesn't
      // exist", so you're leashed to the last solid ground you stood on.
      const ok = (x, y) => {
        const t = this.tileAt(Math.floor(x / TILE), Math.floor((y + CHAR_DRAW * 0.42) / TILE));
        if (t !== TERRAIN.VOID) return true;
        return Math.hypot(x - this.lastSolid.x, y - this.lastSolid.y) <= LEASH_PX;
      };
      const nx = this.charX + dx;
      const ny = this.charY + dy;
      if (ok(nx, ny)) {
        this.charX = nx;
        this.charY = ny;
      } else if (ok(nx, this.charY)) {
        this.charX = nx;
      } else if (ok(this.charX, ny)) {
        this.charY = ny;
      }
      if (this.tileAt(Math.floor(this.charX / TILE), Math.floor(this.feetY() / TILE)) !== TERRAIN.VOID) {
        this.lastSolid = { x: this.charX, y: this.charY };
      }
    }

    for (const job of this.jobs) {
      job.front += job.speed * dt;
      while (job.idx < job.tiles.length && job.tiles[job.idx].d <= job.front) {
        const t = job.tiles[job.idx++];
        this.paint(t.x, t.y, job.code, job.overwrite);
      }
    }
    this.jobs = this.jobs.filter((j) => j.idx < j.tiles.length);
  }

  // Zoomed out, individual decor sprites would multiply (more world is
  // visible) and shrink into speckle at the same time. Instead we thin the
  // lattice out in steps as zoom drops — coarser spacing, bigger sprites —
  // so a handful of large sprites read as "a batch of trees" from a
  // distance; zooming back in walks back down through the same steps,
  // filling in individual sprites again.
  static decorLod(zoom) {
    if (zoom >= 0.8) return 1;
    if (zoom >= 0.55) return 2;
    if (zoom >= 0.4) return 3;
    return 4;
  }

  // Deterministic decoration sprites (trees, cacti, peaks, ...) over their
  // biomes inside the viewport, collected across every DECOR lattice and
  // depth-sorted together.
  visibleDecor(camX, camY, viewW, viewH) {
    const decor = [];
    const lod = Engine.decorLod(this.zoom);
    for (const codeKey of Object.keys(DECOR)) {
      const codeNum = Number(codeKey);
      const cfg = DECOR[codeKey];
      const variants = this.decor[cfg.img];
      if (!variants || !variants.length) continue;
      const cell = cfg.cell * lod;
      const w = cfg.w * lod;
      const h = cfg.h * lod;
      const pitch = cell * TILE;
      const pad = Math.max(h, w) + 8;
      const g0x = Math.floor((camX - pad) / pitch);
      const g1x = Math.floor((camX + viewW + pad) / pitch);
      const g0y = Math.floor((camY - pad) / pitch);
      const g1y = Math.floor((camY + viewH + pad) / pitch);
      for (let gy = g0y; gy <= g1y; gy++) {
        for (let gx = g0x; gx <= g1x; gx++) {
          if (hash(gx, gy, 12.9 + codeNum) > cfg.density) continue;
          const tx = gx * cell + Math.floor(hash(gx, gy, 5.1 + codeNum) * cell);
          const ty = gy * cell + Math.floor(hash(gx, gy, 9.7 + codeNum) * cell);
          if (this.tileAt(tx, ty) !== codeNum) continue;
          // Stable per-cell variant pick — the same spot always renders the
          // same sprite across frames/reloads, but which variant it is
          // depends only on lattice position, giving natural-looking mix.
          const vi = Math.floor(hash(gx, gy, 41.3 + codeNum) * variants.length) % variants.length;
          decor.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, w, h, img: variants[vi] });
        }
      }
    }
    decor.sort((a, b) => a.y - b.y);
    return decor;
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

    // Depth-sorted scene: decorations above the player's feet render behind
    // them, ones below render in front, so walking "through" a forest or
    // mountain range reads correctly. Decor is pre-sorted top-to-bottom so
    // sprites stack cleanly.
    const { idle, walk, water } = this.images;
    const decor = this.visibleDecor(camX, camY, viewW, viewH);
    const playerBase = this.feetY();
    const swimming = this.inWater();

    const drawDecor = (t) => {
      const w = Math.max(1, Math.round(t.w * zoom));
      const h = Math.max(1, Math.round(t.h * zoom));
      ctx.drawImage(t.img, 0, 0, t.img.width, t.img.height, Math.round(sx(t.x)) - (w >> 1), Math.round(sy(t.y)) - h, w, h);
    };
    const drawPlayer = () => {
      const size = Math.max(1, Math.round(CHAR_DRAW * zoom));
      const dx = Math.round(sx(this.charX)) - (size >> 1);
      let dy = Math.round(sy(this.charY)) - (size >> 1);
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
          dy += Math.floor(this.time / IDLE_SPF) % 2 === 0 ? 0 : Math.max(1, Math.round(3 * zoom));
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

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
