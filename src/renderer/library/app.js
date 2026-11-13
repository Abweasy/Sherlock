'use strict';

/* Library window: browse the wallpaper folder, apply wallpapers, tweak settings. */

const api = window.livedesk;
const $ = (id) => document.getElementById(id);

let state = null;
let filter = 'all';
let query = '';
let target = ''; // '' = all displays, otherwise a display id

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

const KIND_ICON = { video: '▶', web: '⌘', image: '▣', unknown: '?' };

function activeIds() {
  const ids = new Map(); // itemId -> [display labels]
  for (const d of state.displays) {
    if (!d.itemId) continue;
    if (!ids.has(d.itemId)) ids.set(d.itemId, []);
    ids.get(d.itemId).push(d.label);
  }
  return ids;
}

function visibleItems() {
  const q = query.trim().toLowerCase();
  return state.items.filter((i) => {
    if (filter === 'favorites' && !i.favorite) return false;
    if (['video', 'web', 'image'].includes(filter) && i.kind !== filter) return false;
    if (q && !i.title.toLowerCase().includes(q) && !i.relPath.toLowerCase().includes(q)) return false;
    return true;
  });
}

function card(item, active) {
  const glyph = el('span', { class: 'glyph' }, KIND_ICON[item.kind] || '?');
  const thumb = el('div', { class: 'thumb' }, glyph);
  if (item.thumbUrl) {
    const img = el('img', { src: item.thumbUrl, alt: '', loading: 'lazy', draggable: 'false' });
    img.addEventListener('load', () => glyph.remove(), { once: true });
    thumb.append(img);
  }

  if (active.has(item.id)) {
    const where = state.displays.length > 1 ? ` · ${active.get(item.id).join(', ')}` : '';
    thumb.append(el('span', { class: 'live' }, `● Live${where}`));
  }
  if (item.unsupported) thumb.append(el('span', { class: 'warn' }, item.unsupported));

  // Hover preview for videos, Wallpaper-Engine style.
  if (item.kind === 'video' && item.url) {
    let video = null;
    let hoverTimer = null;
    thumb.addEventListener('mouseenter', () => {
      hoverTimer = setTimeout(() => {
        video = el('video', { src: item.url, muted: true, loop: true, playsinline: true });
        video.muted = true;
        video.addEventListener('playing', () => video && video.classList.add('playing'), { once: true });
        thumb.append(video);
        video.play().catch(() => {});
      }, 350);
    });
    thumb.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimer);
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
        video = null;
      }
    });
  }

  const star = el(
    'button',
    {
      class: `star${item.favorite ? ' on' : ''}`,
      title: item.favorite ? 'Remove from favorites' : 'Add to favorites',
      onclick: (e) => {
        e.stopPropagation();
        api.setFavorite(item.id, !item.favorite);
      },
    },
    item.favorite ? '★' : '☆'
  );

  const node = el(
    'article',
    {
      class: `card${active.has(item.id) ? ' active' : ''}${item.unsupported ? ' unsupported' : ''}`,
      title: `${item.title}\n${item.relPath}\n\nClick to apply · Right-click to show in folder`,
      onclick: () => {
        if (item.unsupported) return toast(item.unsupported);
        api.apply(item.id, target || null).then(() => toast(`Applied “${item.title}”`));
      },
      oncontextmenu: (e) => {
        e.preventDefault();
        api.reveal(item.id);
      },
    },
    thumb,
    el('div', { class: 'meta' }, el('span', { class: 'title' }, item.title), el('span', { class: `badge ${item.kind}` }, item.kind), star)
  );
  return node;
}

function renderGrid() {
  const grid = $('grid');
  const list = visibleItems();
  const active = activeIds();
  grid.replaceChildren(...list.map((i) => card(i, active)));

  const libraryEmpty = state.items.length === 0;
  $('empty').classList.toggle('hidden', !libraryEmpty);
  grid.classList.toggle('hidden', libraryEmpty);
  $('empty-path').textContent = state.libraryPath;

  const shown = list.length === state.items.length ? `${list.length}` : `${list.length} of ${state.items.length}`;
  $('status-count').textContent = `${shown} wallpaper${state.items.length === 1 ? '' : 's'}`;
}

function renderDisplays() {
  const sel = $('display-target');
  const opts = [el('option', { value: '' }, state.displays.length > 1 ? 'All displays' : 'Desktop')];
  state.displays.forEach((d, i) => {
    opts.push(el('option', { value: d.id }, `${i + 1}: ${d.label}${d.primary ? ' (main)' : ''} — ${d.width}×${d.height}`));
  });
  sel.replaceChildren(...opts);
  if (!state.displays.some((d) => d.id === target)) target = '';
  sel.value = target;
  sel.parentElement.classList.toggle('hidden', state.displays.length < 2);
}

function renderPlayback() {
  const p = state.playback;
  const btn = $('btn-pause');
  btn.textContent = p.manualPaused ? '▶' : '❚❚';
  btn.classList.toggle('on', p.manualPaused);
  btn.title = p.manualPaused ? 'Resume wallpapers' : 'Pause wallpapers';
  const s = $('status-playback');
  s.classList.toggle('paused', p.paused);
  s.textContent = p.paused ? (p.manualPaused ? '❚❚ Paused' : `❚❚ Auto-paused (${p.autoPauseReason})`) : '● Playing';
  $('status-folder').textContent = state.libraryPath;
}

