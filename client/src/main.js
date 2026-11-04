import './style.css';
import { World } from './world.js';
import { Rooms, VIEWPOINTS } from './rooms.js';
import { Hud } from './hud.js';
import { Net } from './net.js';
import { isInDiscord, setupDiscord } from './discord.js';
import { sfx, unlockAudio, setMuted, isMuted } from './audio.js';
import { ROOM_NAMES } from '../../shared/constants.js';

const params = new URLSearchParams(window.location.search);
const inDiscord = isInDiscord();

const world = new World(document.getElementById('scene'));
const rooms = new Rooms(world);
const hud = new Hud();

const me = { clientId: null, name: '', role: 'spectator', view: 'study' };
let state = null;
let net = null;
let serverOffset = 0;
let victoryTimer = null;

const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode etc. */
    }
  },
};

// ---------- view ----------

function setView(view) {
  const changed = view !== me.view || !world.viewSet;
  me.view = view;
  rooms.setView(view, me.role);
  if (changed) {
    const vp = VIEWPOINTS[view];
    world.setViewpoint(vp.pos, vp.yaw);
    world.viewSet = true;
  }
}
setView('study');

// ---------- interaction ----------

const FLAVOR = {
  magnifier: 'A trusty magnifying glass. Every good detective needs one.',
  'safe-door': 'A heavy iron safe by Hollis & Co. Three symbol dials on the front.',
  portrait: 'Old Hollis, the clockmaker. His eyes seem to follow you around the room.',
  bookshelf: '"Clocks & Their Secrets", "Advanced Gearing", "Two Minds, One Lock"…',
  fireplace: 'A crackling fire. Cosy, but no clues in here.',
  armchair: 'A comfy leather armchair. No time to sit. The case awaits!',
  workbench: 'A cluttered workbench. Plenty of steel cogs, but none of them are quite right.',
  pegboard: 'Neatly hung tools. Hollis was tidy, at least.',
  crates: 'Crates stamped "FRAGILE: CLOCK PARTS". All empty.',
};

function localAction(data) {
  switch (data.id) {
    case 'note':
      return hud.inspect(rooms.noteImage, 'Read this to your partner.');
    case 'chalkboard':
      return hud.inspect(rooms.chalkImage, 'Describe these to your partner, left to right.');
    case 'curtain':
      return hud.toast("The curtain is fixed to some mechanism. It won't budge… yet.");
    case 'lamps':
      return hud.toast(
        state?.stage === 'lamps'
          ? 'Four glass lamps: red, green, blue and yellow. They seem wired to something… maybe the bell?'
          : 'The lamps glow softly. They have told their secret.',
      );
    default:
      if (FLAVOR[data.id]) hud.toast(FLAVOR[data.id]);
  }
}

world.canInteract = (data) => {
  if (data.kind === 'local') return true;
  return me.role === data.room;
};

world.onClick = (data) => {
  unlockAudio();
  if (data.kind === 'local') return localAction(data);
  const msg = { t: 'act', action: data.id };
  if (data.index !== undefined) msg.index = data.index;
  if (data.color) msg.color = data.color;
  net?.send(msg);
};

let hoverLabel = '';
world.onHover = (data) => {
  hoverLabel = data?.label || '';
  hud.tooltip(hoverLabel);
};
// Touch has no hover, so show the label briefly on tap instead.
world.canvas.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse') return;
  const hit = world.pick(e.clientX, e.clientY);
  hoverLabel = hit?.userData.interact.label || '';
  hud.tooltip(hoverLabel, 1600);
});

// ---------- sounds for server events ----------

function playFx(msg) {
  const here = msg.role === me.view;
  switch (msg.fx) {
    case 'flash':
    case 'ding':
      if (here) sfx.bell();
      break;
    case 'press':
      if (here) sfx.press(msg.color);
      break;
    case 'buzz':
      if (here) sfx.buzz();
      break;
    case 'solved':
      sfx.success();
      sfx.rumble();
      if (me.role === 'workshop') hud.toast('Correct! A curtain rises somewhere behind you…', { big: true });
      if (me.role === 'study') hud.toast('A distant rumble… your safe dials loosen.', { big: true });
      break;
    case 'click':
      if (here) sfx.click();
      break;
    case 'locked':
      if (here) sfx.locked();
      break;
    case 'safe-open':
      sfx.safeOpen();
      if (me.role === 'study') hud.toast('The safe swings open!', { big: true });
      break;
    case 'pickup':
      if (here) sfx.pickup();
      break;
    case 'whoosh':
      sfx.whoosh();
      break;
    case 'arrive':
      if (msg.to === me.view) {
        sfx.arrive();
        if (me.role === msg.to) hud.toast('Something just arrived in your Pneumatic Post!', { big: true });
      }
      break;
    case 'clunk':
      if (here) sfx.clunk();
      break;
    case 'tick':
      if (here) sfx.tick();
      break;
    case 'chime':
      sfx.chime();
      hud.toast('BONG… BONG… BONG. The lever lights turn green!', { big: true });
      break;
    case 'lever':
      if (here) sfx.lever();
      break;
    case 'lever-reset':
      if (here) sfx.spring();
      break;
    case 'win':
      sfx.win();
      clearTimeout(victoryTimer);
      victoryTimer = setTimeout(() => state?.stage === 'won' && hud.victory(state), 5500);
      break;
    case 'restart':
      hud.hideVictory();
      hud.toast(`${msg.by} opened a new case!`, { big: true });
      break;
  }
}

// ---------- networking ----------

