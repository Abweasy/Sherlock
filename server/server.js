// BYTE RUSH server: serves the game, hosts online rooms over WebSockets and
// keeps a simple leaderboard.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createWorld, addPlayer, step, snapshot, results } from '../shared/sim.js';
import {
  COLS, TICK, PLAYER_SPEED, PLAYER_COLORS, MAX_ROOM_PLAYERS, POWERUPS, MAX_LEVEL,
} from '../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const SCORES_FILE = path.join(DATA, 'scores.json');
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------
let scores = { solo: [], online: [] };
try { scores = { ...scores, ...JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')) }; } catch { /* first run */ }
let saveTimer = null;
function saveScores() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdir(DATA, { recursive: true }, () => {
      fs.writeFile(SCORES_FILE, JSON.stringify(scores), () => {});
    });
  }, 500);
}
const cleanName = (n) => String(n || 'Player').replace(/[^\p{L}\p{N} _\-.!?]/gu, '').trim().slice(0, 14) || 'Player';

function addScore(board, entry) {
  const list = scores[board];
  if (!list) return -1;
  const e = {
    name: cleanName(entry.name),
    score: Math.max(0, Math.floor(Number(entry.score) || 0)),
    distance: Math.max(0, Math.floor(Number(entry.distance) || 0)),
    chain: Math.max(0, Math.floor(Number(entry.chain) || 0)),
    at: Date.now(),
  };
  if (!e.score) return -1;
  list.push(e);
  list.sort((a, b) => b.score - a.score);
  list.length = Math.min(list.length, 100);
  saveScores();
  return list.indexOf(e);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let base = PUBLIC;
  if (urlPath.startsWith('/shared/')) { base = SHARED; urlPath = urlPath.slice('/shared'.length); }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const file = path.normalize(path.join(base, urlPath));
  if (!file.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/scores' && req.method === 'GET') {
    const board = url.searchParams.get('board') === 'online' ? 'online' : 'solo';
    return sendJSON(res, 200, { board, scores: scores[board].slice(0, 50) });
  }
  if (url.pathname === '/api/scores' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2000) req.destroy(); });
    req.on('end', () => {
      try {
        const rank = addScore('solo', JSON.parse(body));
        sendJSON(res, 200, { ok: true, rank });
      } catch { sendJSON(res, 400, { ok: false }); }
    });
    return;
  }
  if (url.pathname === '/api/health') return sendJSON(res, 200, { ok: true, rooms: rooms.size });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  serveStatic(req, res);
});

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------
const rooms = new Map();
let nextClientId = 1;

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

function sanitizeLoadout(lo) {
  if (!Array.isArray(lo)) return [];
  const out = [];
  for (const l of lo.slice(0, 3)) {
    if (!l || !POWERUPS[l.id] || out.some((o) => o.id === l.id)) continue;
    out.push({ id: l.id, lvl: Math.max(1, Math.min(MAX_LEVEL, Math.floor(l.lvl) || 1)) });
  }
  return out;
}

class Room {
  constructor(isPublic) {
    this.code = makeCode();
    this.isPublic = isPublic;
    this.members = []; // ws list
    this.hostId = null;
    this.state = 'lobby';
    this.world = null;
    this.loop = null;
    rooms.set(this.code, this);
  }

