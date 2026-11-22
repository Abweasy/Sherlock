import {
  TICK, COLS, POWERUPS, POWERUP_LIST, ENEMIES, ENEMY_LIST, MAX_LEVEL, PLAYER_COLORS, chainMult,
} from '/shared/constants.js';
import { Maze, key } from '/shared/maze.js';
import { createWorld, addPlayer, step, movePlayer } from '/shared/sim.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { Store } from './store.js';
import { Net } from './net.js';

const $ = (id) => document.getElementById(id);
const store = new Store();
const sound = new Sound();
const renderer = new Renderer($('game'));
const input = new Input($('game'), $('dpad'));
const net = new Net();

let game = null;
let room = null; // latest room info when online

// ---------------------------------------------------------------------------
// Screens & small UI helpers
// ---------------------------------------------------------------------------
const screens = ['menu', 'powerups', 'online', 'room', 'over', 'pause', 'scores', 'settings', 'howto'];
let current = 'menu';
let backTo = 'menu';
function show(name) {
  for (const s of screens) $('screen-' + s).classList.toggle('hidden', s !== name);
  current = name;
  if (name === 'menu') refreshMenu();
  if (name === 'powerups') buildPowerups();
}
function hideScreens() {
  for (const s of screens) $('screen-' + s).classList.add('hidden');
  current = null;
}
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
let bannerTimer;
function banner(text, color = '#fff') {
  const b = $('banner');
  b.textContent = text;
  b.style.color = color;
  b.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('show'), 1100);
}
const vibrate = (ms) => { if (store.data.settings.haptics && navigator.vibrate) navigator.vibrate(ms); };
const click = () => { sound.unlock(); sound.play('click'); };

function refreshMenu() {
  $('menu-best').textContent = store.data.best.toLocaleString();
  $('menu-coins').textContent = store.data.coins;
}

function applySettings() {
  const s = store.data.settings;
  sound.sfxOn = s.sound;
  sound.musicOn = s.music;
  if (!s.music) sound.stopMusic();
  $('dpad').classList.toggle('hidden', !(s.dpad && game));
}

// ---------------------------------------------------------------------------
// Event feedback (sound, particles, banners) shared by solo and online
// ---------------------------------------------------------------------------
function feedback(ev, g) {
  const me = ev.p === g.meId;
  const pColor = (id) => (g.colorOf ? g.colorOf(id) : '#fff');
  switch (ev.t) {
    case 'take':
      if (me && !g.view().maze.items.has(ev.k) && !(g.predicted && g.predicted.delete(ev.k))) sound.play('dot', ev.c);
      break;
    case 'coin': if (me) sound.play('coin'); break;
    case 'gem': if (me) { sound.play('gem'); banner('GEM!', '#9df'); } break;
    case 'pts': renderer.popup(ev.x, ev.y, ev.v, me ? '#ffd84d' : pColor(ev.p)); break;
    case 'pow': {
      const def = POWERUPS[ev.id];
      if (me) { sound.play('power'); banner(def.name.toUpperCase() + '!', def.color); vibrate(30); }
      else renderer.popup(ev.x, ev.y, def.name, def.color);
      renderer.ring(ev.x, ev.y, 2, def.color);
      break;
    }
    case 'surge':
      sound.play('surge');
      renderer.doFlash('#ff4dd8', 0.25);
      if (me) banner('SURGE!', '#ff4dd8');
      break;
    case 'kill': {
      const col = ENEMIES[ev.ty] ? ENEMIES[ev.ty].color : '#fff';
      renderer.burst(ev.x, ev.y, col, 16, 7);
      if (ev.v) renderer.popup(ev.x, ev.y, ev.v, me ? '#fff' : pColor(ev.p));
      if (ev.cause === 'eat') sound.play('eat', Math.min(5, (g.hudPlayer()?.surgeCombo || 1)));
      else sound.play('kill');
      break;
    }
    case 'boom':
      renderer.ring(ev.x, ev.y, ev.r, ev.kind === 'shock' ? '#ff3df2' : '#ff8a3d');
      renderer.burst(ev.x, ev.y, ev.kind === 'shock' ? '#ff3df2' : '#ff8a3d', 30, 10);
      renderer.doShake(0.6);
      sound.play('boom');
      vibrate(60);
      break;
    case 'nova':
      renderer.doFlash('#ffffff', 0.8);
      renderer.doShake(1);
      sound.play('nova');
      if (me) banner('NOVA!!', '#fff');
      vibrate([40, 30, 80]);
      break;
    case 'chainbreak':
      if (me) { sound.play('break'); renderer.popup(g.hudPlayer().x, g.hudPlayer().y + 1, 'CHAIN BROKEN', '#ff6b6b'); }
      break;
    case 'die':
      renderer.burst(ev.x, ev.y, pColor(ev.p), 40, 9);
      if (me) { sound.play('die'); renderer.doShake(1); vibrate(200); }
      break;
  }
}