function renderSettings() {
  const s = state.settings;
  $('set-path').textContent = state.libraryPath;
  $('set-fit').value = s.fit;
  $('set-volume').value = s.volume;
  $('set-volume-val').textContent = s.volume > 0 ? `${Math.round(s.volume * 100)}%` : 'muted';
  $('set-rate').value = s.playbackRate;
  $('set-rate-val').textContent = `${s.playbackRate}×`;
  $('set-shuffle').value = String(s.shuffleMinutes);
  $('set-fullscreen').checked = s.pauseOnFullscreen;
  $('set-battery').checked = s.pauseOnBattery;
  $('set-login').checked = s.launchAtLogin;
  $('set-login').disabled = state.platform === 'linux';
  $('desktop-mode').textContent = `Desktop integration: ${state.playback.desktopMode}`;
}

function render() {
  if (!state) return;
  renderDisplays();
  renderGrid();
  renderPlayback();
  renderSettings();
  queueThumbnails();
}

// ---------------------------------------------------------------------------
// Video thumbnails: grab a frame in the renderer and hand it to the main process
// ---------------------------------------------------------------------------

const thumbQueue = [];
const thumbTried = new Set();
let thumbBusy = false;

function queueThumbnails() {
  for (const i of state.items) {
    if (i.kind === 'video' && !i.thumbUrl && i.url && !thumbTried.has(i.id)) {
      thumbTried.add(i.id);
      thumbQueue.push(i);
    }
  }
  pumpThumbs();
}

function pumpThumbs() {
  if (thumbBusy || !thumbQueue.length) return;
  thumbBusy = true;
  const item = thumbQueue.shift();
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';

  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    video.removeAttribute('src');
    video.load();
    thumbBusy = false;
    setTimeout(pumpThumbs, 50);
  };
  const timeout = setTimeout(done, 15000);

  video.addEventListener('loadedmetadata', () => {
    const t = Number.isFinite(video.duration) ? Math.min(2, video.duration * 0.25) : 0;
    video.currentTime = t;
  });
  video.addEventListener('seeked', async () => {
    try {
      const w = 480;
      const h = 270;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      // cover-crop the frame to 16:9
      const vr = video.videoWidth / video.videoHeight;
      let sw = video.videoWidth;
      let sh = video.videoHeight;
      if (vr > w / h) sw = sh * (w / h);
      else sh = sw / (w / h);
      ctx.drawImage(video, (video.videoWidth - sw) / 2, (video.videoHeight - sh) / 2, sw, sh, 0, 0, w, h);
      const url = await api.saveThumb(item.id, canvas.toDataURL('image/jpeg', 0.82));
      if (url) {
        const it = state.items.find((x) => x.id === item.id);
        if (it) it.thumbUrl = url;
        renderGrid();
      }
    } catch (err) {
      console.warn('thumbnail failed', item.title, err);
    }
    done();
  }, { once: true });
  video.addEventListener('error', done, { once: true });
  video.src = item.url;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

$('search').addEventListener('input', (e) => {
  query = e.target.value;
  renderGrid();
});

$('filters').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-filter]');
  if (!b) return;
  filter = b.dataset.filter;
  for (const x of $('filters').querySelectorAll('button')) x.classList.toggle('active', x === b);
  renderGrid();
});

$('display-target').addEventListener('change', (e) => (target = e.target.value));
$('btn-pause').addEventListener('click', () => api.setPaused(!state.playback.manualPaused));
$('btn-next').addEventListener('click', () => api.next());
$('btn-settings').addEventListener('click', () => $('settings').classList.toggle('hidden'));
$('settings-close').addEventListener('click', () => $('settings').classList.add('hidden'));
$('status-folder').addEventListener('click', () => api.openFolder());
$('empty-open').addEventListener('click', () => api.openFolder());
$('empty-change').addEventListener('click', () => api.chooseFolder());
$('set-change').addEventListener('click', () => api.chooseFolder());
$('set-open').addEventListener('click', () => api.openFolder());
$('set-rescan').addEventListener('click', () => api.rescan().then(() => toast('Library rescanned')));

$('set-fit').addEventListener('change', (e) => api.updateSettings({ fit: e.target.value }));
$('set-volume').addEventListener('input', (e) => api.updateSettings({ volume: Number(e.target.value) }));
$('set-rate').addEventListener('input', (e) => api.updateSettings({ playbackRate: Number(e.target.value) }));
$('set-shuffle').addEventListener('change', (e) => api.updateSettings({ shuffleMinutes: Number(e.target.value) }));
$('set-fullscreen').addEventListener('change', (e) => api.updateSettings({ pauseOnFullscreen: e.target.checked }));
$('set-battery').addEventListener('change', (e) => api.updateSettings({ pauseOnBattery: e.target.checked }));
$('set-login').addEventListener('change', (e) => api.updateSettings({ launchAtLogin: e.target.checked }));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('settings').classList.add('hidden');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    $('search').focus();
  }
});

// Drag & drop import
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
  dragDepth++;
  $('drop').classList.remove('hidden');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('drop').classList.add('hidden');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('drop').classList.add('hidden');
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  toast('Copying into your wallpaper folder…');
  const n = await api.importFiles(files);
  toast(n ? `Added ${n} item${n === 1 ? '' : 's'}` : 'Nothing was added');
});

api.onState((s) => {
  state = s;
  render();
});
api.getState().then((s) => {
  state = s;
  render();
});
