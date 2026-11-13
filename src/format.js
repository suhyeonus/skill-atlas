const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

/** Terminal columns a string takes up (Korean and other wide characters count as two). */
export function width(s) {
  let w = 0;
  for (const ch of s) w += WIDE.test(ch) ? 2 : 1;
  return w;
}
export function truncate(s, max) {
  if (width(s) <= max) return s;
  let w = 0;
  let out = '';
  for (const ch of s) {
    const cw = WIDE.test(ch) ? 2 : 1;
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export const TEXT = {
  ko: {
    kinds: { skill: '스킬', plugin: '플러그인', agent: '에이전트', command: '명령' },
    sources: { user: '내 스킬', plugin: 'Claude Code 플러그인', desktop: 'Claude 앱', project: '프로젝트', agents: '공용 폴더' },
    groups: { user: '내가 만든 스킬', project: '프로젝트', agents: '공용 스킬 폴더', app: 'Claude 앱 기본 스킬', plugin: '플러그인' },
    on: '켜짐',
    off: '꺼짐',
    none: '조건에 맞는 항목이 없습니다.',
    nothing: '설치된 스킬이나 플러그인을 찾지 못했습니다. `skill-atlas where`로 확인한 위치를 볼 수 있습니다.',
    noDesc: '(설명 없음)',
    notFound: (n) => `"${n}"와 일치하는 항목이 없습니다. \`skill-atlas list --search ${n}\`로 찾아보세요.`,
    fields: { kind: '종류', partOf: '소속', version: '버전', author: '만든 곳', state: '상태', sources: '출처', paths: '위치', mcp: 'MCP 서버', home: '홈페이지', contains: '포함 항목', when: '이럴 때', desc: '원문 설명' },
    hint: '자세히: skill-atlas show <이름>   화면으로 보기: skill-atlas serve',
    found: '있음',
    missing: '없음',
  },
  en: {
    kinds: { skill: 'skill', plugin: 'plugin', agent: 'agent', command: 'command' },
    sources: { user: 'my skills', plugin: 'Claude Code plugin', desktop: 'Claude app', project: 'project', agents: 'shared folder' },
    groups: { user: 'Skills I made', project: 'Project', agents: 'Shared skills folder', app: 'Claude app built-in skills', plugin: 'Plugin' },
    on: 'on',
    off: 'off',
    none: 'Nothing matches those filters.',
    nothing: 'No skills or plugins found. Run `skill-atlas where` to see where it looked.',
    noDesc: '(no description)',
    notFound: (n) => `Nothing is named "${n}". Try \`skill-atlas list --search ${n}\`.`,
    fields: { kind: 'Kind', partOf: 'Part of', version: 'Version', author: 'Made by', state: 'State', sources: 'Found in', paths: 'Location', mcp: 'MCP servers', home: 'Homepage', contains: 'Contains', when: 'When to use', desc: 'Original description' },
    hint: 'Details: skill-atlas show <name>   Open in a browser: skill-atlas serve',
    found: 'found',
    missing: 'missing',
  },
};

export function makeColors(enabled) {
  const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);
  return { bold: wrap('1'), dim: wrap('2'), cyan: wrap('36'), yellow: wrap('33'), green: wrap('32') };
}

/** Text shown for an item: the generated summary when there is one, the original description otherwise. */
export function blurb(item, lang) {
  return oneLine(item.summary?.[lang]?.oneLine || item.description);
}

export function countsLine(items, t) {
  const order = ['skill', 'plugin', 'agent', 'command'];
  return order
    .map((k) => [k, items.filter((i) => i.kind === k).length])
    .filter(([, n]) => n)
    .map(([k, n]) => `${t.kinds[k]} ${n}`)
    .join(', ');
}

export function formatList(items, { lang = 'en', color = false, columns = 100 } = {}) {
  const t = TEXT[lang];
  const c = makeColors(color);
  if (!items.length) return t.none;

  const lines = [c.bold('skill-atlas') + '  ' + c.dim(countsLine(items, t)), ''];
  const nameWidth = Math.min(34, Math.max(...items.map((i) => width(i.name))) + 2);
  const descWidth = Math.max(20, columns - nameWidth - 4);

  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.group.key)) groups.set(it.group.key, { group: it.group, head: null, rows: [] });
    const g = groups.get(it.group.key);
    if (it.kind === 'plugin') g.head = it;
    else g.rows.push(it);
  }

  for (const { group, head, rows } of groups.values()) {
    let title;
    if (group.type === 'plugin') {
      const label = head?.displayName || rows[0]?.pluginDisplayName || group.key.slice('plugin:'.length);
      const state = head?.enabled === true ? c.green(` [${t.on}]`) : head?.enabled === false ? c.yellow(` [${t.off}]`) : '';
      title = c.bold(c.cyan(label)) + c.dim(`  ${t.groups.plugin}${head?.version ? ' v' + head.version : ''}`) + state;
    } else {
      title = c.bold(c.cyan(t.groups[group.type])) + (group.label ? c.dim('  ' + group.label) : '');
    }
    lines.push(title);
    if (head?.description) lines.push('  ' + c.dim(truncate(blurb(head, lang), columns - 2)));
    for (const it of rows) {
      const tag = it.kind === 'skill' ? '' : c.dim(`(${t.kinds[it.kind]}) `);
      const off = it.enabled === false && group.type !== 'plugin' ? c.yellow(`[${t.off}] `) : '';
      const text = blurb(it, lang) || t.noDesc;
      const used = width(tag.replace(/\x1b\[\d+m/g, '')) + width(off.replace(/\x1b\[\d+m/g, ''));
      lines.push('  ' + pad(truncate(it.name, nameWidth - 1), nameWidth) + tag + off + truncate(text, descWidth - used));
    }
    lines.push('');
  }
  lines.push(c.dim(t.hint));
  return lines.join('\n');
}

function wrap(text, max, indent) {
  const out = [];
  for (const para of String(text).split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && width(line) + 1 + width(word) > max) {
        out.push(line);
        line = word;
      } else line = line ? line + ' ' + word : word;
    }
    if (line) out.push(line);
  }
  return out.join('\n' + indent);
}

