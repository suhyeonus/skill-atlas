#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/scan.js';
import { formatList, formatDetail, formatScanned, TEXT } from '../src/format.js';

const HELP = {
  en: `skill-atlas — see which skills and plugins are installed on this computer

Usage
  skill-atlas [list]            list everything
  skill-atlas show <name>       full details for one skill or plugin
  skill-atlas serve             open the list in your browser
  skill-atlas where             show the folders that were checked

Options for list
  --kind <k>       only skill, plugin, agent or command
  --source <s>     only user, plugin, desktop, project or agents
  --search <text>  only entries whose name or description contains the text
  --json           print JSON instead of a table

Options for serve
  --port <n>       port to use (default 4317)
  --no-open        do not open the browser

Everywhere
  --project <dir>  also look in <dir>/.claude (repeatable; the current folder is included automatically)
  --lang <ko|en>   language (default: from your system)
  -h, --help       this help
  -v, --version    version`,
  ko: `skill-atlas — 이 컴퓨터에 설치된 스킬과 플러그인을 한눈에 봅니다

사용법
  skill-atlas [list]            전체 목록
  skill-atlas show <이름>        스킬·플러그인 하나의 자세한 정보
  skill-atlas serve             브라우저에서 목록 열기
  skill-atlas where             확인한 폴더 보기

list 옵션
  --kind <종류>     skill, plugin, agent, command 중 하나만
  --source <출처>   user, plugin, desktop, project, agents 중 하나만
  --search <말>     이름이나 설명에 해당 말이 들어간 항목만
  --json           표 대신 JSON으로 출력

serve 옵션
  --port <번호>     사용할 포트 (기본 4317)
  --no-open        브라우저를 자동으로 열지 않음

공통
  --project <폴더>  <폴더>/.claude 도 함께 확인 (여러 번 사용 가능, 현재 폴더는 자동 포함)
  --lang <ko|en>   언어 (기본: 시스템 설정)
  -h, --help       도움말
  -v, --version    버전`,
};

const VALUE_FLAGS = new Set(['kind', 'source', 'search', 'lang', 'project', 'port', 'limit']);
const BOOL_FLAGS = new Set(['json', 'help', 'version', 'no-open', 'force']);
const KINDS = ['skill', 'plugin', 'agent', 'command'];
const SOURCES = ['user', 'plugin', 'desktop', 'project', 'agents'];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const flags = { project: [], source: [] };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (a === '-h') a = '--help';
    if (a === '-v') a = '--version';
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    let [name, value] = a.slice(2).split(/=(.*)/s);
    if (BOOL_FLAGS.has(name)) {
      flags[name] = true;
    } else if (VALUE_FLAGS.has(name)) {
      value ??= argv[++i];
      if (value === undefined) fail(`--${name} needs a value. See skill-atlas --help.`);
      if (Array.isArray(flags[name])) flags[name].push(...value.split(','));
      else flags[name] = value;
    } else {
      fail(`Unknown option --${name}. See skill-atlas --help.`);
    }
  }
  return { flags, positional };
}

function systemLang() {
  const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  const locale = env || Intl.DateTimeFormat().resolvedOptions().locale || '';
  return locale.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

function matches(item, text) {
  const q = text.toLowerCase();
  return [item.name, item.displayName, item.plugin, item.pluginDisplayName, item.description, item.summary?.ko?.oneLine, item.summary?.en?.oneLine]
    .filter(Boolean)
    .some((s) => s.toLowerCase().includes(q));
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const lang = flags.lang ?? systemLang();
  if (!TEXT[lang]) fail('--lang must be ko or en.');
  const t = TEXT[lang];

  if (flags.version) {
    const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
    return console.log(pkg.version);
  }
  const command = positional[0] ?? 'list';
  if (flags.help || command === 'help') return console.log(HELP[lang]);

  if (flags.kind && !KINDS.includes(flags.kind)) fail(`--kind must be one of: ${KINDS.join(', ')}.`);
  for (const s of flags.source) if (!SOURCES.includes(s)) fail(`--source must be one of: ${SOURCES.join(', ')}.`);

  // The current folder counts as a project when it has its own .claude folder.
  const projects = [...flags.project];
  const cwd = process.cwd();
  if (cwd !== os.homedir() && fs.existsSync(path.join(cwd, '.claude'))) projects.push(cwd);
  for (const p of flags.project) if (!fs.existsSync(p)) fail(`--project: ${p} does not exist.`);
  const scanOpts = { projects };

  const view = { lang, color: process.stdout.isTTY && !process.env.NO_COLOR, columns: process.stdout.columns || 100 };
  const load = () => scan(scanOpts);

  switch (command) {
    case 'list': {
      let { items } = load();
      const total = items.length;
      if (flags.kind) items = items.filter((i) => i.kind === flags.kind);
      if (flags.source.length) items = items.filter((i) => i.sources.some((s) => flags.source.includes(s)));
      if (flags.search) items = items.filter((i) => matches(i, flags.search));
      if (flags.json) return console.log(JSON.stringify(items, null, 2));
      return console.log(total ? formatList(items, view) : t.nothing);
    }
    case 'show': {
      const name = positional[1];
      if (!name) fail(lang === 'ko' ? '이름을 적어 주세요. 예: skill-atlas show pdf' : 'Give a name, e.g. skill-atlas show pdf');
      const { items } = load();
      const q = name.toLowerCase();
      const exact = items.filter((i) => [i.name, i.displayName].filter(Boolean).some((n) => n.toLowerCase() === q));
      const found = exact.length ? exact : items.filter((i) => i.name.toLowerCase().includes(q));
      if (!found.length) fail(t.notFound(name));
      if (flags.json) return console.log(JSON.stringify(found, null, 2));
      return console.log(found.map((i) => formatDetail(i, items, view)).join('\n\n'));
    }
    case 'where': {
      const { scanned } = load();
      return console.log(flags.json ? JSON.stringify(scanned, null, 2) : formatScanned(scanned, view));
    }
    default:
      fail(`Unknown command "${command}". See skill-atlas --help.`);
  }
}

main().catch((e) => fail(e.message));
