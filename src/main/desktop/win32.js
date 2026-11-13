'use strict';

/**
 * Windows desktop integration: puts our wallpaper windows *behind the desktop icons*.
 *
 * Explorer draws the desktop with these windows:
 *   Progman ("Program Manager")
 *     SHELLDLL_DefView      <- the icons
 *     WorkerW               <- static wallpaper (24H2+ layout)
 *
 * Sending Progman the undocumented message 0x052C makes Explorer split the wallpaper off into a
 * separate "WorkerW" window that we can parent our own window into. This is the same technique
 * used by Wallpaper Engine, Lively Wallpaper, weebp, etc. Two layouts exist:
 *
 *  - Legacy (Windows 10 / Windows 11 before 24H2): a top-level WorkerW holds SHELLDLL_DefView,
 *    and the *next* top-level WorkerW sits behind it. We parent into that one.
 *  - "Raised desktop" (Windows 11 24H2+): SHELLDLL_DefView and WorkerW both stay children of
 *    Progman. We parent into Progman and slot our window between the icons and WorkerW.
 */

const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const shell32 = koffi.load('shell32.dll');

const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');

const FindWindowW = user32.func('intptr_t __stdcall FindWindowW(const char16_t *cls, const char16_t *name)');
const FindWindowExW = user32.func(
  'intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t after, const char16_t *cls, const char16_t *name)'
);
const SendMessageTimeoutW = user32.func(
  'intptr_t __stdcall SendMessageTimeoutW(intptr_t hwnd, uint32_t msg, uintptr_t wParam, intptr_t lParam, uint32_t flags, uint32_t timeout, void *result)'
);
const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)');
const SetParent = user32.func('intptr_t __stdcall SetParent(intptr_t child, intptr_t parent)');
const SetWindowPos = user32.func(
  'bool __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)'
);
const IsWindow = user32.func('bool __stdcall IsWindow(intptr_t hwnd)');
const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int index)');
const SystemParametersInfoW = user32.func(
  'bool __stdcall SystemParametersInfoW(uint32_t action, uint32_t param, void *pv, uint32_t winIni)'
);
const SHQueryUserNotificationState = shell32.func('int32_t __stdcall SHQueryUserNotificationState(_Out_ int32_t *state)');

let GetWindowLongPtrW;
let SetWindowLongPtrW;
try {
  GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)');
  SetWindowLongPtrW = user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hwnd, int index, intptr_t value)');
} catch {
  // 32-bit Windows only exports the non-Ptr variants.
  GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongW(intptr_t hwnd, int index)');
  SetWindowLongPtrW = user32.func('intptr_t __stdcall SetWindowLongW(intptr_t hwnd, int index, intptr_t value)');
}

const SMTO_NORMAL = 0x0000;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_SHOWWINDOW = 0x0040;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_APPWINDOW = 0x00040000;
const SM_XVIRTUALSCREEN = 76;
const SM_YVIRTUALSCREEN = 77;
const SPI_GETDESKWALLPAPER = 0x0073;
const SPI_SETDESKWALLPAPER = 0x0014;
const SPIF_UPDATEINIFILE = 0x01;
const SPIF_SENDCHANGE = 0x02;
const HWND_TOP = 0;

let host = null; // { mode, progman, defView?, workerw }

function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}

function findLegacyWorkerW() {
  let workerw = 0;
  EnumWindows((hwnd) => {
    if (FindWindowExW(hwnd, 0, 'SHELLDLL_DefView', null)) {
      // The WorkerW right after the icons' host window is the one behind the icons.
      workerw = FindWindowExW(0, hwnd, 'WorkerW', null);
    }
    return true;
  }, 0);
  return workerw;
}

/** Locate (and if necessary create) the window our wallpapers get parented into. */
function findHost() {
  const progman = FindWindowW('Progman', null);
  if (!progman) return null;

  // Ask Explorer to create the WorkerW behind the desktop icons.
  SendMessageTimeoutW(progman, 0x052c, 0xd, 0x1, SMTO_NORMAL, 1000, null);

  let workerw = findLegacyWorkerW();
  if (workerw) return { mode: 'legacy', progman, workerw };

  const defView = FindWindowExW(progman, 0, 'SHELLDLL_DefView', null);
  if (defView) {
    // Windows 11 24H2+ "raised desktop" layout.
    return { mode: 'raised', progman, defView, workerw: FindWindowExW(progman, 0, 'WorkerW', null) };
  }

  // Some older builds only react to the zero-argument variant.
  SendMessageTimeoutW(progman, 0x052c, 0, 0, SMTO_NORMAL, 1000, null);
  workerw = findLegacyWorkerW();
  if (workerw) return { mode: 'legacy', progman, workerw };

  // Last resort: draw directly into Progman (works, but may cover icons on some builds).
  return { mode: 'progman', progman, workerw: 0 };
}

function hostAlive() {
  if (!host) return false;
  if (!IsWindow(host.progman)) return false;
  if (host.mode === 'legacy' && !IsWindow(host.workerw)) return false;
  if (host.mode === 'raised' && !IsWindow(host.defView)) return false;
  return true;
}

function ensureHost() {
  if (!hostAlive()) host = findHost();
  return host;
}

/**
 * Parent `win` behind the desktop icons and size it to `physicalRect`
 * ({x, y, width, height} in physical screen pixels).
 */
function attach(win, physicalRect) {
  const h = ensureHost();
  if (!h) return false;
  const hwnd = hwndOf(win);

  // Keep it out of Alt+Tab / the taskbar.
  const ex = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (ex | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW);

  // Child-window coordinates are relative to the virtual screen's top-left corner.
  const vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
  const vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const x = physicalRect.x - vx;
  const y = physicalRect.y - vy;
  const { width, height } = physicalRect;

  if (h.mode === 'raised') {
    SetParent(hwnd, h.progman);
    // Directly below the icons...
    SetWindowPos(hwnd, h.defView, x, y, width, height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    // ...and above Explorer's own wallpaper.
    if (h.workerw) SetWindowPos(h.workerw, hwnd, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
  } else {
    SetParent(hwnd, h.mode === 'legacy' ? h.workerw : h.progman);
    SetWindowPos(hwnd, HWND_TOP, x, y, width, height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
  }
  return true;
}

/** Re-apply the user's normal wallpaper so Explorer repaints over our last frame. */
function restore() {
  try {
    const buf = Buffer.alloc(1040); // MAX_PATH*2 wide chars, generous
    if (SystemParametersInfoW(SPI_GETDESKWALLPAPER, 520, buf, 0)) {
      SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, buf, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
    }
  } catch (err) {
    console.error('restore wallpaper failed', err);
  }
  host = null;
}

/** True while a full-screen game/video/presentation is running (QUNS_BUSY / D3D / presentation). */
function isFullscreenAppRunning() {
  const out = [0];
  if (SHQueryUserNotificationState(out) !== 0) return false;
  return out[0] === 2 || out[0] === 3 || out[0] === 4;
}

/** Diagnostics: which desktop layout was detected (used by CI and the settings panel). */
function probe() {
  const h = findHost();
  return h ? h.mode : null;
}

module.exports = {
  name: 'win32',
  probe,
  windowOptions: () => ({}),
  attach,
  isHostAlive: hostAlive,
  isFullscreenAppRunning,
  restore,
  describe: () => (host ? host.mode : 'detached'),
};
