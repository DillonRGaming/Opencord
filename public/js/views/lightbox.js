import { h } from '../dom.js';
import { onEscape } from '../escape.js';

// An image shown as big as the window allows. Click anywhere or press Escape to go back.
export function openLightbox(attachment) {
  const box = h('div', { class: 'lightbox', onclick: (event) => { if (event.target.tagName !== 'A') close(); } },
    h('img', { src: attachment.url, alt: attachment.name }),
    h('a', { href: attachment.url, target: '_blank', rel: 'noopener' }, 'Open original'));
  const release = onEscape(() => close());
  function close() {
    release();
    box.remove();
  }
  document.getElementById('layers').append(box);
}
