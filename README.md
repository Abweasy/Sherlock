# BYTE RUSH

An endless neon maze runner for mobile and desktop, with online multiplayer.
Swipe through a never-ending maze, chain dots for multipliers, use power-ups,
and stay ahead of the **Void** rising from below.

## Features

- **Endless procedural maze.** It's generated in chunks, mirrored left and right, and every maze is guaranteed to have no dead ends and no unreachable areas. Some rows let you wrap around the sides.
- **The Void** rises from below and speeds up the further you go.
- **Dot chains.** Each 30 dots in a row raises your multiplier (up to x10). Every 300-dot chain sets off a **NOVA** that clears the screen.
- **Surge Cores** make enemies vulnerable. Eat them for 200 / 400 / 800 / 1600 points.
- **6 enemy types:** Hunter, Drifter, Flanker, Rusher, Phantom (invisible until close) and Charger (dashes when it sees you). New types unlock as you go further.
- **10 power-ups:** Bomb, Freeze, Shield, Laser, Magnet, Blaze, Phase, Drone, Chrono and Shockwave. You equip 3, and only those spawn in the maze.
- **Progression.** Earn coins to unlock power-ups and upgrade each one to level 5.
- **Online play.** Up to 4 players share one maze in real time. Join with Quick Match, a private 4-letter room code, or an invite link.
- **Leaderboards** for solo and online.
- **Mobile-first.** Swipe controls (several turns in one swipe work), an optional on-screen D-pad, vibration, and installation as an app (PWA). Solo play works offline.
- **Synthesized sound and music.** No audio files.

## Run locally

```bash
npm install
npm start          # http://localhost:8080
npm test           # maze + simulation tests
```

To play on your phone over Wi-Fi, run the server on your computer and open `http://<your-computer-ip>:8080` on the phone.
For "Add to Home Screen" / offline mode, the game must be served over HTTPS. Any of the hosts below handles that.

## Deploy (to play from anywhere)

The game is a single Node process (HTTP + WebSocket), so any Node host with WebSocket support works:

- **Render / Railway:** create a Web Service from this repo. Build: `npm install`, start: `npm start`. The `PORT` env var is respected.
- **Fly.io / any Docker host:** a `Dockerfile` is included.

The leaderboard is stored in `data/scores.json`. Set `DATA_DIR` to a persistent volume if your host has ephemeral disks.

## Project layout

```
shared/     game logic used by BOTH the browser and the server
  constants.js   tuning: speeds, power-ups, enemies, costs
  maze.js        seeded endless maze generator
  sim.js         the simulation (movement, AI, power-ups, scoring)
server/server.js static files, /api/scores, WebSocket rooms (server-authoritative sim)
public/      client: index.html, style.css, js/ (render, input, audio, net, store, main)
test/        node:test suite
```

### How online play works
The server runs the same `shared/sim.js` for each room at 60 Hz and broadcasts snapshots at 30 Hz.
Every client builds the same maze from a shared seed, so only entities and events cross the network.
Your own movement is predicted locally, so controls respond instantly. Other players and enemies are shown about 110 ms behind and smoothly interpolated.
