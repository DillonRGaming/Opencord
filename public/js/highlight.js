// A small syntax highlighter for code blocks: comments, strings, numbers, keywords and a few extras.
// One tokenizer with per-language keyword lists covers the common languages well enough for chat.
import { h } from './dom.js';

const C_LIKE = 'if else for while do switch case break continue return function class new delete try catch finally throw typeof instanceof in of void this super import export from default const let var async await yield static extends implements interface enum public private protected readonly abstract null undefined true false';
const KEYWORDS = {
  js: C_LIKE,
  ts: `${C_LIKE} type namespace declare as keyof infer never unknown any number string boolean`,
  py: 'def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield global nonlocal assert del async await None True False self',
  rb: 'def class module end if elsif else unless while until for in do return yield begin rescue ensure raise self nil true false require',
  go: 'func package import return if else for range switch case default break continue go defer select chan map struct interface type var const nil true false',
  rs: 'fn let mut pub struct enum impl trait use mod crate self Self return if else match for while loop in break continue as ref move async await dyn where unsafe const static true false None Some Ok Err',
  java: `${C_LIKE} package boolean int long double float char byte short final synchronized throws`,
  c: 'int char float double long short unsigned signed void struct union enum typedef const static extern return if else for while do switch case break continue sizeof goto NULL true false include define',
  cs: `${C_LIKE} using namespace string int bool double var foreach out ref override virtual sealed`,
  php: `${C_LIKE} echo function foreach as array isset unset require include namespace use`,
  sh: 'if then else elif fi for while do done case esac in function return export local echo exit',
  sql: 'select from where insert into values update set delete create table drop alter add index primary key foreign references join left right inner outer on group by order having limit offset as and or not null is distinct union all',
  css: 'important',
  lua: 'local function end if then else elseif for while do repeat until return break in and or not nil true false',
};
const ALIASES = {
  javascript: 'js', jsx: 'js', mjs: 'js', typescript: 'ts', tsx: 'ts', python: 'py', ruby: 'rb', golang: 'go', rust: 'rs',
  'c++': 'c', cpp: 'c', h: 'c', csharp: 'cs', 'c#': 'cs', kotlin: 'java', swift: 'ts', bash: 'sh', shell: 'sh', zsh: 'sh', fish: 'sh',
  json: 'js', html: 'xml', xml: 'xml', svg: 'xml', scss: 'css', less: 'css', luau: 'lua',
};
const HASH_COMMENTS = new Set(['py', 'rb', 'sh']);
const DASH_COMMENTS = new Set(['sql', 'lua']);

function tokenizer(lang) {
  const parts = [];
  if (lang === 'xml') return /(<!--[\s\S]*?-->)|("[^"]*"|'[^']*')|(<\/?[\w:-]+)|([\w:-]+(?==))/g;
  parts.push(HASH_COMMENTS.has(lang) ? '(#.*)' : DASH_COMMENTS.has(lang) ? '(--.*)' : '(\\/\\/.*|\\/\\*[\\s\\S]*?\\*\\/)');
  parts.push('("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`)');
  parts.push('(\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b|\\b0x[\\da-f]+\\b)');
  parts.push('(\\b[A-Za-z_$][\\w$]*\\b)');
  return new RegExp(parts.join('|'), 'gi');
}

export function highlight(code, langName) {
  const lang = ALIASES[langName?.toLowerCase()] || langName?.toLowerCase();
  if (!lang || (!KEYWORDS[lang] && lang !== 'xml')) return code;
  const keywords = new Set((KEYWORDS[lang] || '').split(' '));
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const m of code.matchAll(tokenizer(lang))) {
    fragment.append(code.slice(last, m.index));
    last = m.index + m[0].length;
    const [whole, comment, string, number, word] = m;
    let kind = null;
    if (comment) kind = 'comment';
    else if (string) kind = 'string';
    else if (lang === 'xml') kind = number ? 'keyword' : 'attr';
    else if (number) kind = 'number';
    else if (word && keywords.has(lang === 'sql' ? word.toLowerCase() : word)) kind = 'keyword';
    else if (word && code[last] === '(') kind = 'call';
    fragment.append(kind ? h('span', { class: `hl-${kind}` }, whole) : whole);
  }
  fragment.append(code.slice(last));
  return fragment;
}
