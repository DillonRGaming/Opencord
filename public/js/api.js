export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

let onUnauthorized = null;

// Called when a logged-in session stops being valid (logged out elsewhere, password changed).
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(method, url, body, raw = false) {
  const init = { method, headers: {} };
  if (raw) {
    init.body = body;
    init.headers['Content-Type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(data?.error || `Something went wrong (${res.status}).`, res.status, data);
  }
  return data;
}

export const get = (url) => request('GET', url);
export const post = (url, body = {}) => request('POST', url, body);
export const patch = (url, body) => request('PATCH', url, body);
export const put = (url, body = {}) => request('PUT', url, body);
export const del = (url) => request('DELETE', url);
export const putFile = (url, file) => request('PUT', url, file, true);
