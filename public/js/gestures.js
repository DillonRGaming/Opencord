// Touch gestures on phones:
// - Swipe right on the chat to slide it away and show the server and channel lists; swipe left on the
//   lists to slide the chat back. The chat follows your finger, like Discord.
// - Swipe left on a server chat to open the member list; swipe right on a side panel to close it.
// - Scroll lists stretch a little past their ends (elastic overscroll), so you can feel there's no more.
import { state } from './store.js';
import { showNav, showMain } from './router.js';

const isPhone = () => matchMedia('(max-width: 799px)').matches;
const DECIDE_PX = 10; // movement before deciding between a scroll and a swipe
const COMMIT = 0.3; // fraction of the screen width that finishes a swipe on release
const FLICK = 0.5; // px per ms that finishes a swipe even when it was short

// Things that use horizontal drags themselves.
function ownsHorizontal(target) {
  for (let el = target; el && el !== document.body; el = el.parentElement) {
    if (el.matches?.('input[type=range], video, audio, .lightbox, .vc-grid, canvas, [data-no-swipe]')) return true;
    if (el.scrollWidth > el.clientWidth + 2) {
      const { overflowX } = getComputedStyle(el);
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
  }
  return false;
}

function swipeNavigation() {
  const column = document.querySelector('.column');
  const side = document.querySelector('.side');
  let drag = null; // { x, y, t, mode, dx }

  const width = () => window.innerWidth;
  const sideOpen = () => side && !side.hidden && getComputedStyle(side).display !== 'none';

  function release() {
    document.body.classList.remove('swiping');
    column.style.transform = '';
    if (side) side.style.transform = '';
  }

  document.addEventListener('touchstart', (event) => {
    if (!isPhone() || event.touches.length !== 1 || ownsHorizontal(event.target)) { drag = null; return; }
    const touch = event.touches[0];
    drag = { x: touch.clientX, y: touch.clientY, t: performance.now(), mode: null, dx: 0 };
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!drag) return;
    const touch = event.touches[0];
    const dx = touch.clientX - drag.x;
    const dy = touch.clientY - drag.y;
    if (!drag.mode) {
      if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
      if (Math.abs(dy) >= Math.abs(dx) || window.getSelection()?.toString()) { drag = null; return; }
      const panel = document.body.dataset.panel;
      if (sideOpen()) drag.mode = dx > 0 ? 'close-side' : null;
      else if (panel === 'main') drag.mode = dx > 0 ? 'to-nav' : (state.route.name === 'server' ? 'open-members' : null);
      else drag.mode = dx < 0 && column ? 'to-main' : null;
      if (!drag.mode) { drag = null; return; }
      drag.x = touch.clientX; // start from here so the panel doesn't jump
      document.body.classList.add('swiping');
      return;
    }
    drag.dx = touch.clientX - drag.x;
    if (drag.mode === 'to-nav') column.style.transform = `translateX(${Math.max(0, drag.dx)}px)`;
    if (drag.mode === 'to-main') column.style.transform = `translateX(${Math.max(0, width() + Math.min(0, drag.dx))}px)`;
    if (drag.mode === 'close-side') side.style.transform = `translateX(${Math.max(0, drag.dx)}px)`;
  }, { passive: true });

  function end() {
    if (!drag?.mode) { drag = null; return; }
    const { mode, dx, t } = drag;
    drag = null;
    const speed = Math.abs(dx) / Math.max(1, performance.now() - t);
    const far = Math.abs(dx) > width() * COMMIT || speed > FLICK;
    // Dropping the inline transform and switching panels in the same frame lets the CSS transition carry
    // the panel from where the finger left it to where it belongs.
    release();
    if (!far) return;
    if (mode === 'to-nav' && dx > 0) showNav();
    if (mode === 'to-main' && dx < 0) showMain();
    if (mode === 'close-side' && dx > 0) side.querySelector('.side-header .icon-button')?.click();
    if (mode === 'open-members' && dx < 0) import('./views/side.js').then((m) => m.toggleMembers(true));
  }
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });
}

// --- elastic overscroll ---

const SCROLLERS = '.scroller, .sidebar-scroll, .side-body, .page-scroll, .rail, .settings-nav, .menu, .emoji-picker-grid, .notification-list';
const PULL = 0.35; // how much of the finger's movement the content follows past the end
const MAX_PULL = 90;

function elastic() {
  let pull = null; // { el, y, edge, offset }

  const atTop = (el) => el.scrollTop <= 0;
  const atBottom = (el) => Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight;
  const move = (el, px) => {
    for (const child of el.children) child.style.transform = px ? `translateY(${px}px)` : '';
  };

  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) return;
    const el = event.target.closest?.(SCROLLERS);
    if (!el) return;
    pull = { el, y: event.touches[0].clientY, edge: null, offset: 0 };
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!pull || document.body.classList.contains('swiping')) return;
    const { el } = pull;
    const y = event.touches[0].clientY;
    const dy = y - pull.y;
    if (!pull.edge) {
      if (dy > 0 && atTop(el)) pull.edge = 'top';
      else if (dy < 0 && atBottom(el)) pull.edge = 'bottom';
      else { pull.y = y; return; }
      pull.y = y;
      el.classList.add('stretching');
      return;
    }
    const raw = y - pull.y;
    const toward = pull.edge === 'top' ? Math.max(0, raw) : Math.min(0, raw);
    // Rubber band: easy at first, then harder the further it goes.
    const offset = Math.sign(toward) * MAX_PULL * (1 - 1 / (1 + (Math.abs(toward) * PULL) / MAX_PULL));
    pull.offset = offset;
    move(el, offset);
    if (!toward) { // moved back past where it started: hand over to normal scrolling
      el.classList.remove('stretching');
      pull.edge = null;
    }
  }, { passive: true });

  const end = () => {
    if (!pull) return;
    const { el, offset } = pull;
    pull = null;
    if (!offset) { el.classList.remove('stretching'); return; }
    el.classList.remove('stretching');
    el.classList.add('springing');
    move(el, 0);
    setTimeout(() => el.classList.remove('springing'), 320);
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });
}

export function startGestures() {
  if (!('ontouchstart' in window) && !navigator.maxTouchPoints) return;
  swipeNavigation();
  elastic();
}
