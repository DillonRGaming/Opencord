// A small elastic stretch on everything that scrolls: wheel past the top or bottom of a list, chat, settings page,
// menu… and its contents give a little (at most a few pixels), then spring back. Normal scrolling isn't touched:
// this only reacts once a scroller is already at its end. Off with reduced motion, and on touch screens (phones
// already bounce). Skip an area with data-no-elastic (the top server tabs have their own, stronger one).

const MAX = 16; // furthest the contents can stretch, in pixels
const PULL = 0.1; // how much of each wheel step becomes stretch
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const state = new WeakMap(); // scroller → { over, timer }

function scrollsY(el) {
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  const { overflowY } = getComputedStyle(el);
  return overflowY === 'auto' || overflowY === 'scroll';
}

// The scroller this wheel would move: the nearest one up from where the pointer is.
function scrollerFor(target) {
  for (let el = target instanceof Element ? target : target.parentElement; el && el !== document.body; el = el.parentElement) {
    if (el.matches('[data-no-elastic], .rail, textarea, input, select')) return null;
    if (scrollsY(el)) return el;
  }
  return null;
}

function set(el, over, animate) {
  for (const child of el.children) {
    child.style.transition = animate ? 'transform 0.38s cubic-bezier(0.2, 0.9, 0.25, 1)' : 'none';
    child.style.transform = over ? `translateY(${over.toFixed(2)}px)` : '';
  }
}

function onWheel(event) {
  if (reduced.matches || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  const el = scrollerFor(event.target);
  if (!el) return;
  const atTop = el.scrollTop <= 0;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
  const down = event.deltaY > 0;
  if (!(down ? atBottom : atTop)) return; // still room to scroll: leave it to the browser

  const s = state.get(el) || { over: 0, timer: null };
  state.set(el, s);
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
  // Harder to pull the further it's already stretched.
  const resistance = 1 - Math.min(1, Math.abs(s.over) / MAX);
  s.over = Math.max(-MAX, Math.min(MAX, s.over - delta * PULL * resistance));
  set(el, s.over, false);
  clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    s.over = 0;
    set(el, 0, true);
    // Once it has settled, leave the children's own styles exactly as they were.
    s.timer = setTimeout(() => { for (const child of el.children) child.style.transition = ''; }, 420);
  }, 90);
}

export function startElastic() {
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) return;
  addEventListener('wheel', onWheel, { passive: true, capture: true });
}
