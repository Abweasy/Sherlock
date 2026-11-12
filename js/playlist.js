/*
 * Playlist: pure playback-order logic, no DOM access.
 *
 * Items are plain objects: { id, name, kind: 'audio' | 'video', url, duration }.
 * The playlist keeps two lists:
 *   - `items`: the order shown to the user (can be reordered by drag & drop)
 *   - `order`: the order tracks are actually played in (equal to `items`
 *     unless shuffle is on, in which case it is a random permutation)
 *
 * Works both in the browser (exposes `window.Playlist`) and in Node
 * (`module.exports`), so it can be unit-tested without a browser.
 */
(function (root) {
  'use strict';

  const REPEAT_MODES = ['off', 'all', 'one'];

  let nextId = 1;

  function shuffleInPlace(arr, random) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  class Playlist {
    constructor({ random = Math.random } = {}) {
      this.items = [];
      this.order = [];
      this.currentId = null;
      this.shuffle = false;
      this.repeat = 'off';
      this._random = random;
    }

    get length() {
      return this.items.length;
    }

    get current() {
      return this.getById(this.currentId);
    }

    get currentIndex() {
      return this.indexOf(this.currentId);
    }

    getById(id) {
      return this.items.find((item) => item.id === id) || null;
    }

    indexOf(id) {
      return this.items.findIndex((item) => item.id === id);
    }

    /** Adds items and returns them (with ids assigned). */
    add(newItems) {
      const added = newItems.map((item) => ({
        duration: null,
        ...item,
        id: item.id != null ? item.id : nextId++,
      }));
      this.items.push(...added);

      if (this.shuffle) {
        // Scatter new tracks among the ones that haven't played yet.
        const pos = this.order.indexOf(this.currentId);
        for (const item of added) {
          const start = pos + 1;
          const at = start + Math.floor(this._random() * (this.order.length - start + 1));
          this.order.splice(at, 0, item.id);
        }
      } else {
        this._rebuildOrder();
      }
      return added;
    }

    /**
     * Removes the item at `index` (in display order).
     * Returns the removed item, or null if the index was invalid.
     * If the removed item was playing, `currentId` becomes null.
     */
    remove(index) {
      if (index < 0 || index >= this.items.length) return null;
      const [removed] = this.items.splice(index, 1);
      this.order = this.order.filter((id) => id !== removed.id);
      if (removed.id === this.currentId) this.currentId = null;
      return removed;
    }

    clear() {
      const removed = this.items;
      this.items = [];
      this.order = [];
      this.currentId = null;
      return removed;
    }

    /** Moves an item in display order (drag & drop reordering). */
    move(from, to) {
      if (from === to) return;
      if (from < 0 || from >= this.items.length) return;
      to = Math.max(0, Math.min(this.items.length - 1, to));
      const [item] = this.items.splice(from, 1);
      this.items.splice(to, 0, item);
      if (!this.shuffle) this._rebuildOrder();
    }

    /** Makes the item with `id` current and returns it. */
    select(id) {
      const item = this.getById(id);
      if (item) this.currentId = id;
      return item;
    }

    setShuffle(on) {
      this.shuffle = Boolean(on);
      this._rebuildOrder();
    }

    setRepeat(mode) {
      if (!REPEAT_MODES.includes(mode)) throw new Error(`Unknown repeat mode: ${mode}`);
      this.repeat = mode;
    }

    /** Cycles off -> all -> one -> off and returns the new mode. */
    cycleRepeat() {
      const i = REPEAT_MODES.indexOf(this.repeat);
      this.repeat = REPEAT_MODES[(i + 1) % REPEAT_MODES.length];
      return this.repeat;
    }

    /**
     * Returns the item that should play after the current one, or null if
     * playback should stop. Does not change the current item (call
     * `select()` with the result), but may reshuffle when wrapping around.
     *
     * `auto` is true when called because a track ended (as opposed to the
     * user pressing "next"); only then does repeat-one replay the same track.
     */
    getNext({ auto = false } = {}) {
      if (this.order.length === 0) return null;
      if (auto && this.repeat === 'one' && this.current) return this.current;

      const pos = this.order.indexOf(this.currentId);
      if (pos + 1 < this.order.length) return this.getById(this.order[pos + 1]);

      if (this.repeat === 'all') {
        // Wrap around. With shuffle on, start a fresh random cycle.
        if (this.shuffle) this._rebuildOrder({ avoidFirst: this.currentId });
        return this.getById(this.order[0]);
      }
      return null;
    }

    /** Returns the item that should play before the current one. */
    getPrevious() {
      if (this.order.length === 0) return null;
      const pos = this.order.indexOf(this.currentId);
      if (pos > 0) return this.getById(this.order[pos - 1]);
      if (pos === -1) return this.getById(this.order[0]);
      if (this.repeat === 'all') return this.getById(this.order[this.order.length - 1]);
      return this.current;
    }

    _rebuildOrder({ avoidFirst = null } = {}) {
      const ids = this.items.map((item) => item.id);
      if (!this.shuffle) {
        this.order = ids;
        return;
      }
      shuffleInPlace(ids, this._random);
      if (avoidFirst != null) {
        // New cycle: don't replay the track that just finished.
        if (ids.length > 1 && ids[0] === avoidFirst) {
          ids.push(ids.shift());
        }
      } else if (this.currentId != null) {
        // Keep the playing track first so "next" never repeats it.
        const i = ids.indexOf(this.currentId);
        if (i > 0) ids.unshift(ids.splice(i, 1)[0]);
      }
      this.order = ids;
    }
  }

  Playlist.REPEAT_MODES = REPEAT_MODES;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Playlist };
  } else {
    root.Playlist = Playlist;
  }
})(typeof window !== 'undefined' ? window : globalThis);
