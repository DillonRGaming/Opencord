// Games played inside a chat message: /chess @someone, /tictactoe, /connect4, /rps. The server keeps the rules,
// so only the two players can move, only on their turn, and only legal moves count. Each game is
//   init() → state, move(state, seat, move) → state (throws on a bad move), view(state) → what everyone sees.
// Every state has { turn: 0|1, over: bool, winner: 0|1|null (null + over = draw), last }.

class MoveError extends Error {}
const bad = (message) => { throw new MoveError(message); };

// --- tic-tac-toe ---

const LINES3 = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const tictactoe = {
  name: 'Tic-tac-toe',
  init: () => ({ cells: Array(9).fill(null), turn: 0, over: false, winner: null, line: null }),
  move(s, seat, move) {
    const i = Number(move);
    if (!Number.isInteger(i) || i < 0 || i > 8 || s.cells[i] !== null) bad('That square is taken.');
    const cells = [...s.cells];
    cells[i] = seat;
    const line = LINES3.find((l) => l.every((c) => cells[c] === seat)) || null;
    const full = cells.every((c) => c !== null);
    return { cells, turn: 1 - seat, over: Boolean(line) || full, winner: line ? seat : null, line, last: i };
  },
  view: (s) => s,
};

// --- connect four (7 columns × 6 rows, row 0 at the top) ---

const C4W = 7;
const C4H = 6;
function fourFrom(cells, at, seat) {
  const r0 = Math.floor(at / C4W);
  const c0 = at % C4W;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [at];
    for (const dir of [1, -1]) {
      for (let k = 1; k < 4; k += 1) {
        const r = r0 + dr * k * dir;
        const c = c0 + dc * k * dir;
        if (r < 0 || r >= C4H || c < 0 || c >= C4W || cells[r * C4W + c] !== seat) break;
        line.push(r * C4W + c);
      }
    }
    if (line.length >= 4) return line;
  }
  return null;
}
const connect4 = {
  name: 'Connect Four',
  init: () => ({ cells: Array(C4W * C4H).fill(null), turn: 0, over: false, winner: null, line: null }),
  move(s, seat, move) {
    const col = Number(move);
    if (!Number.isInteger(col) || col < 0 || col >= C4W) bad('Pick a column.');
    let row = C4H - 1;
    while (row >= 0 && s.cells[row * C4W + col] !== null) row -= 1;
    if (row < 0) bad('That column is full.');
    const cells = [...s.cells];
    const at = row * C4W + col;
    cells[at] = seat;
    const line = fourFrom(cells, at, seat);
    const full = cells.every((c) => c !== null);
    return { cells, turn: 1 - seat, over: Boolean(line) || full, winner: line ? seat : null, line, last: at };
  },
  view: (s) => s,
};

// --- rock paper scissors (best of 3; picks stay hidden until both have picked) ---

const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const rps = {
  name: 'Rock paper scissors',
  init: () => ({ picks: [null, null], rounds: [], score: [0, 0], turn: null, over: false, winner: null }),
  move(s, seat, move) {
    if (!BEATS[move]) bad('Pick rock, paper or scissors.');
    if (s.picks[seat]) bad('You already picked. Waiting for the other player.');
    const picks = [...s.picks];
    picks[seat] = move;
    if (!picks[0] || !picks[1]) return { ...s, picks };
    const won = picks[0] === picks[1] ? null : BEATS[picks[0]] === picks[1] ? 0 : 1;
    const score = [...s.score];
    if (won !== null) score[won] += 1;
    const over = score[0] === 2 || score[1] === 2;
    return { picks: [null, null], rounds: [...s.rounds, { picks, won }], score, turn: null, over, winner: over ? (score[0] === 2 ? 0 : 1) : null };
  },
  // Only whether each side has picked is public.
  view: (s) => ({ ...s, picks: undefined, picked: s.picks.map(Boolean) }),
};

// --- chess ---
// Board: 64 squares, a8 = 0 … h1 = 63; pieces are 'wK', 'bP' …; moves are "e2e4" (+ "q|r|b|n" to promote).