export function formatDetail(item, allItems, { lang = 'en', color = false, columns = 100 } = {}) {
  const t = TEXT[lang];
  const c = makeColors(color);
  const f = t.fields;
  const labelWidth = Math.max(...Object.values(f).map(width)) + 2;
  const label = (s) => c.dim(pad(s, labelWidth));
  const indent = ' '.repeat(labelWidth + 2);
  const body = Math.max(30, Math.min(columns, 110) - indent.length);
  const row = (k, v) => (v ? `  ${label(k)}${wrap(v, body, indent)}` : null);

  const title = item.displayName && item.displayName !== item.name ? `${item.displayName} (${item.name})` : item.name;
  const summary = item.summary?.[lang];
  const state = item.enabled === true ? t.on : item.enabled === false ? t.off : '';
  const children = item.kind === 'plugin' ? allItems.filter((i) => i.plugin === item.name) : [];

  return [
    c.bold(c.cyan(title)),
    summary?.oneLine ? '  ' + wrap(summary.oneLine, columns - 2, '  ') : null,
    '',
    row(f.kind, t.kinds[item.kind]),
    row(f.partOf, item.pluginDisplayName || item.plugin || item.group.label),
    row(f.version, item.version),
    row(f.author, item.author),
    row(f.state, state),
    row(f.sources, item.sources.map((s) => t.sources[s]).join(', ')),
    row(f.when, summary?.whenToUse),
    row(f.desc, item.description || t.noDesc),
    row(f.mcp, item.mcpServers?.join(', ')),
    row(f.home, item.homepage),
    children.length ? row(f.contains, children.map((i) => `${i.name}${i.kind === 'skill' ? '' : ` (${t.kinds[i.kind]})`}`).join(', ')) : null,
    `  ${label(f.paths)}${item.paths.join('\n' + indent)}`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export function formatScanned(scanned, { lang = 'en', color = false } = {}) {
  const t = TEXT[lang];
  const c = makeColors(color);
  return scanned
    .map((s) => `${s.found ? c.green('✓') : c.dim('·')} ${pad(t.sources[s.source], 22)} ${s.path}  ${c.dim(s.found ? t.found : t.missing)}`)
    .join('\n');
}