// ---------------------------------------------------------------------------
// Solo game
// ---------------------------------------------------------------------------
class SoloGame {
  constructor() {
    this.online = false;
    this.meId = 1;
    this.world = createWorld((Math.random() * 2 ** 31) >>> 0);
    this.me = addPlayer(this.world, {
      id: 1, name: store.data.name, color: PLAYER_COLORS[0], loadout: store.loadoutForGame(),
    });
    this.acc = 0;
    this.paused = false;
    this.overAt = 0;
    this.done = false;
    renderer.snapCamera(0);
  }
  colorOf() { return PLAYER_COLORS[0]; }
  input(d) { this.me.want = d; }
  view() { return this.world; }
  hudPlayer() { return this.me; }
  update(dt) {
    if (this.paused || this.done) return;
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= TICK) {
      step(this.world, TICK);
      this.acc -= TICK;
      for (const ev of this.world.events) feedback(ev, this);
      this.world.events.length = 0;
    }
    sound.tempo = 1 + Math.min(0.6, this.world.leaderY / 1500);
    if (this.world.over && !this.overAt) this.overAt = performance.now() + 1300;
    if (this.overAt && performance.now() >= this.overAt) this.finish();
  }
  finish() {
    this.done = true;
    const p = this.me;
    const res = store.recordGame({ score: p.score, distance: p.maxY, chain: p.bestChain, coins: p.coins, dots: p.dots, kills: p.kills });
    fetch('/api/scores', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: store.data.name, score: p.score, distance: p.maxY, chain: p.bestChain }),
    }).catch(() => {});
    showGameOver({
      score: p.score, distance: p.maxY, chain: p.bestChain, kills: p.kills, coins: res.coinsEarned,
      newBest: res.newBest, cause: p.cause,
    });
  }
}

// ---------------------------------------------------------------------------
// Online game: own movement is predicted locally; everything else comes from
// server snapshots and is interpolated ~100ms behind for smoothness.
// ---------------------------------------------------------------------------
const INTERP_MS = 110;
const lerp = (a, b, f) => a + (b - a) * f;
const lerpX = (a, b, f) => {
  let d = b - a;
  if (d > COLS / 2) d -= COLS; else if (d < -COLS / 2) d += COLS;
  let x = a + d * f;
  if (x > COLS - 0.5) x -= COLS; else if (x < -0.5) x += COLS;
  return x;
};

class OnlineGame {
  constructor(msg) {
    this.online = true;
    this.meId = net.id;
    const maze = new Maze(msg.seed);
    maze.ensure(64);
    this.mirror = {
      maze, taken: new Set(), fires: new Map(), players: [], enemies: [],
      voidY: -14, timers: { surge: 0, freeze: 0, chrono: 0 }, time: 0,
    };
    this.info = new Map(msg.players.map((p) => [p.id, p]));
    const mine = msg.players.find((p) => p.id === this.meId) || msg.players[0];
    this.me = {
      id: this.meId, name: mine.name, color: mine.color, loadout: mine.loadout,
      x: mine.x, y: mine.y, tx: mine.x, ty: mine.y, dir: -1, want: -1, face: 0,
      alive: true, fx: {}, fxLvl: {}, bite: 0, score: 0, chain: 0, coins: 0, maxY: 0, surgeCombo: 0,
    };
    this.predicted = new Set();
    this.buf = [];
    this.startAt = performance.now() + msg.countdown * 1000;
    this.lastCount = -1;
    this.acc = 0;
    this.sendT = 0;
    this.latestAt = 0;
    this.latestTime = 0;
    this.done = false;
    renderer.snapCamera(0);
  }
  colorOf(id) { const p = this.info.get(id); return p ? p.color : '#fff'; }
  input(d) { this.me.want = d; }
  view() { return this.mirror; }
  hudPlayer() { return this.me; }

