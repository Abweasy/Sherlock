// Game simulation. Runs in the browser for solo play and on the server for
// online rooms. All state lives in a plain `world` object.

import {
  COLS, CHUNK_ROWS, UP, RIGHT, DOWN, LEFT, DX, DY, OPP, PLAYER_SPEED, START_X,
  POWERUPS, ENEMIES, ENEMY_LIST, NOVA_CHAIN, chainMult,
} from './constants.js';
import { Maze, key } from './maze.js';
import { mulberry32, hashInt } from './rng.js';

const VOID_MAX_LAG = 26;   // the Void never trails the leader by more than this
const ACTIVE_RANGE = 44;   // enemies further than this from every player sleep

export function createWorld(seed, opts = {}) {
  const maze = new Maze(seed);
  maze.ensure(64);
  return {
    seed, maze,
    taken: new Set(),      // tile keys whose dot/item has been collected
    fires: new Map(),      // tile key -> seconds remaining
    players: [],
    enemies: [],
    voidY: -14,
    time: 0,
    timers: { surge: 0, freeze: 0, chrono: 0 },
    events: [],
    rng: mulberry32((seed ^ 0x5bd1e995) >>> 0),
    nextId: 1,
    spawnChunk: 1,
    leaderY: 0,
    over: false,
    online: !!opts.online,
  };
}

export function addPlayer(w, { id, name = 'Player', color = '#3ef2ff', loadout = [], remote = false }) {
  const idx = w.players.length;
  const x = START_X[idx % START_X.length];
  const p = {
    id, name, color, loadout, remote,
    x, y: 0, dir: -1, want: -1, face: UP,
    tx: x, ty: 0,
    alive: true, cause: null,
    score: 0, chain: 0, bestChain: 0, coins: 0, gems: 0, kills: 0, dots: 0, maxY: 0,
    fx: {}, fxLvl: {}, surgeCombo: 0, empty: 0, bite: 0, magnetT: 0,
  };
  w.players.push(p);
  return p;
}

// Which power-up a power pickup gives to a given player. Deterministic per
// tile, so the icon a player sees in the maze is what they'll get.
export function itemPower(loadout, k) {
  if (!loadout || !loadout.length) return 'bomb';
  return loadout[hashInt(k) % loadout.length].id;
}

// ---------------------------------------------------------------------------
// Grid movement
// ---------------------------------------------------------------------------

function wrapX(e) {
  if (e.x > COLS - 0.5) e.x -= COLS;
  else if (e.x < -0.5) e.x += COLS;
}

// Move entity `e` `dist` tiles along the grid. `decide(e, atCenter)` returns
// the direction to take (or -1 to stop at a tile centre).
export function advance(e, dist, decide) {
  let guard = 0;
  while (dist > 1e-9 && guard++ < 8) {
    const rx = Math.round(e.x), ry = Math.round(e.y);
    const atCenter = Math.abs(e.x - rx) < 1e-6 && Math.abs(e.y - ry) < 1e-6;
    if (atCenter || e.dir < 0) {
      e.x = rx; e.y = ry;
      if (e.x >= COLS) e.x -= COLS;
      if (e.x < 0) e.x += COLS;
      const d = decide(e, true);
      e.dir = d;
      if (d < 0) return;
      const s = Math.min(dist, 1);
      e.x += DX[d] * s; e.y += DY[d] * s;
      dist -= s;
    } else {
      const nd = decide(e, false);
      if (nd >= 0) e.dir = nd;
      const d = e.dir;
      let rem;
      if (d === RIGHT) rem = Math.ceil(e.x) - e.x;
      else if (d === LEFT) rem = e.x - Math.floor(e.x);
      else if (d === UP) rem = Math.ceil(e.y) - e.y;
      else rem = e.y - Math.floor(e.y);
      if (rem < 1e-9) rem = 1;
      if (dist >= rem) {
        e.x = Math.round(e.x + DX[d] * rem);
        e.y = Math.round(e.y + DY[d] * rem);
        dist -= rem;
      } else {
        e.x += DX[d] * dist; e.y += DY[d] * dist;
        dist = 0;
      }
    }
    wrapX(e);
  }
}

