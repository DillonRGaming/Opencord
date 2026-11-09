import * as api from '../api.js';
import { h } from '../dom.js';
import { formatSize } from '../format.js';
import { sendTyping } from '../realtime.js';
import { startUpload } from '../upload.js';
import { state } from '../store.js';
import { avatar, iconButton, pickFiles, toast } from '../ui.js';

const TYPING_EVERY_MS = 3000;

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

// The message box. Files start uploading as soon as they are added; sending waits for them to finish.
export function createComposer(channel, placeholder) {
  let uploads = [];
  let queue = Promise.resolve();
  let lastTyping = 0;

  const tray = h('div', { class: 'uploads' });
  const textarea = h('textarea', {
    rows: 1, placeholder, 'aria-label': placeholder,
    oninput: () => {
      autoGrow(textarea);
      if (textarea.value && Date.now() - lastTyping > TYPING_EVERY_MS) {
        lastTyping = Date.now();
        sendTyping(channel.id);
      }
    },
    onkeydown: (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        send();
      }
    },
    onpaste: (event) => {
      const files = [...event.clipboardData.files];
      if (!files.length) return;
      event.preventDefault();
      addFiles(files);
    },
  });
  const el = h('div', { class: 'composer' }, tray,
    h('div', { class: 'composer-row' },
      avatar(state.me, { size: 24 }),
      textarea,
      iconButton('paperclip', 'Attach files', async () => addFiles(await pickFiles({ multiple: true }))),
      iconButton('send', 'Send', () => send(), 'send')));

  function addFiles(files) {
    for (const file of files) {
      const status = h('span', { class: 'upload-status' }, `0% of ${formatSize(file.size)}`);
      const bar = h('span');
      const upload = { attachment: null, failed: false, removed: false };
      upload.el = h('div', { class: 'upload' },
        h('span', { class: 'upload-name', title: file.name }, file.name),
        h('div', { class: 'upload-bar' }, bar), status,
        iconButton('x', 'Remove', () => removeUpload(upload)));
      upload.handle = startUpload(file, (fraction) => {
        bar.style.width = `${fraction * 100}%`;
        status.textContent = `${Math.floor(fraction * 100)}% of ${formatSize(file.size)}`;
      });
      upload.done = upload.handle.promise.then((attachment) => {
        upload.attachment = attachment;
        upload.el.classList.add('done');
        bar.style.width = '100%';
        status.textContent = formatSize(file.size);
      }, (err) => {
        upload.failed = true;
        upload.el.classList.add('failed');
        status.textContent = err.message;
      });
      uploads.push(upload);
      tray.append(upload.el);
    }
    textarea.focus();
  }

  function removeUpload(upload) {
    upload.removed = true;
    if (!upload.attachment) upload.handle.cancel();
    upload.el.remove();
    uploads = uploads.filter((other) => other !== upload);
  }

  // Sends go out one after another, so typing the next message never waits on the last one.
  function send() {
    const content = textarea.value.trim();
    const batch = uploads;
    if (!content && !batch.length) return;
    textarea.value = '';
    autoGrow(textarea);
    uploads = [];
    lastTyping = 0;
    queue = queue.then(() => deliver(content, batch));
  }

  async function deliver(content, batch) {
    try {
      await Promise.all(batch.map((upload) => upload.done));
      const files = batch.filter((upload) => !upload.removed);
      if (files.some((upload) => upload.failed)) throw new Error("A file didn't upload. Remove it or add it again, then send.");
      if (!content && !files.length) return;
      await api.post(`/api/channels/${channel.id}/messages`, { content, attachmentIds: files.map((upload) => upload.attachment.id) });
      for (const upload of files) upload.el.remove();
    } catch (err) {
      // Put everything back so nothing typed or uploaded is lost.
      toast(err.message);
      if (!textarea.value) textarea.value = content;
      autoGrow(textarea);
      uploads = [...batch.filter((upload) => !upload.removed), ...uploads];
    }
  }

  // Leaving the channel: stop anything still uploading.
  function destroy() {
    for (const upload of uploads) if (!upload.attachment) upload.handle.cancel();
  }

  return { el, addFiles, destroy, focus: () => textarea.focus() };
}
