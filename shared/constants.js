// Shared game constants used by both the browser client and the Node server.

export const NODE_COLS = 10;                 // maze graph nodes per row
export const COLS = NODE_COLS * 2 - 1;       // tile columns (19)
export const CHUNK_NODE_ROWS = 8;            // node rows generated per chunk
export const CHUNK_ROWS = CHUNK_NODE_ROWS * 2; // tile rows per chunk (16)

// Directions. World Y grows upward (the direction you run).
export const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
export const DX = [0, 1, 0, -1];
export const DY = [1, 0, -1, 0];
export const OPP = [2, 3, 0, 1];

export const TICK = 1 / 60;
export const PLAYER_SPEED = 6.6;            // tiles / second
export const START_X = [9, 5, 13, 1, 17, 3];
export const PLAYER_COLORS = ['#3ef2ff', '#ff5ef0', '#9dff3e', '#ffb13e'];
export const MAX_ROOM_PLAYERS = 4;

export const CHAIN_STEP = 30;                // dots per multiplier step
export const CHAIN_MAX_MULT = 10;
export const NOVA_CHAIN = 300;               // every N chain → screen-clearing nova

export const chainMult = (chain) => Math.min(CHAIN_MAX_MULT, 1 + Math.floor(chain / CHAIN_STEP));

// ---------------------------------------------------------------------------
// Power-ups. Equip up to 3; each one you equip spawns in the maze.
// stat(level) returns the tuning for that level (1..MAX_LEVEL).
// ---------------------------------------------------------------------------
export const MAX_LEVEL = 5;
export const UPGRADE_COST = [0, 15, 35, 70, 120]; // cost to go from level L to L+1 (index L)

export const POWERUPS = {
  bomb: {
    name: 'Bomb', glyph: '✸', color: '#ff8a3d', unlock: 0, kind: 'instant',
    desc: 'Detonates instantly, destroying nearby enemies.',
    stat: (l) => ({ radius: 3 + l * 0.7 }),
  },
  freeze: {
    name: 'Freeze', glyph: '❄', color: '#8fe9ff', unlock: 0, kind: 'global',
    desc: 'Freezes every enemy. Frozen enemies can be eaten.',
    stat: (l) => ({ dur: 3 + l * 0.8 }),
  },
  shield: {
    name: 'Shield', glyph: '◈', color: '#5effa1', unlock: 0, kind: 'timed',
    desc: 'Enemies that touch you are destroyed.',
    stat: (l) => ({ dur: 4 + l * 1.2 }),
  },
  laser: {
    name: 'Laser', glyph: '↟', color: '#ff4d6d', unlock: 40, kind: 'timed',
    desc: 'Fires a beam ahead of you that vaporizes enemies.',
    stat: (l) => ({ dur: 3.5 + l * 0.9, range: 9 + l }),
  },
  magnet: {
    name: 'Magnet', glyph: '⊍', color: '#ffd84d', unlock: 40, kind: 'timed',
    desc: 'Pulls in nearby dots, keeping your chain alive.',
    stat: (l) => ({ dur: 5 + l, radius: 2 + Math.floor(l / 2) }),
  },
  blaze: {
    name: 'Blaze', glyph: '▲', color: '#ff5a1f', unlock: 60, kind: 'timed',
    desc: 'Leave a trail of fire that burns enemies.',
    stat: (l) => ({ dur: 4 + l, burn: 2.5 + l * 0.5 }),
  },
  phase: {
    name: 'Phase', glyph: '◌', color: '#c7a4ff', unlock: 60, kind: 'timed',
    desc: 'Turn intangible. Enemies lose track of you.',
    stat: (l) => ({ dur: 4 + l }),
  },
  drone: {
    name: 'Drone', glyph: '✦', color: '#ffffff', unlock: 80, kind: 'timed',
    desc: 'Orbiting drones smash into enemies. 2 drones at Lv3+.',
    stat: (l) => ({ dur: 5 + l, count: l >= 3 ? 2 : 1 }),
  },
  chrono: {
    name: 'Chrono', glyph: '◷', color: '#4dd6ff', unlock: 80, kind: 'global',
    desc: 'Slows enemies and the Void to a crawl.',
    stat: (l) => ({ dur: 4 + l }),
  },
  shockwave: {
    name: 'Shockwave', glyph: '◎', color: '#ff3df2', unlock: 100, kind: 'instant',
    desc: 'Blasts enemies away and pushes the Void back.',
    stat: (l) => ({ radius: 5 + l, push: 6 + l * 2 }),
  },
};
export const POWERUP_LIST = Object.keys(POWERUPS);

// ---------------------------------------------------------------------------
// Enemies. `from` = first chunk index where the type can appear.
// ---------------------------------------------------------------------------
export const ENEMIES = {
  hunter:  { name: 'Hunter',  color: '#ff3b5c', speed: 5.0, from: 1, desc: 'Chases you directly.' },
  drifter: { name: 'Drifter', color: '#4dff88', speed: 4.3, from: 1, desc: 'Wanders, sometimes follows.' },
  flanker: { name: 'Flanker', color: '#ff6bd6', speed: 5.2, from: 3, desc: 'Cuts you off from the front.' },
  rusher:  { name: 'Rusher',  color: '#ff9f1c', speed: 7.4, from: 6, desc: 'Fast. Only turns when it has to.' },
  phantom: { name: 'Phantom', color: '#a06bff', speed: 5.0, from: 9, desc: 'Invisible until it is close.' },
  charger: { name: 'Charger', color: '#ffe14d', speed: 3.6, dash: 10.5, from: 12, desc: 'Dashes when it sees you.' },
};
export const ENEMY_LIST = Object.keys(ENEMIES);
