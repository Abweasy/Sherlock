// Keyboard, swipe and d-pad input. Calls onDir(dir) with 0..3 (up/right/down/left).

const KEYS = {
  ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3,
};

export class Input {
  constructor(target, dpad) {
    this.onDir = () => {};
    this.onPause = () => {};
    this.enabled = false;

    addEventListener('keydown', (e) => {
      if (e.code in KEYS && this.enabled) { e.preventDefault(); this.onDir(KEYS[e.code]); }
      if ((e.code === 'Escape' || e.code === 'KeyP') && this.enabled) this.onPause();
    });

    // Swipe: a direction fires as soon as the finger moves far enough, and the
    // origin resets so you can chain several turns in one continuous swipe.
    let sx = 0, sy = 0, active = false;
    const TH = 14;
    target.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      sx = t.clientX; sy = t.clientY; active = true;
    }, { passive: true });
    target.addEventListener('touchmove', (e) => {
      if (!active || !this.enabled) return;
      e.preventDefault();
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < TH) return;
      this.onDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
      sx = t.clientX; sy = t.clientY;
    }, { passive: false });
    target.addEventListener('touchend', () => { active = false; }, { passive: true });

    // Mouse drag for desktop testing
    let md = false;
    target.addEventListener('mousedown', (e) => { md = true; sx = e.clientX; sy = e.clientY; });
    addEventListener('mouseup', () => { md = false; });
    target.addEventListener('mousemove', (e) => {
      if (!md || !this.enabled) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < TH) return;
      this.onDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
      sx = e.clientX; sy = e.clientY;
    });

    if (dpad) {
      for (const b of dpad.querySelectorAll('[data-dir]')) {
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          if (this.enabled) this.onDir(Number(b.dataset.dir));
        });
      }
    }
  }
}
