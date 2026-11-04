import {
  LAMP_COLORS,
  LAMP_SEQUENCE_LENGTH,
  SYMBOLS,
  SAFE_DIALS,
  MINUTE_STEP,
  LEVER_WINDOW_MS,
  TUBE_TRAVEL_MS,
  ROLES,
  ROOM_NAMES,
  formatTime,
} from '../shared/constants.js';

const randInt = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[randInt(arr.length)];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newPuzzle() {
  // No colour twice in a row, so each flash is easy to call out.
  const sequence = [];
  while (sequence.length < LAMP_SEQUENCE_LENGTH) {
    const c = pick(LAMP_COLORS);
    if (c !== sequence[sequence.length - 1]) sequence.push(c);
  }

  const safeTarget = shuffle(SYMBOLS.map((_, i) => i)).slice(0, SAFE_DIALS);
  let dials;
  do {
    dials = Array.from({ length: SAFE_DIALS }, () => randInt(SYMBOLS.length));
  } while (dials.every((d, i) => d === safeTarget[i]));

  let clockTarget;
  do {
    clockTarget = { h: 1 + randInt(12), m: randInt(60 / MINUTE_STEP) * MINUTE_STEP };
  } while (clockTarget.h === 12 && clockTarget.m === 0);

  return { sequence, safeTarget, dials, clockTarget };
}

/**
 * One shared game per room (a Discord activity instance or a browser room code).
 * The server owns all puzzle state; clients only send actions.
 */
export class Game {
  constructor(id, { broadcast, sendTo, now = () => Date.now(), schedule = setTimeout, puzzle } = {}) {
    this.id = id;
    this.broadcast = broadcast || (() => {});
    this.sendTo = sendTo || (() => {});
    this.now = now;
    this.schedule = schedule;
    this.players = new Map(); // clientId -> { id, name, connected, role }
    this.roles = { study: null, workshop: null }; // role -> clientId
    this.reset(puzzle);
  }

  reset(puzzle = newPuzzle()) {
    this.round = (this.round || 0) + 1;
    this.stage = 'lamps';
    this.lamp = { sequence: puzzle.sequence, input: [] };
    this.safe = { target: puzzle.safeTarget, dials: [...puzzle.dials], open: false };
    this.gear = 'safe';
    this.clock = { target: puzzle.clockTarget, h: 12, m: 0 };
    this.levers = { study: 0, workshop: 0 };
    this.startedAt = null;
    this.finishedAt = null;
    this.log = [];
  }

  // ---------- players ----------

  join(clientId, name) {
    const existing = this.players.get(clientId);
    const player = existing || { id: clientId, role: 'spectator' };
    player.name = String(name || 'Detective').slice(0, 24);
    player.connected = true;
    this.players.set(clientId, player);

    // Reclaim your old room if nobody else took it while you were away.
    if (existing && ROLES.includes(existing.role) && this.roles[existing.role] !== clientId) {
      player.role = 'spectator';
    }
    // Otherwise drop newcomers into whichever room is free.
    if (player.role === 'spectator') {
      const free = ROLES.find((r) => !this.roleHolder(r));
      if (free) this.assign(player, free);
    }
    this.push(`${player.name} joined`);
    this.sync();
    return player;
  }

  leave(clientId) {
    const player = this.players.get(clientId);
    if (!player) return;
    player.connected = false;
    this.push(`${player.name} left`);
    this.sync();
  }

  roleHolder(role) {
    const id = this.roles[role];
    const p = id && this.players.get(id);
    return p && p.connected ? p : null;
  }

  assign(player, role) {
    for (const r of ROLES) if (this.roles[r] === player.id) this.roles[r] = null;
    if (ROLES.includes(role)) this.roles[role] = player.id;
    player.role = role;
  }

  pickRole(clientId, role) {
    const player = this.players.get(clientId);
    if (!player) return;
    if (role !== 'spectator' && !ROLES.includes(role)) return;
    const holder = ROLES.includes(role) && this.roleHolder(role);
    if (holder && holder.id !== clientId) {
      this.toast(clientId, `${holder.name} is already in ${ROOM_NAMES[role]}.`);
      return;
    }
    this.assign(player, role);
    this.sync();
  }

