'use strict';

/**
 * Platform abstraction for "put this window on the desktop, behind the icons".
 *
 * Windows gets the full WorkerW integration. macOS and Linux (X11) use Electron's built-in
 * `type: 'desktop'` window, which the OS keeps at desktop level.
 */

function generic(name) {
  return {
    name,
    windowOptions: () => ({ type: 'desktop' }),
    attach: () => true,
    isHostAlive: () => true,
    isFullscreenAppRunning: () => false,
    restore: () => {},
    describe: () => `${name} desktop window`,
  };
}

function load() {
  if (process.platform === 'win32') {
    try {
      return require('./win32');
    } catch (err) {
      console.error('Windows desktop integration failed to load; falling back to a normal window.', err);
      return generic('win32-fallback');
    }
  }
  return generic(process.platform);
}

module.exports = load();
