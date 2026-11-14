// Slash commands typed in the message box. Each one either changes the message before it's sent
// (/shrug, /me…) or does something instead of sending (/poll, /ban, /clear…).
import * as api from './api.js';
import { state, canModerate } from './store.js';
import { copyText, toast } from './ui.js';
import { parseWhen, stampCode } from './markdown.js';

const TIMEOUTS = { '1m': 60, '5m': 300, '10m': 600, '1h': 3600, '1d': 86400, '1w': 604800 };

export const COMMANDS = [
  { name: 'poll', usage: 'question | option | option…', about: 'Start a poll. Just /poll opens the poll maker' },
  { name: 'shrug', usage: '[message]', about: 'Adds ¯\\_(ツ)_/¯' },
  { name: 'tableflip', usage: '[message]', about: 'Adds (╯°□°)╯︵ ┻━┻' },
  { name: 'unflip', usage: '[message]', about: 'Adds ┬─┬ノ( º _ ºノ)' },
  { name: 'me', usage: 'action', about: 'Says it as an action, in italics' },
  { name: 'spoiler', usage: 'message', about: 'Hides the message until clicked' },
  { name: 'time', usage: 'in 2h | tomorrow 8pm | 20:30 | 2026-11-20 19:00', about: 'Posts a time that shows in everyone’s own time zone' },
  { name: 'invite', usage: '', about: 'Makes an invite link and copies it', server: true },
  { name: 'kick', usage: '@user [reason]', about: 'Removes someone from the server', mod: true },
  { name: 'ban', usage: '@user [reason]', about: 'Bans someone from the server', mod: true },
  { name: 'unban', usage: '@user', about: 'Lets a banned person back in', mod: true },
  { name: 'timeout', usage: '@user 1m|5m|10m|1h|1d|1w [reason]', about: 'Stops someone posting for a while', mod: true },
  { name: 'untimeout', usage: '@user', about: 'Ends a timeout early', mod: true },
  { name: 'clear', usage: 'number', about: 'Deletes the newest messages here (up to 100)', mod: true },
  { name: 'slowmode', usage: 'seconds|off', about: 'Sets slowmode for this channel', mod: true },
  { name: 'lock', usage: '', about: 'Only admins can post here', mod: true },
  { name: 'unlock', usage: '', about: 'Everyone can post here again', mod: true },
  { name: 'topic', usage: 'text', about: 'Changes this channel’s topic', mod: true },
];

// Commands that make sense in this channel for this person.
export function availableCommands(channel) {
  return COMMANDS.filter((c) => (!c.server && !c.mod) || (channel.serverId && (!c.mod || canModerate(channel.serverId))));
}

function memberByName(channel, name) {
  const clean = name.replace(/^@/, '').toLowerCase();
  return (state.members.get(channel.serverId) || []).find((m) => m.user.username === clean)?.user || null;
}

function need(condition, message) {
  if (!condition) throw new Error(message);
}

