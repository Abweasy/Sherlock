import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Maze } from '../shared/maze.js';
import { COLS, DX, DY } from '../shared/constants.js';
import { createWorld, addPlayer, step, snapshot } from '../shared/sim.js';

const ROWS = 400;

function neighbours(m, x, y) {
  const out = [];
  for (let d = 0; d < 4; d++) {
    if (!m.canMove(x, y, d)) continue;
    out.push([(x + DX[d] + COLS) % COLS, y + DY[d]]);
  }
  return out;
}

test('maze is deterministic for a seed', () => {
  const a = new Maze(1234), b = new Maze(1234);
  a.ensure(ROWS); b.ensure(ROWS);
  for (let y = 0; y < ROWS; y++) assert.deepEqual(a.tiles[y], b.tiles[y]);
  assert.deepEqual([...a.items], [...b.items]);
});

test('maze has no dead ends and is fully connected', () => {
  for (const seed of [1, 2, 3, 99, 4242, 777777]) {
    const m = new Maze(seed);
    m.ensure(ROWS + 2);
    let floors = 0;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!m.isFloor(x, y)) continue;
        floors++;
        if (y > 0) assert.ok(neighbours(m, x, y).length >= 2, `dead end at ${x},${y} seed ${seed}`);
      }
    }
    // BFS from start
    const seen = new Set(['9,0']);
    const q = [[9, 0]];
    while (q.length) {
      const [x, y] = q.pop();
      for (const [nx, ny] of neighbours(m, x, y)) {
        if (ny >= ROWS) continue;
        const k = nx + ',' + ny;
        if (!seen.has(k)) { seen.add(k); q.push([nx, ny]); }
      }
    }
    assert.equal(seen.size, floors, `unreachable tiles for seed ${seed}`);
  }
});

test('simulation runs and the void eventually ends an idle game', () => {
  const w = createWorld(42);
  addPlayer(w, { id: 1, loadout: [{ id: 'bomb', lvl: 1 }] });
  let t = 0;
  while (!w.over && t < 120) { step(w, 1 / 60); t += 1 / 60; }
  assert.ok(w.over, 'idle player should be caught');
  assert.ok(w.players[0].cause, 'death has a cause');
  const s = snapshot(w);
  assert.equal(s.players.length, 1);
});

test('a scripted runner collects dots and climbs', () => {
  const w = createWorld(7);
  const p = addPlayer(w, { id: 1, loadout: [{ id: 'shield', lvl: 5 }] });
  p.fx.shield = 9999; // keep it alive for the test
  for (let i = 0; i < 60 * 30 && p.alive; i++) {
    // Steer by BFS toward a tile ~6 rows higher.
    const tx = (Math.round(p.x) + COLS) % COLS, ty = Math.round(p.y);
    const prev = new Map([[tx + ',' + ty, -1]]);
    const q = [[tx, ty, -1]];
    let firstDir = -1;
    while (q.length) {
      const [x, y, fd] = q.shift();
      if (y >= ty + 6) { firstDir = fd; break; }
      for (let d = 0; d < 4; d++) {
        if (!w.maze.canMove(x, y, d)) continue;
        const nx = (x + DX[d] + COLS) % COLS, ny = y + DY[d], k = nx + ',' + ny;
        if (prev.has(k) || ny < ty - 4) continue;
        prev.set(k, d);
        q.push([nx, ny, fd < 0 ? d : fd]);
      }
    }
    if (firstDir >= 0) p.want = firstDir;
    step(w, 1 / 60);
  }
  assert.ok(p.dots > 20, `ate ${p.dots} dots`);
  assert.ok(p.maxY > 30, `climbed ${p.maxY}`);
});
