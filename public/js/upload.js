import * as api from './api.js';
import { ApiError } from './api.js';
import { sleep } from './dom.js';

const MAX_FAILURES = 8;

// Sends one chunk with XHR, because fetch can't report upload progress.
function putChunk(url, chunk, onProgress, hold) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    hold(xhr);
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else reject(new ApiError(xhr.response?.error || `Upload failed (${xhr.status}).`, xhr.status, xhr.response));
    };
    xhr.onerror = () => reject(new ApiError('Network error.', 0));
    xhr.onabort = () => reject(new ApiError('Upload cancelled.', 0));
    xhr.send(chunk);
  });
}

// Uploads a file of any size in chunks. After a network hiccup it asks the server how much arrived
// and carries on from there. Returns { promise → Attachment, cancel() }.
export function startUpload(file, onProgress) {
  let xhr = null;
  let uploadId = null;
  let cancelled = false;

  async function run() {
    const start = await api.post('/api/uploads', { name: file.name || 'file', size: file.size, type: file.type });
    if (start.attachment) return start.attachment;
    uploadId = start.id;

    let offset = 0;
    let failures = 0;
    for (;;) {
      if (cancelled) throw new ApiError('Upload cancelled.', 0);
      const base = offset;
      try {
        const chunk = file.slice(base, base + start.chunkSize);
        const res = await putChunk(`/api/uploads/${uploadId}?offset=${base}`, chunk,
          (loaded) => onProgress((base + loaded) / file.size), (x) => { xhr = x; });
        failures = 0;
        offset = res.received;
        onProgress(offset / file.size);
        if (res.attachment) return res.attachment;
      } catch (err) {
        if (cancelled) throw err;
        const refused = err.status >= 400 && err.status < 500 && err.status !== 409;
        if (refused || ++failures > MAX_FAILURES) {
          throw refused ? err : new ApiError('Upload failed. Check your connection and try again.', 0);
        }
        await sleep(Math.min(500 * 2 ** failures, 15000));
        const status = await api.get(`/api/uploads/${uploadId}`).catch(() => null);
        if (status) offset = status.received;
      }
    }
  }

  function cancel() {
    cancelled = true;
    xhr?.abort();
    if (uploadId) api.del(`/api/uploads/${uploadId}`).catch(() => {});
  }

  return { promise: run(), cancel };
}
