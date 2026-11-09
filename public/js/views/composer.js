import * as api from '../api.js';
import { h } from '../dom.js';
import { formatSize } from '../format.js';
import { sendTyping } from '../realtime.js';
import { startUpload } from '../upload.js';
import { iconButton, pickFiles, toast } from '../ui.js';

const TYPING_EVERY_MS = 3000;

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

// The message box. Files start uploading as soon as they are added; sending waits for them to finish.
export function createComposer(channel, placeholder) {
  let uploads = [];
  let sending = false;
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
      iconButton('paperclip', 'Attach files', async () => addFiles(await pickFiles({ multiple: true }))),
      textarea,
      iconButton('send', 'Send', () => send(), 'send')));

  function addFiles(files) {
    for (const file of files) {
      const status = h('span', { class: 'upload-status' }, `0% of ${formatSize(file.size)}`);
      const bar = h('span');
      const upload = { attachment: null, failed: false };
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
    if (!upload.attachment) upload.handle.cancel();
    upload.el.remove();
    uploads = uploads.filter((other) => other !== upload);
  }

  async function send() {
    if (sending) return;
    const content = textarea.value.trim();
    if (!content && !uploads.length) return;

    sending = true;
    el.classList.add('waiting');
    try {
      await Promise.all(uploads.map((upload) => upload.done));
      if (uploads.some((upload) => upload.failed)) {
        toast("A file didn't upload. Remove it or add it again, then send.");
        return;
      }
      const sent = uploads;
      await api.post(`/api/channels/${channel.id}/messages`, { content, attachmentIds: sent.map((upload) => upload.attachment.id) });
      textarea.value = '';
      autoGrow(textarea);
      lastTyping = 0;
      for (const upload of sent) upload.el.remove();
      uploads = uploads.filter((upload) => !sent.includes(upload));
    } catch (err) {
      toast(err.message);
    } finally {
      sending = false;
      el.classList.remove('waiting');
    }
  }

  // Leaving the channel: stop anything still uploading.
  function destroy() {
    for (const upload of uploads) if (!upload.attachment) upload.handle.cancel();
  }

  return { el, addFiles, destroy, focus: () => textarea.focus() };
}