  onSnapshot(s) {
    const now = performance.now();
    this.buf.push({ at: now, s });
    if (this.buf.length > 40) this.buf.shift();
    for (const ev of s.ev) {
      if (ev.t === 'take') this.mirror.taken.add(ev.k);
      else if (ev.t === 'fire') this.mirror.fires.set(ev.k, ev.d);
      feedback(ev, this);
    }
    this.mirror.timers = s.timers;
    this.latestAt = now;
    this.latestTime = s.time;
    const sp = s.players.find((p) => p.id === this.meId);
    if (sp) {
      Object.assign(this.me, { score: sp.score, chain: sp.chain, coins: sp.coins, maxY: sp.maxY, fx: sp.fx, fxLvl: sp.fxLvl });
      if (!sp.alive && this.me.alive) this.me.alive = false;
    }
  }

  update(dt) {
    const now = performance.now();
    const m = this.mirror;
    // Countdown
    const left = Math.ceil((this.startAt - now) / 1000);
    if (left > 0) {
      $('countdown').classList.remove('hidden');
      $('countdown').textContent = left;
      if (left !== this.lastCount) { this.lastCount = left; sound.play('count', 0); }
    } else if (this.lastCount !== 0) {
      this.lastCount = 0;
      $('countdown').textContent = 'GO!';
      sound.play('count', 1);
      setTimeout(() => $('countdown').classList.add('hidden'), 600);
    }

    // Local prediction of our own movement
    const me = this.me;
    if (now >= this.startAt && me.alive) {
      this.acc += Math.min(dt, 0.1);
      while (this.acc >= TICK) {
        movePlayer(m.maze, me, TICK);
        this.acc -= TICK;
        const cx = ((Math.round(me.x) % COLS) + COLS) % COLS, cy = Math.round(me.y);
        if (cx !== me.tx || cy !== me.ty) {
          me.tx = cx; me.ty = cy;
          const k = key(cx, cy);
          if (!m.taken.has(k) && !m.maze.items.has(k) && m.maze.isFloor(cx, cy)) {
            m.taken.add(k);
            this.predicted.add(k);
            sound.play('dot', me.chain + 1);
            me.bite = 0.12;
          }
        }
      }
      me.bite = Math.max(0, me.bite - dt);
      this.sendT -= dt;
      if (this.sendT <= 0) {
        this.sendT = 0.05;
        net.send({ t: 'pos', x: Math.round(me.x * 1000) / 1000, y: Math.round(me.y * 1000) / 1000, d: me.dir });
      }
    }
    if (this.predicted.size > 200) this.predicted.clear();

    for (const [k, t] of m.fires) { if (t - dt <= 0) m.fires.delete(k); else m.fires.set(k, t - dt); }

    // Interpolate everyone else
    m.time = this.latestTime + (now - this.latestAt) / 1000;
    const rt = now - INTERP_MS;
    let a = null, b = null;
    for (let i = this.buf.length - 1; i >= 0; i--) {
      if (this.buf[i].at <= rt) { a = this.buf[i]; b = this.buf[i + 1] || a; break; }
    }
    if (!a && this.buf.length) a = b = this.buf[0];
    if (!a) { m.players = [me]; return; }
    const f = b === a ? 0 : Math.min(1, (rt - a.at) / (b.at - a.at));
    const sa = a.s, sb = b.s;
    m.voidY = lerp(sa.voidY, sb.voidY, f);
    const pa = new Map(sa.players.map((p) => [p.id, p]));
    m.players = sb.players.map((p) => {
      if (p.id === this.meId) return me;
      const o = pa.get(p.id) || p;
      const inf = this.info.get(p.id) || {};
      return { ...p, x: lerpX(o.x, p.x, f), y: lerp(o.y, p.y, f), name: inf.name, color: inf.color, loadout: inf.loadout };
    });
    const ea = new Map(sa.enemies.map((e) => [e[0], e]));
    m.enemies = sb.enemies.map((e) => {
      const o = ea.get(e[0]) || e;
      return { id: e[0], type: ENEMY_LIST[e[1]], x: lerpX(o[2], e[2], f), y: lerp(o[3], e[3], f), dir: e[4], vuln: e[5], dash: e[6] };
    });
    sound.tempo = 1 + Math.min(0.6, Math.max(0, ...m.players.map((p) => p.y)) / 1500);
    $('spectate').classList.toggle('hidden', me.alive);
  }

