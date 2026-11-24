import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { formatStamp } from '../format.js';
import { attempt, button, field, form, iconButton, segmented, settingRow, settingsCard } from '../ui.js';
import { openPage } from './page.js';

const LENGTHS = [[1, '1 hour'], [24, '1 day'], [72, '3 days'], [168, '1 week'], [0, 'No end']];

// The poll maker: a question, 2–10 answers, one or many picks, how long it runs.
export function openPoll(channel) {
  let multi = false;
  let closesIn = 24;
  const question = h('input', { class: 'input', required: true, maxLength: 300, placeholder: 'What should we play tonight?' });
  const list = h('div', { class: 'poll-options-edit' });
  const addRow = (value = '') => {
    if (list.children.length >= 10) return;
    const input = h('input', { class: 'input', maxLength: 100, value, placeholder: `Answer ${list.children.length + 1}` });
    const row = h('div', { class: 'poll-option-edit' }, input, iconButton('x', 'Remove answer', () => { if (list.children.length > 2) row.remove(); }));
    list.append(row);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && row === list.lastChild && input.value.trim()) {
        event.preventDefault();
        addRow();
        list.lastChild.querySelector('input').focus();
      }
    });
  };
  addRow();
  addRow();

  const page = openPage({
    title: 'New poll',
    icon: 'bars',
    content: h('div', { class: 'settings-content' },
      settingsCard('Poll', form({
        submitLabel: 'Post poll',
        onSubmit: async () => {
          const options = [...list.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
          if (options.length < 2) throw new Error('Add at least 2 answers.');
          await api.post(`/api/channels/${channel.id}/polls`, { question: question.value, options, multi, closesIn });
          page.close();
        },
      }, field('Question', question),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Answers'), list,
        h('div', {}, button('Add answer', () => addRow(), 'ghost small'))),
      settingRow('People can pick', segmented([[false, 'One answer'], [true, 'Several']], multi, (v) => { multi = v; })),
      settingRow('Runs for', segmented(LENGTHS, closesIn, (v) => { closesIn = v; }))))),
  });
}

// A poll inside a message: each answer is a button with a bar showing its share of the votes.
export function pollView(message, onVote) {
  const { poll } = message;
  const total = poll.options.reduce((n, o) => n + o.userIds.length, 0);
  const voters = new Set(poll.options.flatMap((o) => o.userIds)).size;
  const closed = poll.closesAt && poll.closesAt <= Date.now();
  const top = Math.max(...poll.options.map((o) => o.userIds.length));
  return h('div', { class: `poll${closed ? ' closed' : ''}` },
    h('div', { class: 'poll-question' }, poll.question),
    h('div', { class: 'poll-hint' }, closed ? 'Poll closed' : poll.multi ? 'Pick as many as you like' : 'Pick one'),
    h('div', { class: 'poll-options' }, poll.options.map((option, index) => {
      const mine = option.userIds.includes(state.me.id);
      const share = total ? Math.round((option.userIds.length / total) * 100) : 0;
      const names = option.userIds.map((id) => state.users.get(id)?.displayName).filter(Boolean);
      return h('button', {
        type: 'button', class: `poll-option${mine ? ' mine' : ''}${closed && option.userIds.length === top && top > 0 ? ' winner' : ''}`,
        disabled: closed, title: names.length ? names.join(', ') : 'No votes yet',
        onclick: (event) => { event.stopPropagation(); attempt(() => onVote(message, index)); },
      }, h('span', { class: 'poll-fill', style: { width: `${share}%` } }),
      h('span', { class: 'poll-check' }, mine && icon('check', 14)),
      h('span', { class: 'poll-text' }, option.text),
      h('span', { class: 'poll-count' }, `${share}%`));
    })),
    h('div', { class: 'poll-footer' }, `${voters} ${voters === 1 ? 'vote' : 'votes'}`,
      poll.closesAt && ` · ${closed ? 'ended' : 'ends'} ${formatStamp(poll.closesAt)}`));
}
