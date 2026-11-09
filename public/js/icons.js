// Line icons drawn on a 24×24 grid. Built with DOM calls, never innerHTML.
const PATHS = {
  logo: 'M12 3a9 9 0 1 0 5.2 16.3L21 21l-1.3-4.2A9 9 0 0 0 12 3z',
  hash: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  settings: 'M4 7h9m4 0h3M4 17h3m4 0h9M15 5v4M9 15v4',
  paperclip: 'M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9',
  send: 'M4 12l16-8-6 16-3-7-7-1z',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5',
  back: 'M15 5l-7 7 7 7',
  users: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.9M15.5 3.2a3.5 3.5 0 0 1 0 6.6',
  userPlus: 'M15 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M16 11h6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  chevronDown: 'M6 9l6 6 6-6',
  message: 'M4 5h16v11H9l-5 4z',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5',
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
};

const SVG = 'http://www.w3.org/2000/svg';

export function icon(name, size = 20) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  if (name === 'more') svg.classList.add('icon-dots');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}