  finish(results) {
    this.done = true;
    const mine = results.find((r) => r.id === this.meId) || results[0];
    const res = store.recordGame({ score: mine.score, distance: mine.distance, chain: mine.bestChain, coins: mine.coins, dots: 0, kills: mine.kills });
    showGameOver({
      score: mine.score, distance: mine.distance, chain: mine.bestChain, kills: mine.kills, coins: res.coinsEarned,
      newBest: res.newBest, cause: null, ranking: results,
    });
  }
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------
function startGame(g) {
  game = g;
  hideScreens();
  $('hud').classList.remove('hidden');
  $('hud-players').classList.toggle('hidden', !g.online);
  $('spectate').classList.add('hidden');
  $('countdown').classList.add('hidden');
  input.enabled = true;
  applySettings();
  sound.unlock();
  sound.startMusic();
  hudCache = {};
  if (!g.online && !store.data.seenTutorial) {
    const t = $('tutorial');
    t.innerHTML = '<b>Swipe</b> to move.<br>Outrun the <b style="color:#ff2a6d">Void</b> rising below.<br>Eat dots in a row to build your <b style="color:#ffd84d">chain</b>!';
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 6500);
    store.data.seenTutorial = true;
    store.save();
  }
}

function endGameUI() {
  input.enabled = false;
  $('hud').classList.add('hidden');
  $('dpad').classList.add('hidden');
  $('tutorial').classList.add('hidden');
  sound.stopMusic();
}

function quitGame() {
  if (game && game.online) net.send({ t: 'leave' });
  game = null;
  room = null;
  endGameUI();
  show('menu');
}

