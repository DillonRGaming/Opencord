// A game inside a chat message (chess, tic-tac-toe, Connect Four, rock paper scissors). Everyone sees the board
// live; only the two players can touch it, and the server checks every move.
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { attempt, avatar } from '../ui.js';

const nameOf = (id) => (id === state.me.id ? 'You' : state.users.get(id)?.displayName || 'Someone');
const move = (message, body) => attempt(() => api.post(`/api/messages/${message.id}/game`, body));

// Which square is picked on each chess board, by message id, so a redraw (someone else's move) keeps it.
const picked = new Map();

const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
const FILES = 'abcdefgh';
const sqName = (i) => `${FILES[i % 8]}${8 - Math.floor(i / 8)}`;

function chessBoard(message, game, seat) {
  const flip = seat === 1; // black sees their pieces at the bottom
  const myTurn = !game.over && seat === game.turn;
  const from = picked.get(message.id) ?? null;
  const targets = new Set(from === null ? [] : game.legal.filter((m) => m.startsWith(sqName(from))).map((m) => m.slice(2, 4)));
  const mineColor = seat === 0 ? 'w' : 'b';
  const kingInCheck = game.check ? game.board.indexOf(`${game.color}K`) : -1;
  const board = h('div', { class: `chess-board${flip ? ' flipped' : ''}`, role: 'grid', 'aria-label': 'Chess board' });
  const promotionRow = (fromSq, toSq) => h('div', { class: 'chess-promote' }, h('span', {}, 'Promote to'),
    ['q', 'r', 'b', 'n'].map((p) => h('button', {
      type: 'button', class: 'chess-promote-piece', onclick: () => { picked.delete(message.id); move(message, { move: `${fromSq}${toSq}${p}` }); },
    }, `${GLYPH[p.toUpperCase()]}︎`)));
  let promoteBox = null;
  for (let k = 0; k < 64; k += 1) {
    const i = flip ? 63 - k : k;
    const piece = game.board[i];
    const name = sqName(i);
    const dark = (Math.floor(i / 8) + (i % 8)) % 2 === 1;
    const classes = ['chess-sq', dark ? 'dark' : 'light', from === i && 'picked', targets.has(name) && (piece ? 'capture' : 'target'),
      game.last?.includes(i) && 'last', i === kingInCheck && 'check'];
    const cell = h('button', {
      type: 'button', class: classes.filter(Boolean).join(' '), 'aria-label': `${name}${piece ? ` ${piece[0] === 'w' ? 'white' : 'black'} ${piece[1]}` : ''}`,
      disabled: !myTurn,
      onclick: () => {
        if (from !== null && targets.has(name)) {
          const fromSq = sqName(from);
          const promoting = game.board[from][1] === 'P' && (name[1] === '8' || name[1] === '1');
          if (promoting) {
            promoteBox?.remove();
            promoteBox = promotionRow(fromSq, name);
            board.after(promoteBox);
            return;
          }
          picked.delete(message.id);
          move(message, { move: `${fromSq}${name}` });
          return;
        }
        if (piece?.[0] === mineColor && game.legal.some((m) => m.startsWith(name))) picked.set(message.id, i);
        else picked.delete(message.id);
        redraw(board, message, game, seat);
      },
    }, piece && h('span', { class: `chess-piece ${piece[0]}` }, `${GLYPH[piece[1]]}︎`));
    // Coordinates along the bottom and left edges.
    if (k % 8 === 0) cell.append(h('span', { class: 'chess-rank' }, name[1]));
    if (k >= 56) cell.append(h('span', { class: 'chess-file' }, name[0]));
    board.append(cell);
  }
  const taken = (color) => h('div', { class: 'chess-taken' }, (game.taken || []).filter((p) => p[0] === color).map((p) => h('span', { class: `chess-piece ${color}` }, `${GLYPH[p[1]]}︎`)));
  return h('div', { class: 'chess-wrap' }, taken(flip ? 'b' : 'w'), board, taken(flip ? 'w' : 'b'));
}

function redraw(board, message, game, seat) {
  board.closest('.game-card')?.replaceWith(gameView({ ...message, game }));
}

function gridGame(message, game, seat, cols, cellFace, onPick) {
  const myTurn = !game.over && seat === game.turn;
  return h('div', { class: `game-grid cols-${cols}` }, game.cells.map((cell, i) => h('button', {
    type: 'button', class: `game-cell${game.line?.includes(i) ? ' win' : ''}${game.last === i ? ' last' : ''}`,
    disabled: !myTurn || (cols === 3 && cell !== null), 'aria-label': `Square ${i + 1}`,
    onclick: () => onPick(i),
  }, cellFace(cell))));
}

const RPS = { rock: '✊', paper: '✋', scissors: '✌️' };

