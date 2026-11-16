// A small bar chart: one bar per point, a hover tooltip on each, the biggest value top-left and a few labels
// along the bottom. points: [{ label, n }]. Used by bot messages (rich.js) and the person stats page.
import { h } from './dom.js';

const SVG = 'http://www.w3.org/2000/svg';

export function barChart(points, { unit = '', format = (n) => n.toLocaleString(), ticks } = {}) {
  const W = 600; const H = 150; const top = 14; const bottom = 6; const gap = Math.min(4, 120 / points.length);
  const max = Math.max(1, ...points.map((p) => p.n));
  const slot = W / Math.max(1, points.length);
  const barW = Math.max(1, slot - gap);
  const plotH = H - top - bottom;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'chart-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${unit}: ${points.map((p) => `${p.label} ${format(p.n)}`).join(', ')}`);
  const el = (name, attrs) => {
    const node = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
    return node;
  };
  el('line', { x1: 0, x2: W, y1: top, y2: top, class: 'chart-grid' });
  el('line', { x1: 0, x2: W, y1: top + plotH, y2: top + plotH, class: 'chart-axis' });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  points.forEach((p, i) => {
    const x = i * slot + gap / 2;
    const hgt = p.n ? Math.max(2, (p.n / max) * plotH) : 0;
    if (hgt) {
      const y = top + plotH - hgt;
      const r = Math.min(3, barW / 2, hgt);
      el('path', { class: 'chart-bar', d: `M${x} ${top + plotH}V${y + r}q0 ${-r} ${r} ${-r}h${barW - 2 * r}q${r} 0 ${r} ${r}V${top + plotH}Z` });
    }
    const hit = el('rect', { x: i * slot, y: 0, width: slot, height: H, class: 'chart-hit' });
    hit.addEventListener('pointerenter', () => {
      tip.replaceChildren(h('strong', {}, format(p.n)), ` ${unit} · ${p.label}`);
      tip.hidden = false;
      tip.style.left = `${((i + 0.5) / points.length) * 100}%`;
      hit.classList.add('on');
    });
    hit.addEventListener('pointerleave', () => { tip.hidden = true; hit.classList.remove('on'); });
  });
  const labels = ticks || (points.length ? [points[0].label, points[Math.floor(points.length / 2)].label, points.at(-1).label] : []);
  return h('div', { class: 'chart' },
    h('span', { class: 'chart-max' }, format(max)),
    h('div', { class: 'chart-plot' }, svg, tip),
    h('div', { class: 'chart-x' }, labels.map((l) => h('span', {}, l))));
}

// "Nov 3" from "2026-11-03".
export function shortDay(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// "3h 20m" / "45m".
export function minutesText(minutes) {
  const m = Math.round(minutes);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