  // ---------- actions ----------

  act(clientId, msg) {
    const player = this.players.get(clientId);
    if (!player) return;
    const role = player.role;
    const action = msg.action;

    if (action === 'restart') {
      this.reset();
      this.push(`${player.name} started a new case`);
      this.fx('restart', player);
      this.sync();
      return;
    }
    if (this.stage === 'won') return;
    if (!ROLES.includes(role)) {
      this.toast(clientId, 'Spectators can look, but not touch!');
      return;
    }
    if (!this.startedAt) this.startedAt = this.now();

    const handler = ACTIONS[role]?.[action];
    if (!handler) return;
    handler.call(this, player, msg);
    this.sync();
  }

  // ---------- helpers ----------

  push(text) {
    this.log.push({ t: this.now(), text });
    if (this.log.length > 12) this.log.shift();
  }

  toast(clientId, text) {
    this.sendTo(clientId, { t: 'toast', text });
  }

  fx(kind, player, extra = {}) {
    this.broadcast({ t: 'fx', fx: kind, by: player?.name, role: player?.role, ...extra });
  }

  sync() {
    this.broadcast({ t: 'state', state: this.view() });
  }

  view() {
    const roles = {};
    for (const r of ROLES) {
      const p = this.roleHolder(r);
      roles[r] = p ? { id: p.id, name: p.name } : null;
    }
    return {
      room: this.id,
      round: this.round,
      stage: this.stage,
      roles,
      players: [...this.players.values()]
        .filter((p) => p.connected)
        .map((p) => ({ id: p.id, name: p.name, role: p.role })),
      // Co-op with friends: every client gets the answers it needs to draw its room.
      lamp: { sequence: this.lamp.sequence, input: this.lamp.input },
      safe: { target: this.safe.target, dials: this.safe.dials, open: this.safe.open },
      gear: this.gear,
      clock: this.clock,
      levers: { study: !!this.levers.study, workshop: !!this.levers.workshop },
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      serverNow: this.now(),
      log: this.log.slice(-6),
    };
  }

  // ---------- shared mechanics ----------

  sendThroughTube(player, from) {
    const hand = `${from}-hand`;
    if (this.gear !== hand) {
      this.toast(player.id, 'The tube hisses hungrily. You have nothing to send.');
      return;
    }
    const to = from === 'study' ? 'workshop' : 'study';
    this.gear = 'tube';
    this.fx('whoosh', player, { to });
    this.push(`${player.name} sent the gear through the tube`);
    const round = this.round;
    this.schedule(() => {
      if (this.round !== round || this.gear !== 'tube') return;
      this.gear = `${to}-tube`;
      this.fx('arrive', player, { to });
      this.sync();
    }, TUBE_TRAVEL_MS);
  }

  takeFromTube(player, side) {
    if (this.gear !== `${side}-tube`) return;
    this.gear = `${side}-hand`;
    this.fx('pickup', player);
  }

  pullLever(player) {
    if (this.stage !== 'levers') {
      this.toast(player.id, 'The lever is locked in place. Not yet...');
      this.fx('locked', player);
      return;
    }
    const me = player.role;
    const other = me === 'study' ? 'workshop' : 'study';
    const t = this.now();
    this.levers[me] = t;
    this.fx('lever', player);

    if (this.levers[other] && t - this.levers[other] <= LEVER_WINDOW_MS) {
      this.stage = 'won';
      this.finishedAt = t;
      this.push('Both levers pulled. THE VAULT IS OPEN!');
      this.fx('win', player);
      return;
    }
    const round = this.round;
    this.schedule(() => {
      if (this.round !== round || this.stage !== 'levers' || this.levers[me] !== t) return;
      this.levers[me] = 0;
      this.fx('lever-reset', player);
      this.toast(player.id, 'The lever springs back. You have to pull together!');
      this.sync();
    }, LEVER_WINDOW_MS);
  }

