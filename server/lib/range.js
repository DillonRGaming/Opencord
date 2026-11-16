// Parses an HTTP Range header for one range of a file of `size` bytes.
// Returns [start, end] (inclusive), null when there's no usable Range (send the whole file), or 'invalid'.
function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (!match[1] && !match[2])) return null; // several ranges or junk: send it all
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!suffix) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return 'invalid';
  return [start, end];
}

module.exports = { parseRange };