function onMessage(msg) {
  switch (msg.t) {
    case 'welcome':
      me.clientId = msg.clientId;
      break;
    case 'state': {
      const prev = state;
      state = msg.state;
      serverOffset = state.serverNow - Date.now();
      const mine = state.players.find((p) => p.id === me.clientId);
      me.role = mine?.role || 'spectator';
      setView(me.role === 'spectator' ? me.view : me.role);
      rooms.apply(state);
      hud.update(state, me);
      if (prev && prev.stage === 'won' && state.stage !== 'won') hud.hideVictory();
      if (!prev && state.stage === 'won') hud.victory(state);
      break;
    }
    case 'fx':
      rooms.fx(msg);
      playFx(msg);
      break;
    case 'toast':
      hud.toast(msg.text);
      break;
    case 'look':
      if (msg.role === 'study' || msg.role === 'workshop') {
        rooms.setPartnerLook(msg.role, msg.yaw, msg.pitch);
        if (msg.role !== me.role && me.role !== 'spectator') {
          const name = state?.roles[msg.role]?.name || 'Your partner';
          hud.partnerLook(msg.hover ? `${name} is looking at: ${msg.hover.split(' (')[0].split('.')[0]}` : '');
        }
      }
      break;
  }
}

function start(room, name, clientId) {
  me.name = name;
  me.clientId = clientId;
  const base = inDiscord ? '/.proxy/ws' : '/ws';
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${base}`;
  net = new Net({
    url,
    join: { t: 'join', room, name, clientId },
    onMessage,
    onStatus: (s) => {
      if (s === 'connected') hud.status(inDiscord ? '' : `Room "${room}"`);
      else if (s === 'replaced') hud.status('You opened this game in another window.', true);
      else hud.status(s === 'connecting' ? 'Connecting…' : 'Connection lost, reconnecting…', s !== 'connecting');
    },
  });

  const shareLink = inDiscord ? null : `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
  hud.showRoleStep({
    shareLink,
    onPick: (role) => net.send({ t: 'pick', role }),
    onEnter: () => {
      unlockAudio();
      hud.closeLobby();
      if (state) {
        hud.toast(me.role === 'spectator' ? 'Enjoy the show!' : `You're in ${ROOM_NAMES[me.role]}. Talk to your partner!`, { big: true });
      }
    },
  });

  // Share where you're looking (and what you're hovering) so your partner's avatar follows along.
  let last = '';
  setInterval(() => {
    if (!net || me.role === 'spectator') return;
    const msg = { t: 'look', yaw: +world.yaw.toFixed(2), pitch: +world.pitch.toFixed(2), hover: hoverLabel };
    const sig = `${msg.yaw}|${msg.pitch}|${msg.hover}`;
    if (sig === last) return;
    last = sig;
    net.send(msg);
  }, 150);
}

// ---------- HUD buttons ----------

document.getElementById('btn-hint').addEventListener('click', () => state && hud.hint(state, me.role));
document.getElementById('btn-zoom').addEventListener('click', () => world.toggleZoom());
document.getElementById('btn-menu').addEventListener('click', () => hud.openLobby());
document.getElementById('btn-sound').addEventListener('click', (e) => {
  setMuted(!isMuted());
  e.currentTarget.classList.toggle('off', isMuted());
});
for (const id of ['btn-again', 'btn-new']) {
  document.getElementById(id).addEventListener('click', () => {
    net?.send({ t: 'act', action: 'restart' });
    hud.hideVictory();
  });
}
document.getElementById('btn-look').addEventListener('click', () => hud.hideVictory());
for (const b of document.querySelectorAll('#spectate button')) {
  b.addEventListener('click', () => {
    setView(b.dataset.view);
    if (state) hud.update(state, me);
  });
}
setInterval(() => hud.timer(state, serverOffset), 250);

// ---------- boot ----------

function randomRoom() {
  const words = ['brass', 'cog', 'tick', 'tock', 'chime', 'gear', 'pendulum', 'spring', 'key', 'dial'];
  return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(100 + Math.random() * 900)}`;
}

async function boot() {
  if (inDiscord) {
    hud.status('Connecting to Discord…');
    try {
      const d = await setupDiscord();
      start(d.room, d.name, d.clientId);
    } catch (err) {
      console.error(err);
      hud.status(`Couldn't sign in with Discord: ${err.message}`, true);
    }
    return;
  }

  let clientId = store.get('vault.clientId');
  if (!clientId) {
    clientId = Math.random().toString(36).slice(2, 12);
    store.set('vault.clientId', clientId);
  }
  // Two tabs on one computer should be two different players.
  if (params.has('player')) clientId += `-${params.get('player')}`;

  const room = params.get('room') || randomRoom();
  hud.showNameStep({ name: params.get('name') || store.get('vault.name') || '', room }, (name, chosenRoom) => {
    store.set('vault.name', name);
    const url = new URL(location.href);
    url.searchParams.set('room', chosenRoom);
    history.replaceState(null, '', url);
    start(chosenRoom, name, clientId);
  });
}

boot();

// ---------- debug hooks for automated playtests (?debug) ----------

if (params.has('debug')) {
  window.__vault = {
    state: () => state,
    me: () => ({ ...me }),
    // Turn to face an object and return its on-screen position.
    aim(id, extra = {}) {
      const p = rooms.locate(id, extra);
      if (!p) return null;
      world.lookAt(p);
      return world.project(p);
    },
    look(yaw, pitch, fov) {
      world.yaw = yaw;
      world.pitch = pitch;
      if (fov) {
        world.targetFov = fov;
        world.camera.fov = fov;
        world.camera.updateProjectionMatrix();
      }
    },
  };
}