function showGameOver(r) {
  endGameUI();
  const causes = {
    void: 'Consumed by the Void', left: 'Disconnected',
    ...Object.fromEntries(ENEMY_LIST.map((t) => [t, 'Caught by a ' + ENEMIES[t].name])),
  };
  $('over-title').textContent = r.ranking ? 'MATCH OVER' : 'GAME OVER';
  $('over-cause').textContent = r.cause ? causes[r.cause] || '' : '';
  $('over-score').textContent = r.score.toLocaleString();
  $('over-new').classList.toggle('hidden', !r.newBest);
  $('over-dist').textContent = r.distance;
  $('over-chain').textContent = r.chain;
  $('over-kills').textContent = r.kills;
  $('over-coins').textContent = '+' + r.coins + ' ◆';
  const rk = $('over-ranking');
  rk.classList.toggle('hidden', !r.ranking);
  if (r.ranking) {
    rk.innerHTML = r.ranking.map((p) =>
      `<li style="color:${p.color}">${escapeHtml(p.name)}<span class="s">${p.score.toLocaleString()}</span></li>`).join('');
  }
  $('btn-retry').textContent = r.ranking ? 'BACK TO ROOM' : 'PLAY AGAIN';
  show('over');
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
let hudCache = {};
function setText(id, v) {
  if (hudCache[id] === v) return false;
  hudCache[id] = v;
  $(id).textContent = v;
  return true;
}
const fxMax = {};
function updateHud(g) {
  const p = g.hudPlayer();
  setText('hud-score', p.score.toLocaleString());
  if (setText('hud-chain-n', String(p.chain)) && p.chain > 0) {
    const el = $('hud-chain');
    el.classList.add('pop');
    setTimeout(() => el.classList.remove('pop'), 80);
  }
  setText('hud-mult', 'x' + chainMult(p.chain));
  setText('hud-dist', String(p.maxY));

  // Active effects (own + global)
  const t = g.view().timers;
  const active = [];
  for (const id in p.fx) active.push([id, p.fx[id]]);
  if (t.freeze > 0) active.push(['freeze', t.freeze]);
  if (t.chrono > 0) active.push(['chrono', t.chrono]);
  if (t.surge > 0) active.push(['surge', t.surge]);
  const ids = active.map((a) => a[0]).join(',');
  const box = $('hud-fx');
  if (hudCache.fx !== ids) {
    hudCache.fx = ids;
    box.innerHTML = active.map(([id]) => {
      const def = id === 'surge' ? { name: 'Surge', glyph: '●', color: '#ff4dd8' } : POWERUPS[id];
      return `<div class="fx-pill" style="color:${def.color}"><span class="g" style="background:${def.color}">${def.glyph}&#xFE0E;</span><span class="bar"><i></i></span></div>`;
    }).join('');
    for (const k in fxMax) if (!active.some((a) => a[0] === k)) delete fxMax[k];
  }
  const bars = box.querySelectorAll('.bar i');
  active.forEach(([id, rem], i) => {
    fxMax[id] = Math.max(fxMax[id] || 0, rem);
    if (bars[i]) bars[i].style.width = Math.max(0, (rem / fxMax[id]) * 100) + '%';
  });

  if (g.online) {
    const list = g.view().players.slice().sort((a, b) => b.score - a.score)
      .map((pl) => `<div class="pl${pl.alive ? '' : ' dead'}" style="color:${pl.color}">${escapeHtml(pl.name || '')} ${pl.score.toLocaleString()}</div>`).join('');
    if (hudCache.pl !== list) { hudCache.pl = list; $('hud-players').innerHTML = list; }
  }
}

// ---------------------------------------------------------------------------
// Power-ups screen
// ---------------------------------------------------------------------------
function buildPowerups() {
  const d = store.data;
  $('pu-coins').textContent = d.coins;
  $('loadout').innerHTML = [0, 1, 2].map((i) => {
    const id = d.loadout[i];
    if (!id) return '<div class="slot">EMPTY</div>';
    const def = POWERUPS[id];
    return `<div class="slot filled" style="border-color:${def.color}"><span class="g" style="color:${def.color}">${def.glyph}&#xFE0E;</span>${def.name}</div>`;
  }).join('');
  $('pu-list').innerHTML = POWERUP_LIST.map((id) => {
    const def = POWERUPS[id];
    const lvl = store.level(id);
    const unlocked = store.isUnlocked(id);
    const equipped = d.loadout.includes(id);
    const pips = unlocked ? 'Lv ' + lvl + ' ' + '●'.repeat(lvl) + '○'.repeat(MAX_LEVEL - lvl) : 'LOCKED';
    let acts;
    if (!unlocked) {
      acts = `<button data-act="unlock" data-id="${id}" ${d.coins < def.unlock ? 'disabled' : ''}>UNLOCK ◆${def.unlock}</button>`;
    } else {
      const cost = store.upgradeCost(id);
      acts = `<button data-act="equip" data-id="${id}" class="${equipped ? 'on' : ''}">${equipped ? 'EQUIPPED' : 'EQUIP'}</button>` +
        (cost == null ? '<button disabled>MAX</button>'
          : `<button data-act="upgrade" data-id="${id}" ${d.coins < cost ? 'disabled' : ''}>UPGRADE ◆${cost}</button>`);
    }
    return `<div class="pu ${equipped ? 'equipped' : ''} ${unlocked ? '' : 'locked'}">
      <div class="icon" style="background:${def.color}">${def.glyph}&#xFE0E;</div>
      <div><div class="name">${def.name}</div><div class="desc">${def.desc}</div><div class="lvl">${pips}</div></div>
      <div class="acts">${acts}</div></div>`;
  }).join('');
}

$('pu-list').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  click();
  const id = b.dataset.id;
  if (b.dataset.act === 'unlock' && store.unlock(id)) { toast(POWERUPS[id].name + ' unlocked!'); sound.play('gem'); }
  if (b.dataset.act === 'upgrade' && store.upgrade(id)) { toast(POWERUPS[id].name + ' upgraded!'); sound.play('coin'); }
  if (b.dataset.act === 'equip') store.toggleEquip(id);
  buildPowerups();
});

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------
async function loadScores(board) {
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.board === board);
  const list = $('score-list');
  list.innerHTML = '<li>Loading…</li>';
  try {
    const r = await fetch('/api/scores?board=' + board);
    const j = await r.json();
    list.innerHTML = j.scores.length
      ? j.scores.map((s) => `<li>${escapeHtml(s.name)} <span class="d">${s.distance}m</span><span class="s">${s.score.toLocaleString()}</span></li>`).join('')
      : '<li>No scores yet. Be the first!</li>';
  } catch {
    list.innerHTML = '<li>Leaderboard unavailable offline.</li>';
  }
}
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => { click(); loadScores(t.dataset.board); });

