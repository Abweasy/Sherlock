import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, newPuzzle } from '../server/game.js';
import { LEVER_WINDOW_MS } from '../shared/constants.js';

// A game with a fake clock and a manual timer queue, so tests are deterministic.
function setup() {
  let now = 1_000;
  const timers = [];
  const toasts = [];
  const fx = [];
  const puzzle = {
    sequence: ['red', 'blue', 'green', 'yellow', 'red'],
    safeTarget: [1, 4, 6],
    dials: [0, 0, 0],
    clockTarget: { h: 3, m: 45 },
  };
  const game = new Game('test', {
    now: () => now,
    schedule: (fn, ms) => timers.push({ at: now + ms, fn }),
    sendTo: (id, msg) => toasts.push({ id, ...msg }),
    broadcast: (msg) => msg.t === 'fx' && fx.push(msg.fx),
    puzzle,
  });
  const advance = (ms) => {
    now += ms;
    for (const t of timers.splice(0).sort((a, b) => a.at - b.at)) {
      if (t.at <= now) t.fn();
      else timers.push(t);
    }
  };
  game.join('a', 'Abby');
  game.join('w', 'Winnie');
  const study = (action, extra = {}) => game.act('a', { action, ...extra });
  const workshop = (action, extra = {}) => game.act('w', { action, ...extra });
  return { game, study, workshop, advance, toasts, fx, puzzle };
}

function solveTo(stage, ctx) {
  const { game, study, workshop, advance, puzzle } = ctx;
  for (const c of puzzle.sequence) workshop('panel', { color: c });
  if (stage === 'safe') return;
  for (let i = 0; i < 3; i++) while (game.safe.dials[i] !== puzzle.safeTarget[i]) study('dial', { index: i });
  if (stage === 'gear') return;
  study('gear');
  study('tube');
  advance(2000);
  workshop('tube');
  workshop('clock');
  if (stage === 'clock') return;
  while (game.clock.h !== puzzle.clockTarget.h) workshop('hour');
  while (game.clock.m !== puzzle.clockTarget.m) workshop('minute');
}

test('first two players are seated in the two rooms, the rest spectate', () => {
  const { game } = setup();
  game.join('s', 'Sam');
  assert.equal(game.players.get('a').role, 'study');
  assert.equal(game.players.get('w').role, 'workshop');
  assert.equal(game.players.get('s').role, 'spectator');
});

test('a reconnecting player gets their room back', () => {
  const { game } = setup();
  game.leave('w');
  game.join('w', 'Winnie');
  assert.equal(game.players.get('w').role, 'workshop');
});

test('cannot take a room someone else is in', () => {
  const ctx = setup();
  ctx.game.join('s', 'Sam');
  ctx.game.pickRole('s', 'study');
  assert.equal(ctx.game.players.get('s').role, 'spectator');
  assert.match(ctx.toasts.at(-1).text, /Abby/);
});

test('players can swap rooms', () => {
  const { game } = setup();
  game.pickRole('a', 'spectator');
  game.pickRole('w', 'study');
  game.pickRole('a', 'workshop');
  assert.equal(game.players.get('w').role, 'study');
  assert.equal(game.players.get('a').role, 'workshop');
});

test('wrong lamp code resets, right code opens the safe stage', () => {
  const ctx = setup();
  for (const c of ['red', 'red', 'red', 'red', 'red']) ctx.workshop('panel', { color: c });
  assert.equal(ctx.game.stage, 'lamps');
  assert.deepEqual(ctx.game.lamp.input, []);
  assert.ok(ctx.fx.includes('buzz'));
  solveTo('safe', ctx);
  assert.equal(ctx.game.stage, 'safe');
});

test('the study cannot press the workshop panel', () => {
  const ctx = setup();
  ctx.study('panel', { color: 'red' });
  assert.deepEqual(ctx.game.lamp.input, []);
});

test('safe dials are jammed until the lamp code is solved', () => {
  const ctx = setup();
  ctx.study('dial', { index: 0 });
  assert.deepEqual(ctx.game.safe.dials, [0, 0, 0]);
  solveTo('safe', ctx);
  ctx.study('dial', { index: 0 });
  assert.deepEqual(ctx.game.safe.dials, [1, 0, 0]);
});

test('the gear travels study -> tube -> workshop -> clock', () => {
  const ctx = setup();
  solveTo('gear', ctx);
  assert.equal(ctx.game.safe.open, true);
  ctx.study('gear');
  assert.equal(ctx.game.gear, 'study-hand');
  ctx.study('tube');
  assert.equal(ctx.game.gear, 'tube');
  ctx.advance(500);
  assert.equal(ctx.game.gear, 'tube');
  ctx.advance(1000);
  assert.equal(ctx.game.gear, 'workshop-tube');
  ctx.workshop('gear');
  assert.equal(ctx.game.gear, 'workshop-hand');
  ctx.workshop('clock');
  assert.equal(ctx.game.gear, 'clock');
  assert.equal(ctx.game.stage, 'clock');
});

test('the gear can be sent back to the study', () => {
  const ctx = setup();
  solveTo('gear', ctx);
  ctx.study('gear');
  ctx.study('tube');
  ctx.advance(2000);
  ctx.workshop('tube');
  ctx.workshop('tube');
  ctx.advance(2000);
  assert.equal(ctx.game.gear, 'study-tube');
});

test('setting the clock unlocks the levers', () => {
  const ctx = setup();
  solveTo('clock', ctx);
  ctx.study('lever');
  assert.equal(ctx.game.stage, 'clock');
  while (ctx.game.clock.h !== 3) ctx.workshop('hour');
  while (ctx.game.clock.m !== 45) ctx.workshop('minute');
  assert.equal(ctx.game.stage, 'levers');
});

test('levers pulled too far apart spring back; together they win', () => {
  const ctx = setup();
  solveTo('levers', ctx);
  ctx.study('lever');
  ctx.advance(LEVER_WINDOW_MS + 100);
  assert.equal(ctx.game.levers.study, 0);
  ctx.workshop('lever');
  assert.equal(ctx.game.stage, 'levers');
  ctx.advance(LEVER_WINDOW_MS + 100);

  ctx.study('lever');
  ctx.advance(400);
  ctx.workshop('lever');
  assert.equal(ctx.game.stage, 'won');
  assert.ok(ctx.game.finishedAt > ctx.game.startedAt);
});

test('restart deals a fresh case but keeps everyone seated', () => {
  const ctx = setup();
  solveTo('levers', ctx);
  ctx.study('restart');
  assert.equal(ctx.game.stage, 'lamps');
  assert.equal(ctx.game.gear, 'safe');
  assert.equal(ctx.game.players.get('w').role, 'workshop');
});

test('random puzzles are always valid', () => {
  for (let i = 0; i < 500; i++) {
    const p = newPuzzle();
    assert.equal(p.sequence.length, 5);
    for (let j = 1; j < p.sequence.length; j++) assert.notEqual(p.sequence[j], p.sequence[j - 1]);
    assert.equal(new Set(p.safeTarget).size, 3);
    assert.ok(!p.dials.every((d, k) => d === p.safeTarget[k]));
    assert.ok(p.clockTarget.h >= 1 && p.clockTarget.h <= 12);
    assert.ok(!(p.clockTarget.h === 12 && p.clockTarget.m === 0));
  }
});