// Returns { send: text } to send a (changed) message, { done: true } when handled, or null if not a command.
export async function runCommand(channel, raw, { openPoll } = {}) {
  const m = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(raw.trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  const args = (m[2] || '').trim();
  const command = availableCommands(channel).find((c) => c.name === name);
  if (!command) {
    if (COMMANDS.some((c) => c.name === name)) throw new Error(`/${name} only works for admins in a server.`);
    return null; // not ours: send as typed
  }
  const words = args.split(/\s+/).filter(Boolean);
  const target = () => {
    need(words[0], `Who? Use /${name} @username.`);
    const user = memberByName(channel, words[0]);
    need(user, `${words[0]} isn't in this server.`);
    return user;
  };
  const sid = channel.serverId;

  if (name === 'time') {
    const ms = parseWhen(args);
    need(ms !== null, 'Try /time in 2h, /time tomorrow 8pm, /time 20:30 or /time 2026-11-20 19:00.');
    return { send: `${stampCode(ms, 'F')} (${stampCode(ms, 'R')})` };
  }
  switch (name) {
    case 'shrug': return { send: `${args} ¯\\\\\\_(ツ)\\_/¯`.trim() };
    case 'tableflip': return { send: `${args} (╯°□°)╯︵ ┻━┻`.trim() };
    case 'unflip': return { send: `${args} ┬─┬ノ( º _ ºノ)`.trim() };
    case 'me': need(args, 'Type an action after /me.'); return { send: `_${args}_` };
    case 'spoiler': need(args, 'Type a message after /spoiler.'); return { send: `||${args}||` };
    case 'poll': {
      if (!args) { openPoll?.(); return { done: true }; }
      const parts = args.split('|').map((p) => p.trim()).filter(Boolean);
      need(parts.length >= 3, 'Write it as /poll question | option | option.');
      await api.post(`/api/channels/${channel.id}/polls`, { question: parts[0], options: parts.slice(1, 11) });
      return { done: true };
    }
    case 'invite': {
      const invite = await api.post(`/api/servers/${sid}/invites`, {});
      await copyText(`${location.origin}/invite/${invite.code}`);
      toast('Invite link copied.', 'ok');
      return { done: true };
    }
    case 'kick': {
      const user = target();
      await api.del(`/api/servers/${sid}/members/${user.id}`, { reason: words.slice(1).join(' ') });
      toast(`${user.displayName} was kicked.`, 'ok');
      return { done: true };
    }
    case 'ban': {
      const user = target();
      await api.put(`/api/servers/${sid}/bans/${user.id}`, { reason: words.slice(1).join(' ') });
      toast(`${user.displayName} is banned.`, 'ok');
      return { done: true };
    }
    case 'unban': {
      need(words[0], 'Who? Use /unban @username.');
      const bans = await api.get(`/api/servers/${sid}/bans`);
      const ban = bans.find((b) => b.user.username === words[0].replace(/^@/, '').toLowerCase());
      need(ban, `${words[0]} isn't banned here.`);
      await api.del(`/api/servers/${sid}/bans/${ban.user.id}`);
      toast(`${ban.user.displayName} can join again.`, 'ok');
      return { done: true };
    }
    case 'timeout': {
      const user = target();
      const seconds = TIMEOUTS[(words[1] || '10m').toLowerCase()];
      need(seconds, 'Pick a length: 1m, 5m, 10m, 1h, 1d or 1w.');
      await api.put(`/api/servers/${sid}/members/${user.id}/timeout`, { seconds, reason: words.slice(2).join(' ') });
      toast(`${user.displayName} is timed out for ${words[1] || '10m'}.`, 'ok');
      return { done: true };
    }
    case 'untimeout': {
      const user = target();
      await api.put(`/api/servers/${sid}/members/${user.id}/timeout`, { seconds: 0 });
      toast(`${user.displayName}'s timeout is over.`, 'ok');
      return { done: true };
    }
    case 'clear': {
      const count = Number(words[0]);
      need(Number.isInteger(count) && count >= 1 && count <= 100, 'Use /clear and a number from 1 to 100.');
      const { deleted } = await api.post(`/api/channels/${channel.id}/purge`, { count });
      toast(`Cleared ${deleted} message${deleted === 1 ? '' : 's'}.`, 'ok');
      return { done: true };
    }
    case 'slowmode': {
      const seconds = words[0] === 'off' ? 0 : Number(words[0]);
      need(Number.isInteger(seconds) && seconds >= 0 && seconds <= 21600, 'Use /slowmode and seconds (0–21600), or off.');
      await api.patch(`/api/channels/${channel.id}`, { slowmode: seconds });
      toast(seconds ? `Slowmode is ${seconds}s.` : 'Slowmode is off.', 'ok');
      return { done: true };
    }
    case 'lock':
    case 'unlock':
      await api.patch(`/api/channels/${channel.id}`, { readOnly: name === 'lock' });
      toast(name === 'lock' ? 'Channel locked.' : 'Channel unlocked.', 'ok');
      return { done: true };
    case 'topic':
      await api.patch(`/api/channels/${channel.id}`, { topic: args });
      toast('Topic changed.', 'ok');
      return { done: true };
    default:
      return null;
  }
}
