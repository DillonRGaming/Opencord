class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function fail(status, message, extra) {
  throw new HttpError(status, message, extra);
}

// Validates a string from a request body and returns it (trimmed unless told otherwise).
function text(value, label, { min = 0, max = Infinity, trim = true } = {}) {
  if (typeof value !== 'string') fail(400, `${label} is required.`);
  const out = trim ? value.trim() : value;
  if (out.length < min) {
    fail(400, min === 1 ? `${label} can't be empty.` : `${label} must be at least ${min} characters.`);
  }
  if (out.length > max) fail(400, `${label} must be at most ${max} characters.`);
  return out;
}

module.exports = { HttpError, fail, text };
