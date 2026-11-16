// Opencord on Cloudflare. The page, scripts and styles are static assets (served before this runs). This Worker
// only sees /api, /media and /live, hands them to the Hub, and streams stored files straight from their shard.
import { FILE_MARKER, shardStub } from './storage.js';

export { Hub } from './hub.js';
export { FileShard } from './files.js';

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
});

export default {
  async fetch(request, env) {
    const hub = env.HUB.get(env.HUB.idFromName('hub'));
    const response = await hub.fetch(request);
    const path = response.headers.get(FILE_MARKER);
    if (!path) return response;

    // The Hub said who may see it; now send the bytes, honouring Range for seeking in video and audio.
    const headers = new Headers(response.headers);
    headers.delete(FILE_MARKER);
    headers.set('Accept-Ranges', 'bytes');
    const file = await shardStub(env, path).read(path, request.headers.get('Range'));
    if (!file) return json(404, { error: 'File not found.' }, Object.fromEntries(headers));
    if (file.status === 416) {
      headers.set('Content-Range', `bytes */${file.size}`);
      headers.set('Content-Type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify({ error: 'That range is outside the file.' }), { status: 416, headers });
    }
    headers.set('Content-Length', String(file.size ? file.end - file.start + 1 : 0));
    if (file.status === 206) headers.set('Content-Range', `bytes ${file.start}-${file.end}/${file.size}`);
    if (request.method === 'HEAD') {
      await file.stream.cancel();
      return new Response(null, { status: file.status, headers });
    }
    return new Response(file.stream, { status: file.status, headers });
  },
};
