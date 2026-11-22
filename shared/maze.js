// Endless, procedurally generated maze.
//
// The maze is a lattice graph of nodes (one every other tile). Tiles at
// (even, even) are always floor (nodes); tiles between two nodes are floor
// when that edge is open; (odd, odd) tiles are always wall. We generate it in
// chunks of rows, removing edges at random (mirrored left/right) while
// guaranteeing: no dead ends (every node keeps degree >= 2) and full
// connectivity. Generation is seeded per chunk, so client and server build the
// exact same maze from the same seed.

import { NODE_COLS as N, COLS, CHUNK_NODE_ROWS as CNR, CHUNK_ROWS, DX, DY } from './constants.js';
import { mulberry32, hash2, shuffle } from './rng.js';

export const key = (x, y) => y * 32 + x;
export const keyX = (k) => k & 31;
export const keyY = (k) => k >> 5;

const REMOVE_P = 0.62;
const WRAP_P = 0.2;

export class Maze {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.H = [];        // H[j][i]: edge (i,j)-(i+1,j)
    this.V = [];        // V[j][i]: edge (i,j)-(i,j+1)
    this.Wr = [];       // Wr[j]: wrap-around edge between (N-1,j) and (0,j)
    this.tiles = [];    // tiles[y]: Uint8Array(COLS) 1 = floor
    this.wrapRow = [];  // wrapRow[y]: horizontal wrap allowed on this tile row
    this.items = new Map(); // tile key -> 'S' surge | 'P' power | 'C' coin | 'G' gem
    this.chunks = 0;
    this.finalRows = 0; // tile rows [0, finalRows) are final
  }

  ensure(y) {
    while (this.finalRows <= y) this._genChunk();
  }

  isFloor(x, y) {
    if (y < 0 || x < 0 || x >= COLS) return false;
    if (y >= this.finalRows) this.ensure(y);
    return this.tiles[y][x] === 1;
  }

  // Can an entity standing on tile (x,y) step in direction d?
  canMove(x, y, d) {
    let nx = x + DX[d];
    const ny = y + DY[d];
    if (nx < 0 || nx >= COLS) {
      if (DY[d] !== 0 || !this.isWrap(y)) return false;
      nx = (nx + COLS) % COLS;
    }
    return this.isFloor(nx, ny);
  }

  isWrap(y) {
    if (y < 0) return false;
    if (y >= this.finalRows) this.ensure(y);
    return this.wrapRow[y] === true;
  }

  _deg(i, j) {
    let d = 0;
    const H = this.H[j];
    if (i > 0 && H[i - 1]) d++;
    if (i < N - 1 && H[i]) d++;
    if (this.V[j][i]) d++;
    if (j > 0 && this.V[j - 1][i]) d++;
    if ((i === 0 || i === N - 1) && this.Wr[j]) d++;
    return d;
  }

  // Every node in rows [j0, j1) must reach the (already connected) row j0-1.
  _connected(j0, j1) {
    const R = j1 - j0;
    const seen = new Uint8Array(R * N);
    const stack = [];
    const push = (i, r) => {
      const id = r * N + i;
      if (!seen[id]) { seen[id] = 1; stack.push(id); }
    };
    if (j0 > 0) {
      for (let i = 0; i < N; i++) if (this.V[j0 - 1][i]) push(i, 0);
    } else {
      push(0, 0);
    }
    let count = 0;
    while (stack.length) {
      const id = stack.pop();
      count++;
      const i = id % N, r = (id / N) | 0, j = j0 + r;
      const H = this.H[j];
      if (i > 0 && H[i - 1]) push(i - 1, r);
      if (i < N - 1 && H[i]) push(i + 1, r);
      if (this.Wr[j] && (i === 0 || i === N - 1)) push(i === 0 ? N - 1 : 0, r);
      if (r < R - 1 && this.V[j][i]) push(i, r + 1);
      if (r > 0 && this.V[j - 1][i]) push(i, r - 1);
    }
    return count === R * N;
  }

  _genChunk() {
    const c = this.chunks++;
    const rng = mulberry32(hash2(this.seed, c));
    const j0 = c * CNR, j1 = j0 + CNR;

    for (let j = j0; j < j1; j++) {
      this.H[j] = new Uint8Array(N - 1).fill(1);
      this.V[j] = new Uint8Array(N).fill(1);
      this.Wr[j] = (j > 2 && rng() < WRAP_P) ? 1 : 0;
    }

    // Candidate edge removals, as mirrored pairs.
    const cands = [];
    for (let j = j0; j < j1; j++) {
      if (j === 0) continue; // keep the starting corridor fully open
      for (let i = 0; i <= (N - 2) >> 1; i++) cands.push(0, j, i);
    }
    for (let j = Math.max(0, j0 - 1); j <= j1 - 2; j++) {
      for (let i = 0; i < N >> 1; i++) cands.push(1, j, i);
    }
    const order = [];
    for (let n = 0; n < cands.length; n += 3) order.push(n);
    shuffle(order, rng);

    for (const n of order) {
      if (rng() > REMOVE_P) continue;
      const t = cands[n], j = cands[n + 1], i = cands[n + 2];
      if (t === 0) {
        const m = N - 2 - i;
        this.H[j][i] = 0; this.H[j][m] = 0;
        const ok = this._deg(i, j) >= 2 && this._deg(i + 1, j) >= 2 &&
          this._deg(m, j) >= 2 && this._deg(m + 1, j) >= 2 && this._connected(j0, j1);
        if (!ok) { this.H[j][i] = 1; this.H[j][m] = 1; }
      } else {
        const m = N - 1 - i;
        this.V[j][i] = 0; this.V[j][m] = 0;
        const ok = this._deg(i, j) >= 2 && this._deg(i, j + 1) >= 2 &&
          this._deg(m, j) >= 2 && this._deg(m, j + 1) >= 2 && this._connected(j0, j1);
        if (!ok) { this.V[j][i] = 1; this.V[j][m] = 1; }
      }
    }

    // Materialise tile rows that are now final.
    const yStart = c === 0 ? 0 : c * CHUNK_ROWS - 1;
    const yEnd = c * CHUNK_ROWS + CHUNK_ROWS - 2;
    for (let y = yStart; y <= yEnd; y++) this._buildRow(y);
    this.finalRows = yEnd + 1;

    this._placeItems(c, rng);
  }

  _buildRow(y) {
    const row = new Uint8Array(COLS);
    const j = y >> 1;
    if ((y & 1) === 0) {
      for (let x = 0; x < COLS; x++) row[x] = (x & 1) === 0 ? 1 : this.H[j][(x - 1) >> 1];
      this.wrapRow[y] = this.Wr[j] === 1;
    } else {
      for (let x = 0; x < COLS; x += 2) row[x] = this.V[j][x >> 1];
      this.wrapRow[y] = false;
    }
    this.tiles[y] = row;
  }

  _placeItems(c, rng) {
    const y0 = c * CHUNK_ROWS, y1 = y0 + CHUNK_ROWS - 2;
    const floors = [];
    for (let y = Math.max(y0, 4); y <= y1; y++) {
      const row = this.tiles[y];
      for (let x = 0; x < COLS; x++) if (row[x]) floors.push(key(x, y));
    }
    shuffle(floors, rng);
    let n = 0;
    const place = (type, count) => {
      for (let k = 0; k < count && n < floors.length; k++) this.items.set(floors[n++], type);
    };
    if (c === 0) {
      place('P', 1);
      place('C', 2);
      return;
    }
    place('S', 1);
    place('P', rng() < 0.5 ? 2 : 3);
    place('C', 2 + (rng() < 0.5 ? 1 : 0));
    if (rng() < 0.35) place('G', 1);
  }
}