// Player steering: buffered turns, instant reversal, and a little forgiveness
// for turning slightly late (helps a lot with swipe controls).
export function movePlayer(maze, p, dt) {
  if (p.dir >= 0 && p.want >= 0 && p.want !== p.dir && p.want !== OPP[p.dir]) {
    const cx = DX[p.dir] ? (p.dir === RIGHT ? Math.floor(p.x) : Math.ceil(p.x)) : p.x;
    const cy = DY[p.dir] ? (p.dir === UP ? Math.floor(p.y) : Math.ceil(p.y)) : p.y;
    const past = Math.abs(p.x - cx) + Math.abs(p.y - cy);
    if (past > 0 && past < 0.3) {
      const wx = (cx + COLS) % COLS;
      if (maze.canMove(wx, cy, p.want)) { p.x = wx; p.y = cy; }
    }
  }
  advance(p, PLAYER_SPEED * dt, (e, atCenter) => {
    if (atCenter) {
      if (e.want >= 0 && maze.canMove(e.x, e.y, e.want)) return e.want;
      if (e.dir >= 0 && maze.canMove(e.x, e.y, e.dir)) return e.dir;
      return -1;
    }
    return e.want === OPP[e.dir] ? e.want : e.dir;
  });
  if (p.dir >= 0) p.face = p.dir;
}

// ---------------------------------------------------------------------------
// Main step
// ---------------------------------------------------------------------------

export function step(w, dt) {
  if (w.over) return;
  w.time += dt;
  const maze = w.maze;

  let lead = -Infinity;
  for (const p of w.players) if (p.alive && p.y > lead) lead = p.y;
  if (lead > -Infinity) w.leaderY = lead;
  maze.ensure(Math.ceil(w.leaderY) + 48);

  while (w.spawnChunk * CHUNK_ROWS <= w.leaderY + 36) spawnChunk(w, w.spawnChunk++);

  for (const t in w.timers) if (w.timers[t] > 0) w.timers[t] = Math.max(0, w.timers[t] - dt);

  // Players
  for (const p of w.players) {
    if (!p.alive) continue;
    if (!p.remote) movePlayer(maze, p, dt);
    p.bite = Math.max(0, p.bite - dt);
    traverse(w, p);
    updatePlayerFx(w, p, dt);
  }

  // Fires
  for (const [k, t] of w.fires) {
    if (t - dt <= 0) w.fires.delete(k); else w.fires.set(k, t - dt);
  }

  // Enemies
  const frozen = w.timers.freeze > 0;
  for (const e of w.enemies) {
    if (e.dead) continue;
    if (e.vuln > 0) e.vuln = Math.max(0, e.vuln - dt);
    if (e.dash > 0) e.dash = Math.max(0, e.dash - dt);
    if (!frozen) updateEnemy(w, e, dt);
    if (w.fires.size && w.fires.has(key(wrapRound(e.x), Math.round(e.y)))) {
      const owner = w.players.find((p) => p.fx.blaze) || w.players[0];
      killEnemy(w, e, owner, 150, 'fire');
    }
  }

  collide(w);

  // The Void
  const vs = (1.15 + Math.min(3.4, w.leaderY / 260)) * (w.timers.chrono > 0 ? 0.3 : 1);
  w.voidY = Math.max(w.voidY + vs * dt, w.leaderY - VOID_MAX_LAG);
  for (const p of w.players) {
    if (p.alive && p.y < w.voidY + 0.15) killPlayer(w, p, 'void');
  }
  for (const e of w.enemies) if (!e.dead && e.y < w.voidY - 0.5) e.dead = true;
  if (w.enemies.length > 24 && w.enemies.some((e) => e.dead)) w.enemies = w.enemies.filter((e) => !e.dead);

  if (w.players.length && w.players.every((p) => !p.alive)) w.over = true;
}