  info() {
    return {
      t: 'room', code: this.code, host: this.hostId, state: this.state, isPublic: this.isPublic,
      players: this.members.map((ws, i) => ({ id: ws.meta.id, name: ws.meta.name, color: PLAYER_COLORS[i] })),
    };
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const ws of this.members) if (ws.readyState === 1) ws.send(s);
  }

  join(ws) {
    if (this.members.length >= MAX_ROOM_PLAYERS) return send(ws, { t: 'error', msg: 'Room is full.' });
    if (this.state !== 'lobby') return send(ws, { t: 'error', msg: 'Game already in progress.' });
    if (ws.meta.room) ws.meta.room.leave(ws);
    this.members.push(ws);
    ws.meta.room = this;
    if (!this.hostId) this.hostId = ws.meta.id;
    this.broadcast(this.info());
  }

  leave(ws) {
    this.members = this.members.filter((m) => m !== ws);
    ws.meta.room = null;
    if (this.world) {
      const p = this.world.players.find((pl) => pl.id === ws.meta.id);
      if (p && p.alive) { p.alive = false; p.cause = 'left'; this.world.events.push({ t: 'die', p: p.id, x: p.x, y: p.y, cause: 'left' }); }
    }
    if (!this.members.length) return this.destroy();
    if (this.hostId === ws.meta.id) this.hostId = this.members[0].meta.id;
    this.broadcast(this.info());
  }

  destroy() {
    clearInterval(this.loop);
    rooms.delete(this.code);
  }

  start(ws) {
    if (ws.meta.id !== this.hostId || this.state !== 'lobby') return;
    const seed = (Math.random() * 2 ** 31) >>> 0;
    const w = createWorld(seed, { online: true });
    this.members.forEach((m, i) => {
      const p = addPlayer(w, {
        id: m.meta.id, name: m.meta.name, color: PLAYER_COLORS[i], loadout: m.meta.loadout, remote: true,
      });
      p.lastPosAt = Date.now();
    });
    this.world = w;
    this.state = 'playing';
    const countdown = 3;
    this.broadcast({
      t: 'start', seed, countdown,
      players: w.players.map((p) => ({ id: p.id, name: p.name, color: p.color, loadout: p.loadout, x: p.x, y: p.y })),
    });
    this.broadcast(this.info());
    const startAt = Date.now() + countdown * 1000;
    let last = Date.now();
    let acc = 0;
    let endAt = 0;
    this.loop = setInterval(() => {
      const now = Date.now();
      if (now < startAt) { last = now; this.broadcast(snapshot(w)); w.events.length = 0; return; }
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= TICK) { step(w, TICK); acc -= TICK; }
      this.broadcast(snapshot(w));
      w.events.length = 0;
      if (w.over && !endAt) endAt = now + 1500;
      if (endAt && now >= endAt) this.finish();
    }, 1000 / 30);
  }

  finish() {
    clearInterval(this.loop);
    const res = results(this.world);
    for (const r of res) addScore('online', { name: r.name, score: r.score, distance: r.distance, chain: r.bestChain });
    this.broadcast({ t: 'end', results: res });
    this.world = null;
    this.state = 'lobby';
    this.broadcast(this.info());
  }

  // Client-authoritative movement with sanity checks.
  pos(ws, msg) {
    const w = this.world;
    if (!w || this.state !== 'playing') return;
    const p = w.players.find((pl) => pl.id === ws.meta.id);
    if (!p || !p.alive) return;
    const x = Number(msg.x), y = Number(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const now = Date.now();
    const elapsed = Math.max(0.05, (now - p.lastPosAt) / 1000);
    let dx = Math.abs(x - p.x);
    if (dx > COLS / 2) dx = COLS - dx;
    const dist = dx + Math.abs(y - p.y);
    const tx = ((Math.round(x) % COLS) + COLS) % COLS, ty = Math.round(y);
    if (dist > PLAYER_SPEED * elapsed * 1.6 + 1.2 || !w.maze.isFloor(tx, ty)) return;
    p.x = x; p.y = y;
    if (msg.d >= 0 && msg.d < 4) { p.dir = msg.d; p.face = msg.d; }
    p.lastPosAt = now;
  }
}

// ---------------------------------------------------------------------------
// WebSockets
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

wss.on('connection', (ws) => {
  ws.meta = { id: nextClientId++, name: 'Player', loadout: [], room: null };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  send(ws, { t: 'hello', id: ws.meta.id });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const room = ws.meta.room;
    switch (msg.t) {
      case 'profile':
        ws.meta.name = cleanName(msg.name);
        ws.meta.loadout = sanitizeLoadout(msg.loadout);
        if (room && room.state === 'lobby') room.broadcast(room.info());
        break;
      case 'create': new Room(false).join(ws); break;
      case 'join': {
        const r = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!r) send(ws, { t: 'error', msg: 'Room not found.' });
        else r.join(ws);
        break;
      }
      case 'quick': {
        let r = [...rooms.values()].find((x) => x.isPublic && x.state === 'lobby' && x.members.length < MAX_ROOM_PLAYERS);
        if (!r) r = new Room(true);
        r.join(ws);
        break;
      }
      case 'leave': if (room) room.leave(ws); break;
      case 'start': if (room) room.start(ws); break;
      case 'pos': if (room) room.pos(ws, msg); break;
      case 'ping': send(ws, { t: 'pong', c: msg.c }); break;
    }
  });

  ws.on('close', () => { if (ws.meta.room) ws.meta.room.leave(ws); });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`BYTE RUSH server running on http://localhost:${PORT}`);
});
