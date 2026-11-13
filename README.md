# LiveDesk

A live wallpaper app for your PC, in the spirit of Wallpaper Engine. Download wallpapers into a folder and they show up in LiveDesk. Click one and it plays on your desktop, **behind your icons**.

![icon](assets/icon.png)

## What it plays

| Type | What to put in your wallpaper folder |
| --- | --- |
| **Video** | `.mp4`, `.webm`, `.m4v`, `.mov`, `.mkv` files |
| **Web** | A folder containing an `index.html` (canvas/WebGL/CSS animations), or a single `.html` file |
| **Image** | `.jpg`, `.png`, `.webp`, `.gif` (animated GIFs animate), `.avif`, `.bmp` |
| **Wallpaper Engine projects** | Folders with a `project.json` of type `video` or `web` work as-is. Their `preview` image is used as the thumbnail, and user properties are passed to `wallpaperPropertyListener`. |

Wallpaper Engine **scene** wallpapers (`scene.pkg`) use a proprietary format and **application** wallpapers are `.exe` files, so neither is supported. They still show in the library, greyed out with an explanation.

Subfolders are fine. Organise your folder however you like.

## Features

- Plays behind the desktop icons on Windows 10 and 11, including the new desktop layout in Windows 11 24H2.
- **Multi-monitor:** a different wallpaper per display, or one on all of them.
- **Picks up new files on its own:** the folder is watched, so new downloads appear in the library as soon as they land.
- **Drag and drop:** drop files or folders onto the window to copy them into your wallpaper folder.
- **Thumbnails** are generated automatically. Video cards play a preview when you hover over them.
- **Saves CPU and GPU:** pauses automatically while a full-screen game, video or presentation is running, and optionally on battery. A paused wallpaper is fully frozen, so it costs about 0% CPU.
- Scaling (fill, fit, stretch, center), video volume, playback speed.
- Favorites, search, type filters.
- **Shuffle** every N minutes, using your favorites if you have at least two.
- System-tray app: closing the window leaves your wallpaper running. Optional start at sign-in.
- **Safe with downloaded files:** web wallpapers run sandboxed, each on its own origin, with no Node access, popups or navigation.

## Getting it on your PC

### Option A: download a build (no tools needed)

Every push to this repo builds Windows binaries with GitHub Actions:

1. On GitHub, open **Actions → Build** and click the latest successful run.
2. Download the **LiveDesk-windows** artifact and unzip it.
3. Run `LiveDesk Setup x.y.z.exe` to install it, or `LiveDesk-x.y.z-portable.exe` to run it without installing.

The builds aren't code-signed, so Windows SmartScreen will warn you the first time. Click **More info → Run anyway**.

### Option B: run from source

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/abweasy/sherlock.git
cd sherlock
npm install
npm start
```

To build the installer yourself on Windows, run `npm run dist:win`. The output goes to `dist/`.

## Using it

1. On first launch LiveDesk creates your wallpaper folder at **`Videos\LiveDesk Wallpapers`**. To use any other folder, choose **⚙ Settings → Wallpaper folder → Change…**.
2. Download wallpapers into that folder, or drag them onto the LiveDesk window.
3. Click a wallpaper to apply it. With several monitors, use **Apply to** in the top bar to pick a display.
4. Close the window when you're done. LiveDesk stays in the system tray, where you can pause, skip to the next wallpaper, open the folder or quit.

Right-click a wallpaper to show it in Explorer.

### Making your own web wallpaper

Any web page works. Create a folder with an `index.html` and drop it in. To give it a title and thumbnail, add a `project.json`:

```json
{ "title": "My Wallpaper", "type": "web", "file": "index.html", "preview": "preview.jpg" }
```

## How it works

LiveDesk is an [Electron](https://www.electronjs.org/) app.

- `src/main/library.js` scans the wallpaper folder. It has no Electron dependency and is unit tested.
- `src/main/protocol.js` serves wallpaper files through a private `wallpaper://` protocol, with byte-range support for video seeking. It also injects a small shim so Wallpaper Engine web wallpapers find the API they expect.
- `src/main/wallpaper-manager.js` creates one borderless window per monitor and handles auto-pause.
- `src/main/desktop/win32.js` puts those windows behind the desktop icons. It sends Explorer's `Progman` window the undocumented `0x052C` message, which splits off a `WorkerW` window, then re-parents our window into it. This is the same technique Wallpaper Engine and Lively use. Win32 is called through [koffi](https://koffi.dev), so nothing needs compiling.
- On macOS and Linux (X11), Electron's `type: 'desktop'` window is used instead. This is best effort; Windows is the main target.

When you quit, LiveDesk re-applies your normal Windows wallpaper so the desktop repaints.

## Development

```bash
npm test          # unit tests (library scanner, path-traversal guard, WE compatibility shim)
npm start         # run the app
npm run icons     # regenerate assets/*.png
```

## Troubleshooting

- **The wallpaper covers my icons, or doesn't show at all.** Explorer's internal window layout changes between Windows builds. Restart LiveDesk from the tray. If it still happens, open an issue and say which Windows version you have: run `winver` to find it.
- **A video won't play.** Chromium plays H.264/AAC and VP8/VP9/AV1 in MP4 or WebM. HEVC (H.265) needs the HEVC codec from the Microsoft Store and a GPU that supports it. Re-encode to H.264 if in doubt.
- **High GPU usage.** Lower-resolution or lower-bitrate videos help a lot. You can also pause from the tray.