// ---------------------------------------------------------------------------
// Online lobby
// ---------------------------------------------------------------------------
function sendProfile() {
  net.send({ t: 'profile', name: store.data.name, loadout: store.loadoutForGame() });
}
net.on('open', () => {
  $('net-status').textContent = 'Connected. Pick a mode:';
  sendProfile();
  if (pendingJoin) { net.send({ t: 'join', code: pendingJoin }); pendingJoin = null; }
});
net.on('close', () => {
  $('net-status').textContent = 'Reconnecting…';
  if (game && game.online && !game.done) { toast('Connection lost'); quitGame(); }
  else if (current === 'room') { room = null; show('online'); }
});
net.on('error', (m) => toast(m.msg));
net.on('room', (info) => {
  room = info;
  if (game && game.online && !game.done) return;
  if (current === 'over') return; // they'll press "back to room"
  renderRoom();
  show('room');
});
net.on('start', (msg) => {
  startGame(new OnlineGame(msg));
});
net.on('s', (s) => { if (game && game.online && !game.done) game.onSnapshot(s); });
net.on('end', (msg) => { if (game && game.online) game.finish(msg.results); });

function renderRoom() {
  if (!room) return;
  $('room-code').textContent = room.code;
  $('room-sub').textContent = room.isPublic ? 'Public room — others can quick-match in.' : 'Share the code with friends.';
  $('room-players').innerHTML = room.players.map((p) =>
    `<li><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}${p.id === net.id ? ' (you)' : ''}${p.id === room.host ? '<span class="host">HOST</span>' : ''}</li>`).join('');
  const isHost = room.host === net.id;
  $('btn-start').classList.toggle('hidden', !isHost);
  $('room-wait').classList.toggle('hidden', isHost);
}

let pendingJoin = null;

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
$('btn-solo').onclick = () => { click(); startGame(new SoloGame()); };
$('btn-online').onclick = () => {
  click();
  $('in-name').value = store.data.name;
  $('net-status').textContent = net.connected ? 'Connected. Pick a mode:' : 'Connecting…';
  net.connect();
  show('online');
};
$('btn-powerups').onclick = () => { click(); backTo = 'menu'; show('powerups'); };
$('btn-scores').onclick = () => { click(); show('scores'); loadScores('solo'); };
$('btn-settings').onclick = () => {
  click();
  const s = store.data.settings;
  $('set-sound').checked = s.sound; $('set-music').checked = s.music;
  $('set-dpad').checked = s.dpad; $('set-haptics').checked = s.haptics;
  $('set-name').value = store.data.name;
  show('settings');
};
$('btn-howto').onclick = () => { click(); show('howto'); };
for (const b of document.querySelectorAll('[data-back]')) {
  b.addEventListener('click', () => { click(); show(current === 'powerups' ? backTo : 'menu'); });
}
for (const id of ['sound', 'music', 'dpad', 'haptics']) {
  $('set-' + id).addEventListener('change', (e) => { store.data.settings[id] = e.target.checked; store.save(); applySettings(); });
}
const setName = (v) => {
  const n = v.trim().slice(0, 14);
  if (n) { store.data.name = n; store.save(); sendProfile(); }
};
$('set-name').addEventListener('change', (e) => setName(e.target.value));
$('in-name').addEventListener('change', (e) => setName(e.target.value));

