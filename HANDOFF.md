# Sherlock Media Player: project handoff

Everything a new chat needs to pick this project up. Last updated 2026-11-13.

## Start a new chat with this

Copy and paste this as the first message of the new chat:

> I'm continuing work on **Sherlock**, a media player app in the GitHub repo
> `Abweasy/Sherlock`. All the work is on the branch **`ccr-4731805b-durpkn`**
> (not the default `test` branch), so check out that branch first. Read
> `HANDOFF.md` in the repo root: it explains what's built, how it's organised,
> how to run, test and build it, and what's left to do. Then
> [say what you want to do next].

## Where things are

| What | Where |
| --- | --- |
| Code | GitHub `Abweasy/Sherlock`, branch **`ccr-4731805b-durpkn`** |
| Default branch | `test`, which does **not** have this work yet (no pull request has been opened) |
| Commits | `c807d60` Add browser-based media player · `19aeb50` Package the player as a Windows desktop app with Electron |
| Windows app | `Sherlock-Windows.zip` (158 MB) was sent in the previous chat; rebuild any time with `npm run build:win` |
| Source zip | `Sherlock-media-player.zip` was sent in the previous chat (web version only, no Electron files) |

To get the code on a computer:

```sh
git clone -b ccr-4731805b-durpkn https://github.com/Abweasy/Sherlock.git
```

## What Sherlock is

A media player for **local audio and video files**. It runs two ways:

1. **In a browser:** open `index.html`. No build step, no dependencies.
2. **As a Windows desktop app:** the same page wrapped in Electron, built into a
   self-contained folder with `Sherlock.exe`.

Files never leave the user's computer: they're played from `blob:` URLs made
from the files the user picks or drops.

### Features

- Add files with the **Add files** button or by **dragging and dropping** them onto the window; unsupported files are skipped with a message
- **Playlist:** track durations, click to play, drag to reorder, remove, clear
- Play/pause, previous/next, seek bar, volume, mute, **speed** 0.5×–2×
- **Shuffle** and **repeat** (off / all / one)
- Audio tracks show a cover card and a **spectrum visualizer** (Web Audio API); WebM files with no video track are shown as audio
- Video: click to play/pause, double-click or `F` for fullscreen, **picture-in-picture**
- **Keyboard shortcuts** (press `?` in the app): Space/K play-pause, ←/→ seek 5 s, J/L seek 10 s, ↑/↓ volume, N/P next/previous, M mute, F fullscreen, S shuffle, R repeat, 0–9 jump to 0–90%
- OS media keys and lock-screen controls (Media Session API)
- Remembers volume, mute, speed, shuffle and repeat in `localStorage` (key `sherlock.settings`)
- Responsive layout down to phone width
- "Previous" restarts the track if more than 3 s in; repeat-one only replays when a track ends on its own (manual Next still advances)

## How the code is organised

```
index.html          Page markup (all controls, playlist, help dialog)
css/styles.css      Dark theme, layout, responsive rules (≤800px stacks vertically)
js/playlist.js      Playlist + play-order logic. No DOM. Works in browser and Node.
js/app.js           UI wiring: media element, controls, rendering, visualizer,
                    drag & drop, keyboard shortcuts, Media Session, settings
electron/main.js    Electron desktop wrapper
build/icon.svg      App icon source (gradient rounded square + play triangle)
build/icon.png      256px icon (Electron window icon)
build/icon.ico      Multi-size Windows icon (16–256px), embedded in Sherlock.exe
build/make-icons.js Regenerates icon.png / icon.ico from icon.svg (uses Playwright)
tests/playlist.test.js  14 unit tests for js/playlist.js (node:test)
tests/e2e.js        End-to-end test in headless Chromium with generated WAV files
package.json        Scripts and dev dependencies (electron, @electron/packager)
README.md           User-facing readme
```

### Key design decisions

- **Plain HTML/CSS/JS with classic `<script>` tags** (not ES modules), so
  `index.html` works when double-clicked from disk: browsers block module
  scripts over `file://`.
- **One `<video>` element plays both audio and video.** For audio, the video
  surface is hidden and the cover card + visualizer canvas are shown.
- **`Playlist` keeps two lists:** `items` (display order, user can reorder) and
  `order` (play order of item ids: same as `items`, or a random permutation
  when shuffle is on). Shuffle keeps the current track first; tracks added
  while shuffling are scattered after the current position; when shuffle +
  repeat-all wraps, it reshuffles without replaying the last track first.
  `getNext({ auto })` / `getPrevious()` return the item to play and the caller
  calls `select(id)`. Note: `getNext` can reshuffle when wrapping.
