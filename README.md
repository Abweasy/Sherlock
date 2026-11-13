# Sherlock Media Player

An audio and video player that runs in your browser or as a Windows desktop app.
Your files never leave your computer.

## Features

- Play local **audio and video** files (MP3, WAV, OGG, FLAC, M4A, MP4, WebM, …: whatever your browser supports)
- **Add files** with the button or by **dragging and dropping** them anywhere on the window
- **Playlist** with track durations, click-to-play, drag-to-reorder and remove
- Play/pause, previous/next, seek bar, volume, mute and **playback speed** (0.5×–2×)
- **Shuffle** and **repeat** (off / all / one)
- **Spectrum visualizer** for audio tracks (Web Audio API)
- **Fullscreen** and **picture-in-picture** for video
- **Keyboard shortcuts** (press `?` in the app to see them)
- OS media keys and lock-screen controls via the Media Session API
- Remembers volume, speed, shuffle and repeat settings between visits
- Responsive layout for small screens

## Running it

**In a browser:** open `index.html`, or serve the folder locally:

```sh
npm start            # runs: python3 -m http.server 8000
# then visit http://localhost:8000
```

**As a desktop app (Electron):**

```sh
npm install
npm run app          # run the desktop app from source
npm run build:win    # build dist/Sherlock-win32-x64/Sherlock.exe
```

The Windows build is a self-contained folder: copy it anywhere and double-click
`Sherlock.exe`. It isn't code-signed, so Windows SmartScreen may ask you to
confirm the first time ("More info" > "Run anyway"). `npm run icons` regenerates
`build/icon.png` and `build/icon.ico` from `build/icon.svg`.

## Keyboard shortcuts

| Key               | Action                 |
| ----------------- | ---------------------- |
| `Space` / `K`     | Play / pause           |
| `←` / `→`         | Seek 5 seconds         |
| `J` / `L`         | Seek 10 seconds        |
| `↑` / `↓`         | Volume                 |
| `N` / `P`         | Next / previous track  |
| `M`               | Mute                   |
| `F`               | Fullscreen             |
| `S`               | Shuffle                |
| `R`               | Repeat mode            |
| `0`–`9`           | Jump to 0%–90%         |

## Project layout

```
index.html          Page markup
css/styles.css      Styles
js/playlist.js      Playlist / play-order logic (no DOM; unit-tested)
js/app.js           UI wiring: media element, controls, visualizer, shortcuts
electron/main.js    Desktop wrapper (Electron window)
build/              App icon (SVG source, PNG, Windows .ico) and icon generator
tests/              Unit tests (node:test) and a Playwright end-to-end test
```

## Tests

```sh
npm test             # playlist unit tests (Node 18+)
npm run test:e2e     # end-to-end test in headless Chromium (needs `playwright`)
```
