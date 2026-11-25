// The Opencord icon in the accent colour you picked: the tab's icon in a browser, and the window and
// taskbar icon in the desktop app. (Android's home-screen icon can't change while the app is installed.)
import { inApp, onAndroid } from './native.js';

let svg = null; // the logo's SVG, fetched once
let shown = '';

const colored = (bg, fg) => svg.replace('fill="#ffffff"', `fill="${bg}"`).replace('fill="#141814"', `fill="${fg}"`);

async function toPng(markup, size = 256) {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await img.decode();
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  canvas.getContext('2d').drawImage(img, 0, 0, size, size);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function paintAppIcon(bg, fg) {
  const key = `${bg}|${fg}`;
  if (key === shown) return;
  shown = key;
  try {
    svg ??= await fetch('/favicon.svg').then((r) => r.text());
    const markup = colored(bg, fg);
    const link = document.querySelector('link[rel="icon"]');
    if (link) link.href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    if (inApp && !onAndroid) await window.__TAURI__.window.getCurrentWindow().setIcon(await toPng(markup));
  } catch {
    shown = ''; // try again on the next change
  }
}