  turnClock(player) {
    if (this.stage === 'clock') return true;
    if (this.gear !== 'clock') {
      this.toast(player.id, 'The knob spins freely. The clock is missing something inside.');
    }
    return false;
  }

  checkClock(player) {
    this.fx('tick', player);
    const { h, m, target } = this.clock;
    if (h === target.h && m === target.m) {
      this.stage = 'levers';
      this.push(`${player.name} set the clock to ${formatTime(h, m)}. BONG! Levers unlocked.`);
      this.fx('chime', player);
    }
  }
}

// Actions each room can perform. `this` is the Game.
const ACTIONS = {
  study: {
    bell(player) {
      if (this.stage !== 'lamps') {
        this.toast(player.id, 'Ding! The lamps stay quiet now.');
        this.fx('ding', player);
        return;
      }
      this.fx('flash', player, { sequence: this.lamp.sequence });
      this.push(`${player.name} rang the bell`);
    },

    dial(player, { index }) {
      if (!Number.isInteger(index) || index < 0 || index >= SAFE_DIALS) return;
      if (this.safe.open) return;
      if (this.stage !== 'safe') {
        this.toast(player.id, "The dials are jammed. Something else must happen first.");
        this.fx('locked', player);
        return;
      }
      this.safe.dials[index] = (this.safe.dials[index] + 1) % SYMBOLS.length;
      this.fx('click', player);
      if (this.safe.dials.every((d, i) => d === this.safe.target[i])) {
        this.safe.open = true;
        this.stage = 'gear';
        this.push(`${player.name} cracked the safe!`);
        this.fx('safe-open', player);
      }
    },

    gear(player) {
      if (this.gear === 'safe' && this.safe.open) {
        this.gear = 'study-hand';
        this.fx('pickup', player);
        this.push(`${player.name} took a brass gear`);
      } else {
        this.takeFromTube(player, 'study');
      }
    },

    tube(player) {
      if (this.gear === 'study-tube') return this.takeFromTube(player, 'study');
      this.sendThroughTube(player, 'study');
    },

    lever(player) {
      this.pullLever(player);
    },
  },

  workshop: {
    panel(player, { color }) {
      if (!LAMP_COLORS.includes(color)) return;
      if (this.stage !== 'lamps') {
        this.toast(player.id, 'The panel glows green. It has done its job.');
        return;
      }
      this.lamp.input.push(color);
      this.fx('press', player, { color });
      if (this.lamp.input.length < this.lamp.sequence.length) return;

      const ok = this.lamp.input.every((c, i) => c === this.lamp.sequence[i]);
      if (ok) {
        this.stage = 'safe';
        this.push(`${player.name} entered the lamp code. Something rumbles...`);
        this.fx('solved', player, { puzzle: 'lamps' });
      } else {
        this.push(`${player.name} entered a wrong code`);
        this.fx('buzz', player);
      }
      this.lamp.input = [];
    },

    gear(player) {
      this.takeFromTube(player, 'workshop');
    },

    tube(player) {
      if (this.gear === 'workshop-tube') return this.takeFromTube(player, 'workshop');
      this.sendThroughTube(player, 'workshop');
    },

    clock(player) {
      if (this.gear === 'workshop-hand') {
        this.gear = 'clock';
        this.stage = 'clock';
        this.push(`${player.name} fixed the grandfather clock. It ticks again!`);
        this.fx('clunk', player);
      } else if (this.gear !== 'clock') {
        this.toast(player.id, 'The clock is jammed. A gear is missing from its works.');
        this.fx('locked', player);
      }
    },

    hour(player) {
      if (!this.turnClock(player)) return;
      this.clock.h = (this.clock.h % 12) + 1;
      this.checkClock(player);
    },

    minute(player) {
      if (!this.turnClock(player)) return;
      this.clock.m = (this.clock.m + MINUTE_STEP) % 60;
      this.checkClock(player);
    },

    lever(player) {
      this.pullLever(player);
    },
  },
};
