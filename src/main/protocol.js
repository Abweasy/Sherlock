'use strict';

/**
 * The `wallpaper://` protocol serves files out of the library folder.
 *
 *   wallpaper://<itemId>/<path inside the wallpaper>   -> file from that wallpaper's folder
 *   wallpaper://thumb/<itemId>.jpg                     -> cached generated thumbnail
 *
 * Every wallpaper gets its own origin (its id is the host), so web wallpapers are isolated
 * from each other and from the app UI. Range requests are supported so videos can seek/loop.
 */

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { protocol } = require('electron');
const { resolveItemFile } = require('./library');

const SCHEME = 'wallpaper';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.glsl': 'text/plain; charset=utf-8',
  '.frag': 'text/plain; charset=utf-8',
  '.vert': 'text/plain; charset=utf-8',
};

function registerSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ]);
}

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function baseHeaders(file) {
  return {
    'Content-Type': mimeFor(file),
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
}

/** Script injected into web wallpapers for Wallpaper Engine compatibility. */
function compatScript(item) {
  const props = JSON.stringify(item.properties || {}).replace(/</g, '\\u003c');
  return `<script>(function(){
  var noop = function(){};
  window.wallpaperRegisterAudioListener = window.wallpaperRegisterAudioListener || noop;
  window.wallpaperRegisterMediaStatusListener = window.wallpaperRegisterMediaStatusListener || noop;
  window.wallpaperRegisterMediaPropertiesListener = window.wallpaperRegisterMediaPropertiesListener || noop;
  window.wallpaperRegisterMediaThumbnailListener = window.wallpaperRegisterMediaThumbnailListener || noop;
  window.wallpaperRegisterMediaPlaybackListener = window.wallpaperRegisterMediaPlaybackListener || noop;
  window.wallpaperRegisterMediaTimelineListener = window.wallpaperRegisterMediaTimelineListener || noop;
  window.addEventListener('load', function(){
    var l = window.wallpaperPropertyListener;
    try { if (l && l.applyGeneralProperties) l.applyGeneralProperties({ fps: 60 }); } catch (e) { console.error(e); }
    try { if (l && l.applyUserProperties) l.applyUserProperties(${props}); } catch (e) { console.error(e); }
    try { if (l && l.setPaused) l.setPaused(false); } catch (e) { console.error(e); }
  });
})();</script>`;
}

function injectCompat(html, item) {
  const script = compatScript(item);
  const m = /<head[^>]*>/i.exec(html);
  if (m) return html.slice(0, m.index + m[0].length) + script + html.slice(m.index + m[0].length);
  return script + html;
}

function notFound() {
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
}

async function serveFile(file, request, item) {
  let stat;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return notFound();
  }
  if (!stat.isFile()) return notFound();

  // Entry page of a web wallpaper: inject the compatibility shim.
  if (item && item.kind === 'web' && path.resolve(item.root, item.entry || '') === file) {
    const html = await fs.promises.readFile(file, 'utf8');
    return new Response(injectCompat(html, item), { status: 200, headers: baseHeaders(file) });
  }

  const headers = baseHeaders(file);
  const range = request.headers.get('range');
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m && (m[1] !== '' || m[2] !== '')) {
    let start;
    let end;
    if (m[1] === '') {
      // suffix range: last N bytes
      start = Math.max(0, stat.size - Number(m[2]));
      end = stat.size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === '' ? stat.size - 1 : Math.min(Number(m[2]), stat.size - 1);
    }
    if (start >= stat.size || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${stat.size}` } });
    }
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end }));
    return new Response(stream, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) },
    });
  }

  const stream = Readable.toWeb(fs.createReadStream(file));
  return new Response(stream, { status: 200, headers: { ...headers, 'Content-Length': String(stat.size) } });
}

/**
 * @param {object} opts
 * @param {(id: string) => object|undefined} opts.getItem
 * @param {string} opts.thumbDir
 */
function registerProtocol({ getItem, thumbDir }) {
  protocol.handle(SCHEME, async (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return notFound();
    }
    const host = url.hostname.toLowerCase();

    if (host === 'thumb') {
      const name = path.basename(decodeURIComponent(url.pathname));
      if (!/^[0-9a-f]{16}\.jpg$/.test(name)) return notFound();
      return serveFile(path.join(thumbDir, name), request, null);
    }

    const item = getItem(host);
    if (!item) return notFound();
    const file = resolveItemFile(item, url.pathname);
    if (!file) return notFound();
    return serveFile(file, request, item);
  });
}

function itemUrl(item, rel) {
  const p = String(rel || item.entry || '')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  return `${SCHEME}://${item.id}/${p}`;
}

module.exports = { registerSchemePrivileges, registerProtocol, itemUrl, injectCompat, SCHEME };