const wrapRound = (x) => { const r = Math.round(x); return r >= COLS ? r - COLS : r < 0 ? r + COLS : r; };

// Process every tile the player has entered since last step.
function traverse(w, p) {
  const cx = wrapRound(p.x), cy = Math.round(p.y);
  if (cx === p.tx && cy === p.ty) return;
  let dx = cx - p.tx;
  if (dx > COLS / 2) dx -= COLS; else if (dx < -COLS / 2) dx += COLS;
  const dy = cy - p.ty;
  if (Math.abs(dx) + Math.abs(dy) > 8) {
    enterTile(w, p, cx, cy);
  } else {
    // Walk an L-shaped path; prefer the corner that is floor.
    const xFirst = w.maze.isFloor((p.tx + dx + COLS) % COLS, p.ty);
    let x = p.tx, y = p.ty;
    const stepX = () => { while (dx) { const s = Math.sign(dx); x = (x + s + COLS) % COLS; dx -= s; enterTile(w, p, x, y); } };
    const stepY = () => { let ry = dy; while (ry) { const s = Math.sign(ry); y += s; ry -= s; enterTile(w, p, x, y); } };
    if (xFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
  }
  p.tx = cx; p.ty = cy;
  if (cy > p.maxY) p.maxY = cy;
}

function enterTile(w, p, x, y) {
  if (!w.maze.isFloor(x, y)) return;
  const k = key(x, y);
  if (p.fx.blaze) {
    const burn = POWERUPS.blaze.stat(p.fxLvl.blaze || 1).burn;
    w.fires.set(k, burn);
    w.events.push({ t: 'fire', k, d: burn });
  }
  if (w.taken.has(k)) {
    if (++p.empty >= 2 && p.chain > 0) {
      if (p.chain >= 10) w.events.push({ t: 'chainbreak', p: p.id, c: p.chain });
      p.chain = 0;
    }
    return;
  }
  p.empty = 0;
  collect(w, p, k, x, y);
}

function collect(w, p, k, x, y) {
  w.taken.add(k);
  const item = w.maze.items.get(k);
  w.events.push({ t: 'take', k, p: p.id, c: p.chain + 1 });
  if (!item) { eatDot(w, p); return; }
  switch (item) {
    case 'S': surge(w, p); break;
    case 'P': {
      const id = itemPower(p.loadout, k);
      const entry = p.loadout.find((l) => l.id === id);
      activatePower(w, p, id, entry ? entry.lvl : 1, x, y);
      break;
    }
    case 'C':
      p.coins++;
      award(w, p, 25, x, y);
      w.events.push({ t: 'coin', p: p.id });
      break;
    case 'G': {
      const v = 500 + Math.floor(p.maxY / 100) * 100;
      award(w, p, v, x, y, true);
      p.gems++;
      w.events.push({ t: 'gem', p: p.id });
      break;
    }
  }
}

function eatDot(w, p) {
  p.chain++;
  p.dots++;
  if (p.chain > p.bestChain) p.bestChain = p.chain;
  p.score += 10 * chainMult(p.chain);
  p.bite = 0.12;
  if (p.chain % NOVA_CHAIN === 0) nova(w, p);
}

function award(w, p, v, x, y, show = true) {
  p.score += v;
  if (show) w.events.push({ t: 'pts', x, y, v, p: p.id });
}

function surge(w, p) {
  const dur = Math.max(3.5, 6.5 - w.leaderY / 600);
  w.timers.surge = dur;
  p.surgeCombo = 0;
  for (const e of w.enemies) {
    if (e.dead || Math.abs(e.y - w.leaderY) > ACTIVE_RANGE) continue;
    e.vuln = dur;
    if (e.dir >= 0) e.dir = OPP[e.dir];
  }
  p.score += 50;
  w.events.push({ t: 'surge', p: p.id });
}

function nova(w, p) {
  let n = 0;
  for (const e of w.enemies) {
    if (!e.dead && Math.abs(e.y - p.y) < 24) { killEnemy(w, e, p, 200, 'nova'); n++; }
  }
  award(w, p, 3000, p.x, p.y);
  w.events.push({ t: 'nova', p: p.id, x: p.x, y: p.y, n });
}

export function activatePower(w, p, id, lvl, x = p.x, y = p.y) {
  const st = POWERUPS[id].stat(lvl);
  p.fxLvl[id] = lvl;
  switch (id) {
    case 'bomb': blast(w, p, p.x, p.y, st.radius, 'bomb'); break;
    case 'shockwave':
      blast(w, p, p.x, p.y, st.radius, 'shock');
      w.voidY -= st.push;
      break;
    case 'freeze': w.timers.freeze = Math.max(w.timers.freeze, st.dur); break;
    case 'chrono': w.timers.chrono = Math.max(w.timers.chrono, st.dur); break;
    default: p.fx[id] = Math.max(p.fx[id] || 0, st.dur);
  }
  w.events.push({ t: 'pow', p: p.id, id, x, y });
}

function blast(w, p, x, y, r, kind) {
  for (const e of w.enemies) {
    if (e.dead) continue;
    const dx = e.x - x, dy = e.y - y;
    if (dx * dx + dy * dy <= r * r) killEnemy(w, e, p, 150, kind);
  }
  w.events.push({ t: 'boom', x, y, r, kind });
}

function killEnemy(w, e, p, pts, cause) {
  if (e.dead) return;
  e.dead = true;
  if (p) { p.score += pts; p.kills++; }
  w.events.push({ t: 'kill', x: e.x, y: e.y, ty: e.type, v: pts, p: p ? p.id : null, cause });
}

function killPlayer(w, p, cause) {
  if (!p.alive) return;
  p.alive = false;
  p.cause = cause;
  p.fx = {};
  w.events.push({ t: 'die', p: p.id, x: p.x, y: p.y, cause });
}

export function laserBeam(maze, p, range) {
  const d = p.face;
  let x = wrapRound(p.x), y = Math.round(p.y), n = 0;
  while (n < range && maze.canMove(x, y, d)) {
    x = (x + DX[d] + COLS) % COLS; y += DY[d]; n++;
    if (DX[d] !== 0 && (x === 0 || x === COLS - 1)) break; // don't wrap beams
  }
  return { x0: p.x, y0: p.y, x1: x, y1: y, d };
}

export function dronePositions(p, time) {
  const n = POWERUPS.drone.stat(p.fxLvl.drone || 1).count;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = time * 5 + (i * Math.PI * 2) / n;
    out.push([p.x + Math.cos(a) * 1.6, p.y + Math.sin(a) * 1.6]);
  }
  return out;
}