const FILES = 'abcdefgh';
const sq = (name) => FILES.indexOf(name[0]) + (8 - Number(name[1])) * 8;
const nameOf = (i) => `${FILES[i % 8]}${8 - Math.floor(i / 8)}`;
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

function boardFrom(placement) {
  const board = [];
  for (const ch of placement.replace(/\//g, '')) {
    if (/\d/.test(ch)) board.push(...Array(Number(ch)).fill(null));
    else board.push((ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase());
  }
  return board;
}

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

function attacked(board, at, by) {
  const r0 = Math.floor(at / 8);
  const c0 = at % 8;
  const piece = (r, c) => (r >= 0 && r < 8 && c >= 0 && c < 8 ? board[r * 8 + c] : undefined);
  const pawnRow = by === 'w' ? r0 + 1 : r0 - 1;
  if (piece(pawnRow, c0 - 1) === `${by}P` || piece(pawnRow, c0 + 1) === `${by}P`) return true;
  if (KNIGHT.some(([dr, dc]) => piece(r0 + dr, c0 + dc) === `${by}N`)) return true;
  if (KING.some(([dr, dc]) => piece(r0 + dr, c0 + dc) === `${by}K`)) return true;
  for (const [dirs, kinds] of [[ROOK, ['R', 'Q']], [BISHOP, ['B', 'Q']]]) {
    for (const [dr, dc] of dirs) {
      for (let k = 1; k < 8; k += 1) {
        const p = piece(r0 + dr * k, c0 + dc * k);
        if (p === undefined) break;
        if (p) {
          if (p[0] === by && kinds.includes(p[1])) return true;
          break;
        }
      }
    }
  }
  return false;
}

// Every move that obeys how the pieces move, before checking whether it leaves your own king in check.
function pseudoMoves(s) {
  const { board, color } = s;
  const out = [];
  const enemy = color === 'w' ? 'b' : 'w';
  for (let from = 0; from < 64; from += 1) {
    const p = board[from];
    if (!p || p[0] !== color) continue;
    const r0 = Math.floor(from / 8);
    const c0 = from % 8;
    const add = (r, c, opts = {}) => out.push({ from, to: r * 8 + c, ...opts });
    const free = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8 && !board[r * 8 + c];
    const foe = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c]?.[0] === enemy;
    switch (p[1]) {
      case 'P': {
        const dir = color === 'w' ? -1 : 1;
        const startRow = color === 'w' ? 6 : 1;
        const lastRow = color === 'w' ? 0 : 7;
        const promo = (r) => (r === lastRow ? { promote: true } : {});
        if (free(r0 + dir, c0)) {
          add(r0 + dir, c0, promo(r0 + dir));
          if (r0 === startRow && free(r0 + 2 * dir, c0)) add(r0 + 2 * dir, c0, { double: true });
        }
        for (const dc of [-1, 1]) {
          if (foe(r0 + dir, c0 + dc)) add(r0 + dir, c0 + dc, promo(r0 + dir));
          else if (s.ep !== null && (r0 + dir) * 8 + c0 + dc === s.ep && c0 + dc >= 0 && c0 + dc < 8) add(r0 + dir, c0 + dc, { enPassant: true });
        }
        break;
      }
      case 'N':
        for (const [dr, dc] of KNIGHT) if (free(r0 + dr, c0 + dc) || foe(r0 + dr, c0 + dc)) add(r0 + dr, c0 + dc);
        break;
      case 'K': {
        for (const [dr, dc] of KING) if (free(r0 + dr, c0 + dc) || foe(r0 + dr, c0 + dc)) add(r0 + dr, c0 + dc);
        const home = color === 'w' ? 60 : 4;
        if (from === home && !attacked(board, home, enemy)) {
          const rights = color === 'w' ? s.castle.replace(/[a-z]/g, '') : s.castle.replace(/[A-Z]/g, '').toUpperCase();
          if (rights.includes('K') && !board[home + 1] && !board[home + 2] && board[home + 3] === `${color}R`
            && !attacked(board, home + 1, enemy)) add(r0, c0 + 2, { castle: 'K' });
          if (rights.includes('Q') && !board[home - 1] && !board[home - 2] && !board[home - 3] && board[home - 4] === `${color}R`
            && !attacked(board, home - 1, enemy)) add(r0, c0 - 2, { castle: 'Q' });
        }
        break;
      }
      default: {
        const dirs = p[1] === 'R' ? ROOK : p[1] === 'B' ? BISHOP : [...ROOK, ...BISHOP];
        for (const [dr, dc] of dirs) {
          for (let k = 1; k < 8; k += 1) {
            const r = r0 + dr * k;
            const c = c0 + dc * k;
            if (free(r, c)) add(r, c);
            else { if (foe(r, c)) add(r, c); break; }
          }
        }
      }
    }
  }
  return out;
}

function applyChess(s, m, promoteTo = 'Q') {
  const board = [...s.board];
  const piece = board[m.from];
  const color = piece[0];
  const captured = m.enPassant ? board[m.to + (color === 'w' ? 8 : -8)] : board[m.to];
  board[m.to] = m.promote ? `${color}${promoteTo}` : piece;
  board[m.from] = null;
  if (m.enPassant) board[m.to + (color === 'w' ? 8 : -8)] = null;
  if (m.castle) {
    const rookFrom = m.castle === 'K' ? m.to + 1 : m.to - 2;
    const rookTo = m.castle === 'K' ? m.to - 1 : m.to + 1;
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  }
  // Moving a king or rook, or capturing a rook on its corner, ends those castling rights.
  let { castle } = s;
  const drop = (letters) => { castle = castle.replace(new RegExp(`[${letters}]`, 'g'), ''); };
  if (piece[1] === 'K') drop(color === 'w' ? 'KQ' : 'kq');
  for (const [corner, letter] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']]) if (m.from === corner || m.to === corner) drop(letter);
  return {
    board, castle, color: color === 'w' ? 'b' : 'w', ep: m.double ? (m.from + m.to) / 2 : null,
    half: piece[1] === 'P' || captured ? 0 : s.half + 1, captured,
  };
}

function legalMoves(s) {
  return pseudoMoves(s).filter((m) => {
    const next = applyChess(s, m);
    const king = next.board.indexOf(`${s.color}K`);
    return !attacked(next.board, king, next.color);
  });
}

const chess = {
  name: 'Chess',
  init: () => ({ board: boardFrom(START), color: 'w', castle: 'KQkq', ep: null, half: 0, turn: 0, over: false, winner: null, history: [], taken: [], check: false }),
  move(s, seat, move) {
    const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(String(move));
    if (!m) bad('Moves look like e2e4.');
    const from = sq(m[1]);
    const to = sq(m[2]);
    const found = legalMoves(s).find((x) => x.from === from && x.to === to);
    if (!found) bad('That move isn’t allowed.');
    const next = applyChess(s, found, (m[3] || 'q').toUpperCase());
    const moves = legalMoves(next);
    const check = attacked(next.board, next.board.indexOf(`${next.color}K`), s.color);
    const mate = !moves.length && check;
    const stale = !moves.length && !check;
    const fifty = next.half >= 100;
    const onlyKings = next.board.filter(Boolean).every((p) => p[1] === 'K');
    return {
      board: next.board, color: next.color, castle: next.castle, ep: next.ep, half: next.half,
      turn: 1 - seat, check, over: mate || stale || fifty || onlyKings, winner: mate ? seat : null,
      reason: mate ? 'checkmate' : stale ? 'stalemate' : fifty ? 'fifty-move rule' : onlyKings ? 'only kings left' : null,
      history: [...s.history, `${m[1]}${m[2]}${m[3] || ''}`], taken: next.captured ? [...s.taken, next.captured] : s.taken,
      last: [from, to],
    };
  },
  // Players' boards only offer legal moves, so the client needs the list for whoever is to move.
  view: (s) => ({ ...s, legal: s.over ? [] : legalMoves(s).map((m) => `${nameOf(m.from)}${nameOf(m.to)}`) }),
};

const GAMES = { chess, tictactoe, connect4, rps };

module.exports = { GAMES, MoveError };