function rpsView(message, game, seat) {
  const rounds = h('div', { class: 'rps-rounds' }, game.rounds.map((r, n) => h('div', { class: 'rps-round' },
    h('span', { class: 'muted' }, `Round ${n + 1}`), h('span', { class: 'rps-hands' }, RPS[r.picks[0]], ' vs ', RPS[r.picks[1]]),
    h('span', {}, r.won === null ? 'Tie' : `${nameOf(game.players[r.won])} won`))));
  const canPick = !game.over && seat !== -1 && !game.picked[seat];
  return h('div', { class: 'rps' },
    h('div', { class: 'rps-score' }, `${game.score[0]} – ${game.score[1]}`),
    rounds,
    !game.over && h('div', { class: 'rps-pick' }, Object.entries(RPS).map(([key, hand]) => h('button', {
      type: 'button', class: 'rps-hand', disabled: !canPick, title: key,
      onclick: () => move(message, { move: key }),
    }, hand, h('span', {}, key)))),
    !game.over && h('p', { class: 'muted rps-wait' }, game.players.map((id, i) => (id ? `${nameOf(id)}: ${game.picked[i] ? 'picked ✓' : 'thinking…'}` : 'Waiting for a player')).join(' · ')));
}

function statusLine(game, seat) {
  const b = game.players[1];
  if (game.over) {
    if (game.winner === null || game.winner === undefined) return `It’s a draw${game.reason ? ` (${game.reason})` : ''}.`;
    const who = nameOf(game.players[game.winner]);
    return `${who} ${who === 'You' ? 'win' : 'wins'}${game.reason ? ` by ${game.reason === 'resigned' ? 'resignation' : game.reason}` : ''}! 🎉`;
  }
  if (!b) return seat === 0 ? (game.turn === 0 ? 'Your move. Anyone can join after.' : 'Waiting for someone to join…') : (game.turn === 1 ? 'Open game: make a move to join!' : 'Open game, waiting for the first move.');
  if (game.kind === 'rps') return 'Pick a hand. Best of 3.';
  const turnId = game.players[game.turn];
  const check = game.check ? ' Check!' : '';
  return turnId === state.me.id ? `Your turn.${check}` : `${nameOf(turnId)}’s turn.${check}`;
}

export function gameView(message) {
  const { game } = message;
  const mine = game.players.indexOf(state.me.id);
  // Someone watching an open game can take the empty seat by playing.
  const seat = mine !== -1 ? mine : !game.players[1] ? 1 : -1;
  let board;
  if (game.kind === 'chess') board = chessBoard(message, game, seat);
  else if (game.kind === 'tictactoe') board = gridGame(message, game, seat, 3, (c) => (c === null ? '' : c === 0 ? '✕' : '◯'), (i) => move(message, { move: i }));
  else if (game.kind === 'connect4') board = gridGame(message, game, seat, 7, (c) => h('span', { class: `c4-disc${c === null ? '' : c === 0 ? ' red' : ' yellow'}` }), (i) => move(message, { move: i % 7 }));
  else board = rpsView(message, game, seat);

  const sides = game.kind === 'chess' ? ['White', 'Black'] : game.kind === 'tictactoe' ? ['✕', '◯'] : game.kind === 'connect4' ? ['Red', 'Yellow'] : ['', ''];
  const player = (id, i) => h('div', { class: `game-player${!game.over && game.turn === i && game.players[1] ? ' turn' : ''}${game.winner === i ? ' winner' : ''}` },
    id ? avatar(state.users.get(id) || { id, displayName: 'Player' }, { size: 22 }) : h('span', { class: 'game-empty-seat' }, '?'),
    h('span', {}, id ? nameOf(id) : 'Open seat'), sides[i] && h('span', { class: 'game-side' }, sides[i]));
  const playing = mine !== -1 && !game.over;
  return h('div', { class: `game-card game-${game.kind}` },
    h('div', { class: 'game-head' }, icon('gamepad', 16), h('strong', {}, game.name),
      h('div', { class: 'game-players' }, player(game.players[0], 0), h('span', { class: 'muted' }, 'vs'), player(game.players[1], 1))),
    board,
    h('div', { class: 'game-foot' }, h('span', { class: 'game-status' }, statusLine(game, seat)),
      playing && game.players[1] && h('button', { type: 'button', class: 'button ghost small', onclick: () => move(message, { resign: true }) }, icon('flag', 14), 'Resign'),
      game.over && mine !== -1 && h('button', {
        type: 'button', class: 'button accent small',
        onclick: () => attempt(() => api.post(`/api/channels/${message.channelId}/games`, { game: game.kind, opponentId: game.players[1 - seat] || null })),
      }, icon('refresh', 14), 'Rematch')));
}