$('btn-quick').onclick = () => { click(); setName($('in-name').value); sendProfile(); net.send({ t: 'quick' }); };
$('btn-create').onclick = () => { click(); setName($('in-name').value); sendProfile(); net.send({ t: 'create' }); };
$('btn-join').onclick = () => {
  click();
  const code = $('in-code').value.trim().toUpperCase();
  if (code.length !== 4) return toast('Enter a 4-letter room code');
  setName($('in-name').value);
  sendProfile();
  net.send({ t: 'join', code });
};
$('btn-start').onclick = () => {
  click();
  if (room && room.players.length < 1) return;
  sendProfile();
  net.send({ t: 'start' });
};
$('btn-leave').onclick = () => { click(); net.send({ t: 'leave' }); room = null; show('online'); };
$('btn-share').onclick = async () => {
  click();
  if (!room) return;
  const url = `${location.origin}/?room=${room.code}`;
  const text = `Join my BYTE RUSH room: ${room.code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'BYTE RUSH', text, url });
    else { await navigator.clipboard.writeText(url); toast('Invite link copied!'); }
  } catch { /* cancelled */ }
};

$('btn-retry').onclick = () => {
  click();
  if (game && game.online) {
    game = null;
    if (room) { renderRoom(); show('room'); } else show('online');
  } else startGame(new SoloGame());
};
$('btn-over-pu').onclick = () => { click(); backTo = 'over'; show('powerups'); };
$('btn-over-menu').onclick = () => { click(); quitGame(); };

function pause() {
  if (!game || game.done || current === 'pause') return;
  if (!game.online) game.paused = true;
  input.enabled = false;
  show('pause');
}
$('btn-pause').onclick = () => { click(); pause(); };
input.onPause = pause;
$('btn-resume').onclick = () => {
  click();
  if (game) { game.paused = false; input.enabled = true; }
  hideScreens();
};
$('btn-quit').onclick = () => { click(); quitGame(); };
document.addEventListener('visibilitychange', () => { if (document.hidden && game && !game.online) pause(); });

input.onDir = (d) => { if (game) game.input(d); };

// How-to enemy guide
$('enemy-guide').innerHTML = ENEMY_LIST.map((t) =>
  `<div><b style="color:${ENEMIES[t].color}">${ENEMIES[t].name}</b>${ENEMIES[t].desc}</div>`).join('');

// ---------------------------------------------------------------------------
// Main loop (also renders a slowly scrolling maze behind the menus)
// ---------------------------------------------------------------------------
const demo = {
  maze: new Maze(12345), taken: new Set(), fires: new Map(), players: [], enemies: [],
  voidY: -1e9, timers: { surge: 0, freeze: 0, chrono: 0 }, time: 0,
};
let demoY = 0;
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game && !game.done) {
    game.update(dt);
    renderer.draw(game.view(), dt, game.meId);
    if (game && !game.done) updateHud(game);
  } else if (game && game.done) {
    renderer.draw(game.view(), dt, game.meId);
  } else {
    demoY += dt * 2.2;
    demo.time += dt;
    renderer.draw(demo, dt, null, demoY);
  }
  requestAnimationFrame(frame);
}

applySettings();
show('menu');
requestAnimationFrame(frame);

// Invite links: /?room=CODE
const params = new URLSearchParams(location.search);
if (params.get('room')) {
  pendingJoin = params.get('room').toUpperCase().slice(0, 4);
  history.replaceState(null, '', '/');
  $('btn-online').onclick();
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Debug handle for automated testing
window.__byterush = { get game() { return game; }, store, renderer };