- **The Web Audio graph is created on first play** (browser autoplay rules) and
  is permanent for the media element. Media from another origin would play
  silently through it, which is why there's no "open URL" feature yet, and why
  the desktop app doesn't open files passed on the command line (`file://`
  media is a different origin from the page).
- `window.sherlock = { playlist, media, addFiles }` is exposed for debugging and tests.
- **Electron window:** 1200×760, no menu bar (the player has its own controls),
  single instance (launching again focuses the open window), navigation away
  from the page is blocked, `https` links open in the browser, sandboxed with
  context isolation and no Node in the page.
- `productName` is `Sherlock`, so on Windows the app's data lives in
  `%APPDATA%\Sherlock`.

## Commands

```sh
npm install          # dev dependencies (Electron, packager)
npm start            # serve the web version: python3 -m http.server 8000
npm run app          # run the desktop app from source
npm test             # 14 playlist unit tests
npm run test:e2e     # end-to-end browser test (needs the `playwright` package)
npm run icons        # rebuild build/icon.png and build/icon.ico from icon.svg
npm run build:win    # build dist/Sherlock-win32-x64/Sherlock.exe
```

Build notes:

- `build:win` uses `@electron/packager`, which embeds the icon and version info
  with the pure-JS `resedit` library, so it works on Linux/macOS **without Wine**.
- The packaged app bundle (`resources/app.asar`, ~80 KB) contains only the
  player files: tests, `dist/`, `node_modules/`, the icon SVG/ICO and the icon
  script are excluded. The ~358 MB folder size is almost entirely Electron's
  Chromium runtime.
- If `node_modules/electron/dist` is missing after `npm install` (Electron's
  download step didn't run), run `node node_modules/electron/install.js`.
- To ship the Windows build: zip the output folder renamed to `Sherlock`, plus a
  `START-HERE.txt` (the one sent in the previous chat explained: double-click
  `Sherlock.exe`, keep the folder's files together, create a desktop shortcut,
  and get past SmartScreen with "More info" → "Run anyway").

## Testing status

- Unit tests: **14/14 pass**.
- End-to-end browser test: **passes** (ran repeatedly with no flakes). It covers
  adding files and skipping unsupported ones, autoplay, durations, auto-advance
  at the end of a track, Space to pause/resume, Next button, clicking tracks,
  number-key seeking, volume/mute, repeat/shuffle, removing the playing track,
  settings surviving a reload, and Clear.
- Desktop app: run under Electron on **Linux** (virtual display); audio and
  video both played with no console errors.
- **Not yet tested:** `Sherlock.exe` on a real Windows PC. The exe was checked
  to be a valid 64-bit Windows program with the icon and version info embedded,
  but nobody has launched it on Windows yet.

## Known limitations

- The playlist is lost on reload/restart; browsers don't keep access to picked files. Only settings persist.
- In fullscreen only the video is shown (no on-screen controls); use the keyboard, and Esc to exit.
- Supported formats depend on the browser/Chromium; MKV and some MP4 codecs may not play. Such tracks show "Unsupported format".
- The Windows app is **not code-signed**, so SmartScreen warns on first run.
- No installer, Start-menu entry or "Open with Sherlock" file association; it's a portable folder.
- No subtitles, no music metadata/cover art, no streaming URLs.

## Claude Remote Control (not set up yet)

The user wants Claude to be able to work directly in a folder on their Windows
PC (computer name **Abwenje**). From the cloud session, that PC's four shared
folders (none of them this project) showed as *not available* to cloud
sessions. The usual cause on Windows is that the Claude app needs updating. The
feature also isn't available to every account yet.

Steps given to the user:

1. Put the **source code** (not just the built app folder) on the PC, e.g.
   `git clone -b ccr-4731805b-durpkn https://github.com/Abweasy/Sherlock.git`
   into a normal location like `Documents\Sherlock-source` (not a hidden folder).
2. Then either:
   - open the Claude desktop app on the PC and start a session in that folder
     (runs locally, simplest), or
   - add the folder under **Settings → Claude Code → Remote Control** in the
     Claude desktop app so cloud sessions can use it, or
   - run `claude remote-control` in a terminal inside the folder.

## Ideas for next steps

- Test `Sherlock.exe` on the Windows PC and fix anything that comes up
- Open a pull request to merge `ccr-4731805b-durpkn` into `test`
- Subtitles (.srt / .vtt)
- Read artist/album/cover art from music files (ID3 etc.)
- Save playlists between sessions (e.g. File System Access API in the browser,
  or file paths in the desktop app)
- "Open with Sherlock" / file associations and an installer (e.g. electron-builder NSIS)
- Play from a URL (needs handling for cross-origin media and the visualizer)
- On-screen controls in fullscreen
- Installable web app (PWA) version
