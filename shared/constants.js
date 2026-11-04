// Shared by the server (game rules) and the client (rendering).

export const ROLES = ['study', 'workshop'];

export const ROOM_NAMES = {
  study: 'The Study',
  workshop: 'The Workshop',
};

// Order matters: each stage unlocks the next.
export const STAGES = ['lamps', 'safe', 'gear', 'clock', 'levers', 'won'];

export const LAMP_COLORS = ['red', 'green', 'blue', 'yellow'];
export const LAMP_HEX = {
  red: 0xe5483f,
  green: 0x44c767,
  blue: 0x3f86ea,
  yellow: 0xf2cb35,
};
export const LAMP_SEQUENCE_LENGTH = 5;

export const SYMBOLS = ['moon', 'star', 'triangle', 'circle', 'square', 'diamond', 'cross', 'hexagon'];
export const SAFE_DIALS = 3;

export const MINUTE_STEP = 15;

// Both levers must be pulled within this many ms of each other.
export const LEVER_WINDOW_MS = 1500;

// How long the gear spends whooshing through the pneumatic tube.
export const TUBE_TRAVEL_MS = 1200;

// Where the brass gear can be.
export const GEAR_SPOTS = ['safe', 'study-hand', 'tube', 'study-tube', 'workshop-tube', 'workshop-hand', 'clock'];

export function stageIndex(stage) {
  return STAGES.indexOf(stage);
}

export function formatTime(h, m) {
  return `${h}:${String(m).padStart(2, '0')}`;
}
