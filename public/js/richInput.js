// A textarea look-alike that draws custom emoji (<:name:id>) as pictures while you type.
// It keeps the textarea API the composer uses (value, selectionStart/End, setRangeText, disabled,
// placeholder), so the text it hands back is still the plain message with <:name:id> codes in it.
const CODE = /<a?:([a-z0-9_]+):([\w-]+)>/gi;

function lengthOf(node) {
  if (node.nodeType === 3) return node.data.length;
  if (node.dataset?.code) return node.dataset.code.length;
  if (node.nodeName === 'BR') return node.dataset?.end ? 0 : 1;
  let n = 0;
  for (const child of node.childNodes) n += lengthOf(child);
  // Blocks the browser adds (a <div> per line) start a new line.
  if ((node.nodeName === 'DIV' || node.nodeName === 'P') && node.previousSibling) n += 1;
  return n;
}

export function createRichInput({ placeholder = '', ...handlers } = {}) {
  const el = document.createElement('div');
  el.className = 'rich-input';
  el.contentEditable = 'true';
  el.setAttribute('role', 'textbox');
  el.setAttribute('aria-multiline', 'true');
  el.spellcheck = true;
  for (const [name, fn] of Object.entries(handlers)) if (name.startsWith('on')) el.addEventListener(name.slice(2), fn);

  const markEmpty = () => el.classList.toggle('empty', el.value === '');

  function render(text) {
    const parts = [];
    let last = 0;
    for (const m of text.matchAll(CODE)) {
      if (m.index > last) parts.push(document.createTextNode(text.slice(last, m.index)));
      const img = document.createElement('img');
      img.className = 'emoji-img';
      img.src = `/media/emojis/${m[2]}`;
      img.alt = img.title = `:${m[1]}:`;
      img.draggable = false;
      img.dataset.code = m[0];
      parts.push(img);
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(document.createTextNode(text.slice(last)));
    // A trailing newline needs something after it to show.
    if (text.endsWith('\n')) { const br = document.createElement('br'); br.dataset.end = '1'; parts.push(br); }
    el.replaceChildren(...parts);
    markEmpty();
  }

  // Text offset of a DOM position.
  function offsetOf(container, offset) {
    let total = 0;
    const walk = (node) => {
      if (node === container) {
        if (node.nodeType === 3) { total += offset; return true; }
        if ((node.nodeName === 'DIV' || node.nodeName === 'P') && node !== el && node.previousSibling) total += 1;
        for (let i = 0; i < offset; i++) total += lengthOf(node.childNodes[i]);
        return true;
      }
      if (node.nodeType === 3 || node.dataset?.code || node.nodeName === 'BR') { total += lengthOf(node); return false; }
      if (node !== el && (node.nodeName === 'DIV' || node.nodeName === 'P') && node.previousSibling) total += 1;
      for (const child of node.childNodes) if (walk(child)) return true;
      return false;
    };
    walk(el);
    return total;
  }

  function range() {
    const sel = document.getSelection();
    if (!sel.rangeCount || !el.contains(sel.anchorNode)) { const n = el.value.length; return [n, n]; }
    const r = sel.getRangeAt(0);
    return [offsetOf(r.startContainer, r.startOffset), offsetOf(r.endContainer, r.endOffset)];
  }

  function placeCaret(at) {
    const sel = document.getSelection();
    const r = document.createRange();
    let left = at;
    for (const node of el.childNodes) {
      const n = lengthOf(node);
      if (node.nodeType === 3 && left <= n) { r.setStart(node, left); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); return; }
      if (left < n || (left === n && node.nodeType !== 3)) {
        if (left === 0) r.setStartBefore(node); else r.setStartAfter(node);
        r.collapse(true); sel.removeAllRanges(); sel.addRange(r); return;
      }
      left -= n;
    }
    r.selectNodeContents(el);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  Object.defineProperties(el, {
    value: {
      get() {
        let out = '';
        for (const node of el.childNodes) {
          if (node.nodeType === 3) out += node.data;
          else if (node.dataset?.code) out += node.dataset.code;
          else if (node.nodeName === 'BR') out += node.dataset.end ? '' : '\n';
          else { if (out) out += '\n'; out += node.textContent; }
        }
        return out.replace(/ /g, ' ');
      },
      set(text) { render(String(text ?? '')); },
    },
    selectionStart: { get: () => range()[0] },
    selectionEnd: { get: () => range()[1] },
    disabled: {
      get: () => el.contentEditable !== 'true',
      set(off) { el.contentEditable = off ? 'false' : 'true'; el.setAttribute('aria-disabled', String(Boolean(off))); },
    },
    placeholder: {
      get: () => el.dataset.placeholder || '',
      set(text) { el.dataset.placeholder = text; },
    },
  });
  el.placeholder = placeholder;

  el.setRangeText = (text, start = el.selectionStart, end = el.selectionEnd) => {
    const value = el.value;
    render(value.slice(0, start) + text + value.slice(end));
    if (document.activeElement === el || el.contains(document.activeElement)) placeCaret(start + text.length);
    else { el.focus(); placeCaret(start + text.length); }
  };

  // Every edit that adds text goes through setRangeText, so pasted or typed codes turn into pictures
  // and nothing but plain text gets in.
  el.addEventListener('beforeinput', (event) => {
    if (el.disabled) return;
    const type = event.inputType;
    let text = null;
    if (type === 'insertParagraph' || type === 'insertLineBreak') text = '\n';
    else if (type === 'insertFromPaste' || type === 'insertFromDrop' || type === 'insertReplacementText') {
      text = event.dataTransfer?.getData('text/plain') ?? event.data ?? '';
    } else if (type === 'insertText' && event.data && /[>\n]/.test(event.data)) text = event.data;
    if (text === null) return;
    event.preventDefault();
    el.setRangeText(text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Paste with files is handled by the composer; plain paste goes through beforeinput above.
  el.addEventListener('input', markEmpty);
  // Copying keeps the codes, so pasting elsewhere brings the emoji along.
  el.addEventListener('copy', (event) => {
    const [s, e] = range();
    if (s === e) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', el.value.slice(s, e));
  });
  el.addEventListener('cut', (event) => {
    const [s, e] = range();
    if (s === e) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', el.value.slice(s, e));
    el.setRangeText('', s, e);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  markEmpty();
  return el;
}
