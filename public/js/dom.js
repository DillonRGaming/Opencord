// Tiny DOM builder. Strings passed as children become text nodes, so user text is never parsed as HTML.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') setStyles(el, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat(Infinity).filter((child) => child != null && child !== false));
  return el;
}

function setStyles(el, styles) {
  for (const [name, value] of Object.entries(styles)) {
    if (name.startsWith('--')) el.style.setProperty(name, value);
    else el.style[name] = value;
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
