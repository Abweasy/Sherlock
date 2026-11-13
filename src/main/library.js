'use strict';

/**
 * Scans the wallpaper folder and turns its contents into a list of wallpaper items.
 *
 * Recognised layouts (anything inside the library folder, up to MAX_DEPTH levels deep):
 *
 *   my-wallpaper/project.json   -> Wallpaper-Engine-style project folder. `type` and `file`
 *                                  decide what is shown; `preview` is used as the thumbnail.
 *   my-site/index.html          -> web wallpaper (folder without project.json)
 *   clip.mp4 / art.png / x.html -> a loose file is a wallpaper on its own
 *
 * This module has no Electron dependency so it can be unit-tested with plain Node.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VIDEO_EXT = new Set(['.mp4', '.webm', '.m4v', '.mov', '.mkv', '.ogv']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp', '.svg']);
const WEB_EXT = new Set(['.html', '.htm']);
const PREVIEW_NAMES = ['preview.gif', 'preview.jpg', 'preview.jpeg', 'preview.png', 'preview.webp'];
const MAX_DEPTH = 4;

function kindForFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (VIDEO_EXT.has(ext)) return 'video';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (WEB_EXT.has(ext)) return 'web';
  return null;
}

function makeId(relPath) {
  // Hex only, so it is a valid hostname for the wallpaper:// protocol.
  return crypto.createHash('sha1').update(relPath.split(path.sep).join('/')).digest('hex').slice(0, 16);
}

function prettyTitle(name) {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || name;
}

function readJson(file) {
  try {
    // Wallpaper Engine files sometimes carry a UTF-8 BOM.
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

/** Wallpaper Engine stores user properties as { key: { value, type, text, ... } }. */
function extractProperties(project) {
  const props = project && project.general && project.general.properties;
  if (!props || typeof props !== 'object') return {};
  const out = {};
  for (const [key, def] of Object.entries(props)) {
    if (def && typeof def === 'object' && 'value' in def) out[key] = { value: def.value };
  }
  return out;
}

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

/** Is `child` inside (or equal to) `root`? Both must be absolute. */
function isInside(root, child) {
  const rel = path.relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function projectItem(libraryRoot, dir, project) {
  const rel = path.relative(libraryRoot, dir);
  const declaredType = String(project.type || '').toLowerCase();
  const entry = typeof project.file === 'string' ? project.file : null;
  const entryAbs = entry ? path.resolve(dir, entry) : null;

  let kind = null;
  let unsupported = null;
  if (declaredType === 'video') kind = 'video';
  else if (declaredType === 'web') kind = 'web';
  else if (declaredType === 'image') kind = 'image';
  else if (declaredType === 'scene') unsupported = 'Wallpaper Engine "scene" wallpapers use a proprietary format';
  else if (declaredType === 'application') unsupported = 'Application wallpapers (.exe) are not supported';
  else if (entry) kind = kindForFile(entry);

  if (!unsupported && (!entryAbs || !isInside(dir, entryAbs) || !safeStat(entryAbs))) {
    unsupported = entry ? `Entry file "${entry}" is missing` : 'project.json has no "file"';
  }
  if (!unsupported && !kind) unsupported = `Unknown wallpaper type "${project.type}"`;

  let preview = typeof project.preview === 'string' ? project.preview : null;
  if (preview && !safeStat(path.resolve(dir, preview))) preview = null;
  if (!preview) preview = PREVIEW_NAMES.find((n) => safeStat(path.join(dir, n))) || null;

  return {
    id: makeId(rel),
    title: typeof project.title === 'string' && project.title.trim() ? project.title.trim() : prettyTitle(path.basename(dir)),
    kind: kind || declaredType || 'unknown',
    root: dir,
    entry: entry ? entry.split(path.sep).join('/') : null,
    preview,
    relPath: rel,
    source: 'project',
    properties: extractProperties(project),
    unsupported,
    mtimeMs: (safeStat(entryAbs || dir) || { mtimeMs: 0 }).mtimeMs,
  };
}

function webFolderItem(libraryRoot, dir) {
  const rel = path.relative(libraryRoot, dir);
  const entry = fs.existsSync(path.join(dir, 'index.html')) ? 'index.html' : 'index.htm';
  return {
    id: makeId(rel),
    title: prettyTitle(path.basename(dir)),
    kind: 'web',
    root: dir,
    entry,
    preview: PREVIEW_NAMES.find((n) => safeStat(path.join(dir, n))) || null,
    relPath: rel,
    source: 'folder',
    properties: {},
    unsupported: null,
    mtimeMs: (safeStat(path.join(dir, entry)) || { mtimeMs: 0 }).mtimeMs,
  };
}

function fileItem(libraryRoot, file, kind, stat) {
  const rel = path.relative(libraryRoot, file);
  return {
    id: makeId(rel),
    title: prettyTitle(path.basename(file)),
    kind,
    root: path.dirname(file),
    entry: path.basename(file),
    // Loose images are their own preview; videos get a generated thumbnail.
    preview: kind === 'image' ? path.basename(file) : null,
    relPath: rel,
    source: 'file',
    properties: {},
    unsupported: null,
    mtimeMs: stat.mtimeMs,
  };
}

/**
 * Walk the library folder and return all wallpapers found, sorted by title.
 * Never throws for unreadable entries; they are skipped.
 */
function scanLibrary(libraryRoot) {
  const root = path.resolve(libraryRoot);
  const items = [];
  if (!safeStat(root)) return items;

  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const names = new Set(entries.map((e) => e.name.toLowerCase()));

    if (dir !== root) {
      if (names.has('project.json')) {
        const project = readJson(path.join(dir, 'project.json'));
        if (project) {
          items.push(projectItem(root, dir, project));
          return; // a project folder is a single wallpaper; don't list its assets
        }
      } else if (names.has('index.html') || names.has('index.htm')) {
        items.push(webFolderItem(root, dir));
        return;
      }
    }

    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH) walk(full, depth + 1);
      } else if (e.isFile()) {
        const lower = e.name.toLowerCase();
        if (PREVIEW_NAMES.includes(lower)) continue;
        const kind = kindForFile(e.name);
        const stat = kind && safeStat(full);
        if (stat) items.push(fileItem(root, full, kind, stat));
      }
    }
  };

  walk(root, 0);
  items.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
  return items;
}

/** Resolve a URL path inside an item to an absolute file path, refusing anything outside its root. */
function resolveItemFile(item, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const rel = decoded.replace(/^\/+/, '');
  if (!rel) return null;
  const abs = path.resolve(item.root, rel);
  return isInside(item.root, abs) ? abs : null;
}

module.exports = { scanLibrary, resolveItemFile, kindForFile, makeId, isInside, VIDEO_EXT, IMAGE_EXT };
