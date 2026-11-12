# Sherlock Media Player

A browser-based audio and video player. Everything runs in your browser: no build
step, no dependencies, and your files never leave your computer.

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

Open `index.html` in a browser, or serve the folder locally:

```sh
npm start            # runs: python3 -m http.server 8000
# then visit http://localhost:8000
```

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
tests/              Unit tests (node:test) and a Playwright end-to-end test
```

## Tests

```sh
npm test             # playlist unit tests (Node 18+)
npm run test:e2e     # end-to-end test in headless Chromium (needs `playwright`)
```