function updatePlayerFx(w, p, dt) {
  for (const id in p.fx) {
    p.fx[id] -= dt;
    if (p.fx[id] <= 0) delete p.fx[id];
  }
  if (p.fx.laser) {
    const b = laserBeam(w.maze, p, POWERUPS.laser.stat(p.fxLvl.laser || 1).range);
    const horiz = DX[b.d] !== 0;
    const lo = horiz ? Math.min(b.x0, b.x1) : Math.min(b.y0, b.y1);
    const hi = horiz ? Math.max(b.x0, b.x1) : Math.max(b.y0, b.y1);
    for (const e of w.enemies) {
      if (e.dead) continue;
      const along = horiz ? e.x : e.y, perp = horiz ? e.y - b.y0 : e.x - b.x0;
      if (Math.abs(perp) < 0.55 && along >= lo - 0.5 && along <= hi + 0.5) killEnemy(w, e, p, 150, 'laser');
    }
  }
  if (p.fx.drone) {
    for (const [dx, dy] of dronePositions(p, w.time)) {
      for (const e of w.enemies) {
        if (e.dead) continue;
        const ax = e.x - dx, ay = e.y - dy;
        if (ax * ax + ay * ay < 0.8) killEnemy(w, e, p, 150, 'drone');
      }
    }
  }
  if (p.fx.magnet) {
    p.magnetT -= dt;
    if (p.magnetT <= 0) {
      p.magnetT = 0.09;
      const r = POWERUPS.magnet.stat(p.fxLvl.magnet || 1).radius;
      const px = wrapRound(p.x), py = Math.round(p.y);
      for (let y = py - r; y <= py + r; y++) {
        for (let x = px - r; x <= px + r; x++) {
          if (x < 0 || x >= COLS || !w.maze.isFloor(x, y)) continue;
          const k = key(x, y);
          if (w.taken.has(k) || w.maze.items.has(k)) continue;
          collect(w, p, k, x, y);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function spawnChunk(w, c) {
  const y0 = c * CHUNK_ROWS, y1 = y0 + CHUNK_ROWS - 2;
  w.maze.ensure(y1 + 1);
  const count = Math.min(2 + Math.floor(c * 0.4), 8);
  const types = ENEMY_LIST.filter((t) => ENEMIES[t].from <= c);
  for (let n = 0; n < count; n++) {
    for (let tries = 0; tries < 12; tries++) {
      const x = Math.floor(w.rng() * 10) * 2;
      const y = y0 + Math.floor(w.rng() * ((y1 - y0) / 2 + 1)) * 2;
      if (!w.maze.isFloor(x, y)) continue;
      if (w.players.some((p) => p.alive && Math.abs(p.x - x) + Math.abs(p.y - y) < 9)) continue;
      // Newest types are a bit rarer; hunters are the backbone.
      const r = w.rng();
      const type = r < 0.3 ? 'hunter' : types[Math.floor(w.rng() * types.length)];
      w.enemies.push({ id: w.nextId++, type, x, y, dir: -1, vuln: 0, dash: 0, dead: false });
      break;
    }
  }
}

function nearestTarget(w, e) {
  let best = null, bd = Infinity;
  for (const p of w.players) {
    if (!p.alive || p.fx.phase) continue;
    const dx = p.x - e.x, dy = p.y - e.y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { p: best, d2: bd } : null;
}

function lineOfSight(maze, e, p, max) {
  const ex = wrapRound(e.x), ey = Math.round(e.y);
  const px = wrapRound(p.x), py = Math.round(p.y);
  let d = -1;
  if (ey === py && ex !== px && Math.abs(px - ex) <= max) d = px > ex ? RIGHT : LEFT;
  else if (ex === px && ey !== py && Math.abs(py - ey) <= max) d = py > ey ? UP : DOWN;
  if (d < 0) return -1;
  let x = ex, y = ey;
  while (x !== px || y !== py) {
    if (!maze.canMove(x, y, d)) return -1;
    x += DX[d]; y += DY[d];
  }
  return d;
}

function updateEnemy(w, e, dt) {
  const tgt = nearestTarget(w, e);
  let minDy = Infinity;
  for (const p of w.players) if (p.alive) minDy = Math.min(minDy, Math.abs(p.y - e.y));
  if (minDy > ACTIVE_RANGE) return;

  const def = ENEMIES[e.type];
  let sp = def.speed * (1 + Math.min(0.3, w.leaderY / 3000));
  if (e.type === 'charger' && e.dash > 0) sp = def.dash;
  if (e.vuln > 0) sp *= 0.55;
  if (w.timers.chrono > 0) sp *= 0.45;

  const maze = w.maze;
  advance(e, sp * dt, (en, atCenter) => {
    if (!atCenter) return en.dir;
    const opts = [];
    for (let d = 0; d < 4; d++) {
      if (en.dir >= 0 && d === OPP[en.dir]) continue;
      if (maze.canMove(en.x, en.y, d)) opts.push(d);
    }
    if (!opts.length) {
      if (en.dir >= 0 && maze.canMove(en.x, en.y, OPP[en.dir])) return OPP[en.dir];
      return -1;
    }
    if (opts.length === 1) return opts[0];
    const rnd = () => opts[Math.floor(w.rng() * opts.length)];
    if (!tgt) return rnd();

    const toward = (tx, ty, flee = false) => {
      let best = opts[0], bv = flee ? -Infinity : Infinity;
      for (const d of opts) {
        const dx = en.x + DX[d] - tx, dy = en.y + DY[d] - ty, v = dx * dx + dy * dy;
        if (flee ? v > bv : v < bv) { bv = v; best = d; }
      }
      return best;
    };
    const p = tgt.p;
    if (en.vuln > 0) return toward(p.x, p.y, true);

    switch (en.type) {
      case 'hunter': return toward(p.x, p.y);
      case 'flanker': {
        const f = p.dir >= 0 ? p.dir : p.face;
        return tgt.d2 < 9 ? toward(p.x, p.y) : toward(p.x + DX[f] * 4, p.y + DY[f] * 4);
      }
      case 'drifter': return w.rng() < 0.35 ? toward(p.x, p.y) : rnd();
      case 'rusher':
        if (opts.includes(en.dir) && w.rng() > 0.1) return en.dir;
        return toward(p.x, p.y);
      case 'phantom': return tgt.d2 < 144 ? toward(p.x, p.y) : rnd();
      case 'charger': {
        const los = lineOfSight(maze, en, p, 9);
        if (los >= 0 && opts.includes(los)) { en.dash = 1.0; return los; }
        return w.rng() < 0.5 ? toward(p.x, p.y) : rnd();
      }
    }
    return rnd();
  });
}

function collide(w) {
  const frozen = w.timers.freeze > 0;
  for (const p of w.players) {
    if (!p.alive) continue;
    const r = p.remote ? 0.55 : 0.62;
    for (const e of w.enemies) {
      if (e.dead) continue;
      let dx = Math.abs(e.x - p.x);
      if (dx > COLS / 2) dx = COLS - dx;
      const dy = e.y - p.y;
      if (dx * dx + dy * dy > r * r) continue;
      if (e.vuln > 0 || frozen) {
        const v = Math.min(3200, 200 * 2 ** p.surgeCombo);
        p.surgeCombo++;
        killEnemy(w, e, p, v, 'eat');
      } else if (p.fx.phase) {
        continue;
      } else if (p.fx.shield) {
        killEnemy(w, e, p, 100, 'shield');
      } else {
        killPlayer(w, p, e.type);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Networking helpers
// ---------------------------------------------------------------------------

const r2 = (v) => Math.round(v * 100) / 100;

export function snapshot(w) {
  return {
    t: 's',
    time: r2(w.time),
    voidY: r2(w.voidY),
    timers: { surge: r2(w.timers.surge), freeze: r2(w.timers.freeze), chrono: r2(w.timers.chrono) },
    players: w.players.map((p) => ({
      id: p.id, x: r2(p.x), y: r2(p.y), dir: p.dir, face: p.face, alive: p.alive,
      score: p.score, chain: p.chain, coins: p.coins, maxY: p.maxY,
      fx: Object.fromEntries(Object.entries(p.fx).map(([k, v]) => [k, r2(v)])),
      fxLvl: p.fxLvl, bite: p.bite > 0 ? 1 : 0,
    })),
    enemies: w.enemies.filter((e) => !e.dead).map((e) =>
      [e.id, ENEMY_LIST.indexOf(e.type), r2(e.x), r2(e.y), e.dir, r2(e.vuln), e.dash > 0 ? 1 : 0]),
    ev: w.events,
  };
}

export function results(w) {
  return w.players
    .map((p) => ({
      id: p.id, name: p.name, color: p.color, score: p.score, distance: p.maxY,
      bestChain: p.bestChain, kills: p.kills, coins: p.coins, alive: p.alive,
    }))
    .sort((a, b) => b.score - a.score);
}
