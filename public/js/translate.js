// Translating messages: by hand from a message's tools (pick the languages, or let it detect), or
// automatically for every message in another language when "Translate automatically" is on.
import * as api from './api.js';
import { state } from './store.js';

export const LANGUAGES = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'],
  ['nl', 'Dutch'], ['pl', 'Polish'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['tr', 'Turkish'], ['ar', 'Arabic'],
  ['he', 'Hebrew'], ['hi', 'Hindi'], ['bn', 'Bengali'], ['ur', 'Urdu'], ['fa', 'Persian'], ['zh-CN', 'Chinese (Simplified)'],
  ['zh-TW', 'Chinese (Traditional)'], ['ja', 'Japanese'], ['ko', 'Korean'], ['vi', 'Vietnamese'], ['th', 'Thai'],
  ['id', 'Indonesian'], ['ms', 'Malay'], ['tl', 'Filipino'], ['sv', 'Swedish'], ['no', 'Norwegian'], ['da', 'Danish'],
  ['fi', 'Finnish'], ['cs', 'Czech'], ['sk', 'Slovak'], ['hu', 'Hungarian'], ['ro', 'Romanian'], ['bg', 'Bulgarian'],
  ['el', 'Greek'], ['sr', 'Serbian'], ['hr', 'Croatian'], ['lt', 'Lithuanian'], ['lv', 'Latvian'], ['et', 'Estonian'],
  ['sw', 'Swahili'], ['af', 'Afrikaans'], ['ga', 'Irish'], ['cy', 'Welsh'], ['ca', 'Catalan'], ['eu', 'Basque'],
];

export const languageName = (code) => LANGUAGES.find(([c]) => c === code || c.split('-')[0] === code)?.[1] || code;

// The language to translate into: the setting, else the browser's language.
export function targetLanguage() {
  const chosen = state.me?.settings?.translateTo;
  if (chosen) return chosen;
  const nav = (navigator.language || 'en').split('-')[0];
  return LANGUAGES.some(([c]) => c === nav) ? nav : 'en';
}

export const autoTranslateOn = () => Boolean(state.me?.settings?.translateAuto);

const cache = new Map(); // "from|to|text" → Promise<{ text, detected }>

// Translations asked for within a moment of each other go to the server together.
let batch = null;
function flush() {
  const { from, to, items } = batch;
  batch = null;
  for (let i = 0; i < items.length; i += 25) {
    const part = items.slice(i, i + 25);
    api.post('/api/translate', { texts: part.map((p) => p.text), from, to })
      .then((results) => part.forEach((p, j) => p.resolve(results[j])))
      .catch((err) => part.forEach((p) => p.reject(err)));
  }
}

export function translate(text, to = targetLanguage(), from = 'auto') {
  const key = `${from}|${to}|${text}`;
  if (cache.has(key)) return cache.get(key);
  const promise = new Promise((resolve, reject) => {
    if (batch && (batch.from !== from || batch.to !== to)) flush();
    if (!batch) {
      batch = { from, to, items: [] };
      setTimeout(() => batch && flush(), 60);
    }
    batch.items.push({ text, resolve, reject });
  });
  promise.catch(() => cache.delete(key));
  cache.set(key, promise);
  return promise;
}

// Worth translating: has a few letters and isn't just a link, code or emoji.
export function worthTranslating(text) {
  const plain = text.replace(/```[\s\S]*?```|`[^`]*`|https?:\/\/\S+|<[^>]+>|@\S+|:\w+:/g, ' ');
  return (plain.match(/\p{L}/gu) || []).length >= 4;
}
