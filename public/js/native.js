// What the Opencord app (Linux, Windows, Android) adds over a browser tab: real system notifications,
// ringing that pulls the window forward, vibration, and app updates. In a browser every function here
// falls back to the web version, so the rest of the client never needs to know where it runs.
import { h } from './dom.js';

const tauri = window.__TAURI__;
export const inApp = Boolean(tauri?.core);
export const onAndroid = /Android/i.test(navigator.userAgent);
const invoke = (command, args) => tauri.core.invoke(command, args);

// The public repo the app builds are published to.
const RELEASES = 'DillonRGaming/opencord-releases';

// --- notifications ---

let permission = !inApp && 'Notification' in window ? Notification.permission : 'default';
if (inApp) invoke('plugin:notification|is_permission_granted').then((ok) => { permission = ok ? 'granted' : 'default'; }, () => {});

export const notificationsSupported = inApp || 'Notification' in window;
export const notificationPermission = () => (notificationsSupported ? permission : 'unsupported');

export async function requestNotifications() {
  if (!notificationsSupported) return 'unsupported';
  if (permission === 'granted') return permission;
  permission = inApp ? await invoke('plugin:notification|request_permission').catch(() => 'denied') : await Notification.requestPermission();
  return permission;
}

// channel: 'messages' or 'calls' (Android shows them with different importance).
export function notify({ title, body = '', tag, icon, channel = 'messages', onClick }) {
  if (permission !== 'granted') return;
  if (inApp) {
    invoke('plugin:notification|notify', { options: { title, body, channelId: onAndroid ? channel : undefined } }).catch(() => {});
    if (channel === 'calls') attention(false);
    return;
  }
  const shown = new Notification(title, { body, tag, icon });
  shown.onclick = () => { window.focus(); onClick?.(); shown.close(); };
}

// --- attention and vibration ---

// Shows the window and flashes it in the taskbar (desktop app only).
export function attention(focus = false) {
  if (inApp && !onAndroid) invoke('attention', { focus }).catch(() => {});
}

// pattern: milliseconds, alternating vibrate and pause, like navigator.vibrate.
export function vibrate(pattern) {
  const steps = Array.isArray(pattern) ? pattern : [pattern];
  if (!inApp) return navigator.vibrate?.(steps);
  if (!onAndroid) return;
  let at = 0;
  steps.forEach((ms, i) => {
    if (i % 2 === 0) setTimeout(() => invoke('plugin:haptics|vibrate', { duration: ms }).catch(() => {}), at);
    at += ms;
  });
}

// An incoming call: a call notification, the window brought forward, and the phone buzzing in a
// ring rhythm until the returned function is called.
export function startRinging(title, body) {
  notify({ title, body, channel: 'calls' });
  attention(false);
  const buzz = () => vibrate([400, 200, 400]);
  buzz();
  const timer = setInterval(buzz, 2200);
  return () => { clearInterval(timer); if (!inApp) navigator.vibrate?.(0); };
}

// --- the window (desktop app) ---
// The window has no system title bar. Its buttons sit at the top right, in line with the headers,
// and the headers' empty space drags the window (double-click maximizes).

const DRAG_AREAS = '.main-header, .side-header, .sidebar-header, .rail, .auth-brand, .auth-art';
const GROUND = '.app, .auth'; // the gaps between panels
const INTERACTIVE = 'button, a, input, textarea, select, label, [contenteditable], [role="button"], [role="tab"], .server-icon';

const glyph = (d) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  return svg;
};

function windowControls() {
  const win = tauri.window.getCurrentWindow();
  const control = (label, d, onclick, extra = '') => h('button', { type: 'button', class: `window-control ${extra}`, title: label, 'aria-label': label, onclick }, glyph(d));
  const maximize = control('Maximize', 'M2.5 2.5h7v7h-7z', () => win.toggleMaximize());
  const sync = async () => {
    const big = await win.isMaximized().catch(() => false);
    document.documentElement.toggleAttribute('data-maximized', big);
    maximize.title = big ? 'Restore' : 'Maximize';
    maximize.setAttribute('aria-label', maximize.title);
    maximize.replaceChildren(glyph(big ? 'M3.5 4.5h5v5h-5z M4.5 2.5h5v5' : 'M2.5 2.5h7v7h-7z'));
  };
  win.onResized(sync);
  sync();
  document.body.append(h('div', { class: 'window-controls' },
    control('Minimize', 'M2.5 6h7', () => win.minimize()),
    maximize,
    control('Close', 'M3 3l6 6M9 3l-6 6', () => win.close(), 'close')));

  document.addEventListener('mousedown', (event) => {
    const draggable = event.target.closest(DRAG_AREAS) || event.target.matches(GROUND);
    if (event.button !== 0 || event.target.closest(INTERACTIVE) || !draggable) return;
    if (event.detail === 2) win.toggleMaximize();
    else win.startDragging();
  });
}

if (inApp && !onAndroid) {
  document.documentElement.setAttribute('data-frameless', '');
  if (document.body) windowControls();
  else addEventListener('DOMContentLoaded', windowControls);
}

// --- app updates ---

const newer = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

function updateBar(text, label, action) {
  if (document.querySelector('.app-update')) return;
  const bar = h('div', { class: 'app-update', role: 'status' },
    h('span', {}, text),
    h('button', { type: 'button', class: 'button primary small', onclick: action }, label),
    h('button', { type: 'button', class: 'button ghost small', onclick: () => bar.remove() }, 'Later'));
  document.body.append(bar);
}

// Desktop downloads updates by itself and only needs a restart. Android can't update itself
// outside the Play Store, so it offers the new APK to download.
async function checkForUpdate() {
  try {
    if (!onAndroid) {
      const version = await invoke('pending_update');
      if (version) updateBar(`Opencord ${version} is ready.`, 'Restart', () => invoke('install_update'));
      return;
    }
    const { version } = await invoke('app_info');
    const release = await fetch(`https://api.github.com/repos/${RELEASES}/releases/latest`).then((r) => r.json());
    const latest = String(release.tag_name || '').replace(/^v/, '');
    const apk = release.assets?.find((a) => a.name.endsWith('.apk'));
    if (latest && apk && newer(latest, version)) {
      updateBar(`Opencord ${latest} is out.`, 'Update', () => invoke('plugin:opener|open_url', { url: apk.browser_download_url }));
    }
  } catch { /* offline or no releases yet: try again later */ }
}

if (inApp) {
  setTimeout(checkForUpdate, 10_000);
  setInterval(checkForUpdate, 60 * 60 * 1000);
}
