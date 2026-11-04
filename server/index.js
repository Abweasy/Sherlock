import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file: fine for local browser play.
}

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');

const app = express();
app.use(express.json());

// Inside Discord, requests arrive via the activity proxy. Accept both
// "/api/token" and "/.proxy/api/token" so either style works.
app.use((req, _res, next) => {
  if (req.url.startsWith('/.proxy/')) req.url = req.url.slice('/.proxy'.length);
  next();
});

// Exchange the OAuth code from the Discord client for an access token.
app.post('/api/token', async (req, res) => {
  const clientId = process.env.VITE_DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Set VITE_DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in .env' });
  }
  try {
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: String(req.body?.code || ''),
      }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(400).json({ error: data.error_description || 'token exchange failed' });
    res.json({ access_token: data.access_token });
  } catch (err) {
    console.error('token exchange failed', err);
    res.status(502).json({ error: 'could not reach Discord' });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: games.size }));

app.use(express.static(DIST));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

const server = http.createServer(app);

// ---------- multiplayer ----------

const games = new Map(); // roomId -> { game, sockets: Map<clientId, ws>, emptySince }

function getRoom(roomId) {
  let room = games.get(roomId);
  if (room) return room;
  const sockets = new Map();
  const send = (ws, msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  const game = new Game(roomId, {
    broadcast: (msg) => {
      const data = JSON.stringify(msg);
      for (const ws of sockets.values()) if (ws.readyState === ws.OPEN) ws.send(data);
    },
    sendTo: (clientId, msg) => {
      const ws = sockets.get(clientId);
      if (ws) send(ws, msg);
    },
  });
  room = { game, sockets, emptySince: null };
  games.set(roomId, room);
  return room;
}

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname !== '/ws' && pathname !== '/.proxy/ws') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

const clean = (s, max) => String(s || '').replace(/[^\w\- .']/g, '').slice(0, max);

wss.on('connection', (ws) => {
  let room = null;
  let clientId = null;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'join' && !room) {
      const roomId = clean(msg.room, 64) || 'lobby';
      clientId = clean(msg.clientId, 64) || Math.random().toString(36).slice(2);
      room = getRoom(roomId);
      room.emptySince = null;
      const previous = room.sockets.get(clientId);
      if (previous && previous !== ws) previous.close(4000, 'replaced');
      room.sockets.set(clientId, ws);
      ws.send(JSON.stringify({ t: 'welcome', clientId }));
      room.game.join(clientId, String(msg.name || '').slice(0, 24));
      return;
    }
    if (!room) return;

    switch (msg.t) {
      case 'pick':
        room.game.pickRole(clientId, msg.role);
        break;
      case 'act':
        room.game.act(clientId, msg);
        break;
      case 'look': {
        // Lightweight presence: where you're looking and what you're hovering.
        const player = room.game.players.get(clientId);
        if (!player) break;
        const data = JSON.stringify({
          t: 'look',
          id: clientId,
          role: player.role,
          yaw: Number(msg.yaw) || 0,
          pitch: Number(msg.pitch) || 0,
          hover: String(msg.hover || '').slice(0, 40),
        });
        for (const [id, other] of room.sockets) if (id !== clientId && other.readyState === other.OPEN) other.send(data);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!room || room.sockets.get(clientId) !== ws) return;
    room.sockets.delete(clientId);
    room.game.leave(clientId);
    if (room.sockets.size === 0) room.emptySince = Date.now();
  });
});

// Drop dead connections and forget rooms that have been empty for a while.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  for (const [id, room] of games) {
    if (room.emptySince && Date.now() - room.emptySince > 15 * 60 * 1000) games.delete(id);
  }
}, 30_000).unref();

server.listen(PORT, () => {
  console.log(`The Clockmaker's Vault is running on http://localhost:${PORT}`);
});
