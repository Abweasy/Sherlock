'use strict';

/* Renders one wallpaper (video / image / web page) filling the window. */

let current = null; // { el, kind }
let settings = { fit: 'cover', volume: 0, playbackRate: 1 };
let paused = false;

function applySettings(el) {
  if (!el) return;
  if (el.tagName === 'VIDEO' || el.tagName === 'IMG') {
    el.className = `layer fit-${settings.fit}` + (el.classList.contains('visible') ? ' visible' : '');
  }
  if (el.tagName === 'VIDEO') {
    el.volume = Math.max(0, Math.min(1, Number(settings.volume) || 0));
    el.muted = el.volume === 0;
    el.playbackRate = Number(settings.playbackRate) || 1;
  }
}

function applyPlayback() {
  if (!current || current.el.tagName !== 'VIDEO') return;
  if (paused) current.el.pause();
  else current.el.play().catch(() => {});
}

function createElement(kind, url) {
  let el;
  if (kind === 'video') {
    el = document.createElement('video');
    el.loop = true;
    el.muted = true;
    el.autoplay = true;
    el.playsInline = true;
    el.disablePictureInPicture = true;
    el.preload = 'auto';
    el.src = url;
  } else if (kind === 'image') {
    el = document.createElement('img');
    el.decoding = 'async';
    el.src = url;
  } else {
    el = document.createElement('iframe');
    // Own origin (wallpaper://<id>), no top navigation, no popups.
    el.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    el.setAttribute('allow', 'autoplay');
    el.src = url;
  }
  el.className = 'layer';
  return el;
}

function readyEvent(el) {
  if (el.tagName === 'VIDEO') return 'loadeddata';
  return 'load';
}

function show(msg) {
  settings = { ...settings, fit: msg.fit, volume: msg.volume, playbackRate: msg.playbackRate };
  const el = createElement(msg.kind, msg.url);
  applySettings(el);
  const previous = current;
  current = { el, kind: msg.kind };

  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    el.classList.add('visible');
    applyPlayback();
    if (previous) setTimeout(() => previous.el.remove(), 700); // crossfade
  };
  el.addEventListener(readyEvent(el), reveal, { once: true });
  el.addEventListener('error', reveal, { once: true });
  setTimeout(reveal, 4000); // never leave the old wallpaper up forever
  document.body.appendChild(el);
}

window.wallpaperHost.onLoad(show);
window.wallpaperHost.onSettings((s) => {
  settings = { ...settings, ...s };
  if (current) applySettings(current.el);
  applyPlayback();
});
window.wallpaperHost.onPlayback((p) => {
  paused = Boolean(p.paused);
  applyPlayback();
});

// Keep the desktop from ever showing a context menu / selection from our window.
window.addEventListener('contextmenu', (e) => e.preventDefault());
