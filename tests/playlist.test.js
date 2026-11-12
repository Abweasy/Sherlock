const test = require('node:test');
const assert = require('node:assert/strict');
const { Playlist } = require('../js/playlist.js');

function makePlaylist(n, opts) {
  const pl = new Playlist(opts);
  pl.add(Array.from({ length: n }, (_, i) => ({ name: `t${i}`, kind: 'audio', url: `u${i}` })));
  return pl;
}

const names = (pl, ids) => ids.map((id) => pl.getById(id).name);

// Deterministic PRNG so shuffle tests are reproducible.
function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

test('add assigns unique ids and keeps insertion order', () => {
  const pl = makePlaylist(3);
  assert.equal(pl.length, 3);
  assert.equal(new Set(pl.items.map((i) => i.id)).size, 3);
  assert.deepEqual(names(pl, pl.order), ['t0', 't1', 't2']);
  assert.equal(pl.current, null);
});

test('getNext walks forward and stops at the end with repeat off', () => {
  const pl = makePlaylist(3);
  pl.select(pl.items[0].id);
  assert.equal(pl.getNext().name, 't1');
  pl.select(pl.items[2].id);
  assert.equal(pl.getNext(), null);
  assert.equal(pl.getNext({ auto: true }), null);
});

test('getNext with no current track starts at the beginning', () => {
  const pl = makePlaylist(3);
  assert.equal(pl.getNext().name, 't0');
});

test('repeat all wraps around in both directions', () => {
  const pl = makePlaylist(3);
  pl.setRepeat('all');
  pl.select(pl.items[2].id);
  assert.equal(pl.getNext({ auto: true }).name, 't0');
  pl.select(pl.items[0].id);
  assert.equal(pl.getPrevious().name, 't2');
});

test('repeat one replays only when the track ends on its own', () => {
  const pl = makePlaylist(3);
  pl.setRepeat('one');
  pl.select(pl.items[1].id);
  assert.equal(pl.getNext({ auto: true }).name, 't1');
  assert.equal(pl.getNext().name, 't2', 'manual next still advances');
});

test('getPrevious at the start stays on the first track', () => {
  const pl = makePlaylist(3);
  pl.select(pl.items[0].id);
  assert.equal(pl.getPrevious().name, 't0');
  pl.select(pl.items[2].id);
  assert.equal(pl.getPrevious().name, 't1');
});

test('cycleRepeat goes off -> all -> one -> off', () => {
  const pl = new Playlist();
  assert.equal(pl.cycleRepeat(), 'all');
  assert.equal(pl.cycleRepeat(), 'one');
  assert.equal(pl.cycleRepeat(), 'off');
  assert.throws(() => pl.setRepeat('bogus'));
});

test('remove drops the item and clears current when it was playing', () => {
  const pl = makePlaylist(3);
  pl.select(pl.items[1].id);
  const removed = pl.remove(1);
  assert.equal(removed.name, 't1');
  assert.equal(pl.currentId, null);
  assert.deepEqual(names(pl, pl.order), ['t0', 't2']);
  assert.equal(pl.remove(10), null);
});

test('move reorders items and play order', () => {
  const pl = makePlaylist(4);
  pl.move(0, 3);
  assert.deepEqual(pl.items.map((i) => i.name), ['t1', 't2', 't3', 't0']);
  assert.deepEqual(names(pl, pl.order), ['t1', 't2', 't3', 't0']);
  pl.move(3, 1);
  assert.deepEqual(pl.items.map((i) => i.name), ['t1', 't0', 't2', 't3']);
});

test('clear empties everything', () => {
  const pl = makePlaylist(3);
  pl.select(pl.items[0].id);
  assert.equal(pl.clear().length, 3);
  assert.equal(pl.length, 0);
  assert.equal(pl.current, null);
  assert.equal(pl.getNext(), null);
  assert.equal(pl.getPrevious(), null);
});

test('shuffle plays every track exactly once, starting after the current one', () => {
  const pl = makePlaylist(10, { random: seeded(42) });
  pl.select(pl.items[4].id);
  pl.setShuffle(true);
  assert.equal(pl.order[0], pl.currentId, 'current track leads the shuffled order');

  const seen = new Set([pl.currentId]);
  let item;
  while ((item = pl.getNext({ auto: true }))) {
    assert.ok(!seen.has(item.id), `track ${item.name} played twice`);
    seen.add(item.id);
    pl.select(item.id);
  }
  assert.equal(seen.size, 10);
});

test('shuffle + repeat all starts a new cycle without repeating the last track', () => {
  const pl = makePlaylist(5, { random: seeded(7) });
  pl.setShuffle(true);
  pl.setRepeat('all');
  for (let i = 0; i < 20; i++) {
    // Jump to the end of the current cycle, then wrap.
    pl.select(pl.order[pl.order.length - 1]);
    const last = pl.currentId;
    const nextItem = pl.getNext({ auto: true });
    assert.notEqual(nextItem.id, last);
    assert.equal(nextItem.id, pl.order[0]);
    assert.equal(pl.order.length, 5);
  }
});

test('turning shuffle off restores display order', () => {
  const pl = makePlaylist(6, { random: seeded(3) });
  pl.setShuffle(true);
  pl.setShuffle(false);
  assert.deepEqual(names(pl, pl.order), ['t0', 't1', 't2', 't3', 't4', 't5']);
});

test('tracks added while shuffling land after the current position', () => {
  const pl = makePlaylist(4, { random: seeded(11) });
  pl.select(pl.items[0].id);
  pl.setShuffle(true);
  pl.select(pl.order[2]);
  const [added] = pl.add([{ name: 'new', kind: 'video', url: 'x' }]);
  assert.ok(pl.order.indexOf(added.id) > pl.order.indexOf(pl.currentId));
  assert.equal(pl.order.length, 5);
});
