const KINDS = ['skill', 'plugin', 'agent', 'command'];
const SOURCES = ['user', 'plugin', 'desktop', 'project', 'agents'];

const store = {
  get(key) {
    try {
      return localStorage.getItem('skill-atlas:' + key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('skill-atlas:' + key, value);
    } catch {
      /* storage blocked: the choice lasts for this visit only */
    }
  },
};

const state = {
  lang: store.get('lang') || (navigator.language?.toLowerCase().startsWith('ko') ? 'ko' : 'en'),
  theme: store.get('theme') || 'system',
  dict: {},
  data: null,
  error: false,
  q: '',
  kind: null,
  source: null,
  open: new Set(),
  startError: false,
};

const $ = (sel) => document.querySelector(sel);

/** Build an element. Text always goes in as text nodes, never as HTML. */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function t(key, vars = {}) {
  const value = key.split('.').reduce((o, k) => o?.[k], state.dict[state.lang]);
  if (typeof value !== 'string') return key;
  return value.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
}

const marker = (kind) => h('span', { class: 'marker', 'data-kind': kind, 'aria-hidden': 'true' });
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// ---------- data ----------

async function load() {
  try {
    const res = await fetch('/api/items');
    if (!res.ok) throw new Error(String(res.status));
    state.data = await res.json();
    state.error = false;
  } catch {
    state.error = true;
  }
  render();
  if (state.data?.job.running) poll();
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  let lastDone = -1;
  while (true) {
    await new Promise((r) => setTimeout(r, 1500));
    let job;
    try {
      job = await (await fetch('/api/summarize')).json();
    } catch {
      break;
    }
    if (!job.running || job.done !== lastDone) {
      lastDone = job.done;
      await load(); // pick up the summaries saved so far
    } else {
      state.data.job = job;
      renderSummaryBox();
    }
    if (!job.running) break;
  }
  polling = false;
}

async function startSummaries() {
  state.startError = false;
  try {
    const res = await fetch('/api/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok && res.status !== 409) throw new Error(String(res.status));
    state.data.job = { ...state.data.job, running: true, done: 0, failed: 0, errors: [], total: state.data.pending };
    renderSummaryBox();
    poll();
  } catch {
    state.startError = true;
    renderSummaryBox();
  }
}

// ---------- filtering ----------

function matchesQuery(item, q) {
  if (!q) return true;
  const hay = [
    item.name,
    item.displayName,
    item.plugin,
    item.pluginDisplayName,
    item.description,
    item.summary?.ko?.oneLine,
    item.summary?.ko?.whenToUse,
    item.summary?.en?.oneLine,
    item.summary?.en?.whenToUse,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
}

function visibleItems({ ignore } = {}) {
  return (state.data?.items ?? []).filter(
    (it) =>
      matchesQuery(it, state.q) &&
      (ignore === 'kind' || !state.kind || it.kind === state.kind) &&
      (ignore === 'source' || !state.source || it.sources.includes(state.source)),
  );
}

// ---------- rendering ----------

function renderChrome() {
  document.documentElement.lang = state.lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang));
  for (const b of document.querySelectorAll('[data-theme-choice]')) b.setAttribute('aria-pressed', String(b.dataset.themeChoice === state.theme));
}

function renderLegend() {
  const filterList = (target, keys, stateKey, label, countOf, extra) => {
    const rows = keys
      .map((key) => [key, countOf(key)])
      .filter(([key, n]) => n > 0 || state[stateKey] === key)
      .map(([key, n]) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              class: 'legend__item',
              'aria-pressed': String(state[stateKey] === key),
              title: extra?.(key),
              onclick: () => {
                state[stateKey] = state[stateKey] === key ? null : key;
                render();
              },
            },
            stateKey === 'kind' ? marker(key) : null,
            h('span', { class: 'legend__name' }, label(key)),
            h('span', { class: 'legend__count' }, n),
          ),
        ),
      );
    $(target).replaceChildren(...rows);
  };

  const forKinds = visibleItems({ ignore: 'kind' });
  const forSources = visibleItems({ ignore: 'source' });
  filterList('#kind-filters', KINDS, 'kind', (k) => t('kinds.' + k), (k) => forKinds.filter((i) => i.kind === k).length, (k) => t('kindHelp.' + k));
  filterList('#source-filters', SOURCES, 'source', (s) => t('sources.' + s), (s) => forSources.filter((i) => i.sources.includes(s)).length);
}

function groupTitle(group, items) {
  if (group.type === 'plugin') {
    const head = items.find((i) => i.kind === 'plugin');
    return head?.displayName || items[0]?.pluginDisplayName || head?.name || group.key.slice('plugin:'.length);
  }
  return t('groups.' + group.type);
}

function entry(item) {
  const summary = item.summary?.[state.lang];
  const blurb = oneLine(summary?.oneLine || item.description) || t('noDescription');
  const title = item.kind === 'plugin' ? item.displayName || item.name : item.name;

  const field = (label, value) => (value ? [h('dt', {}, t('fields.' + label)), h('dd', {}, value)] : []);
  const stateText = item.enabled === true ? t('state.on') : item.enabled === false ? t('state.off') : null;
  const homepage = /^https?:\/\//.test(item.homepage ?? '')
    ? h('a', { href: item.homepage, target: '_blank', rel: 'noopener noreferrer' }, item.homepage)
    : null;

  const details = h(
    'details',
    {
      class: 'entry',
      open: state.open.has(item.id),
      ontoggle: (e) => (e.target.open ? state.open.add(item.id) : state.open.delete(item.id)),
    },
    h(
      'summary',
      {},
      marker(item.kind),
      h('span', { class: 'entry__name' }, title),
      h('span', { class: 'entry__blurb' }, blurb),
      item.enabled === false ? h('span', { class: 'badge' }, t('state.off')) : null,
    ),
    h(
      'div',
      { class: 'entry__body' },
      summary?.whenToUse ? h('p', { class: 'entry__when' }, h('strong', {}, t('fields.when')), ' ', summary.whenToUse) : null,
      h(
        'dl',
        {},
        field('original', item.description ? h('span', { class: 'prose' }, item.description) : t('noDescription')),
        field('kind', t('kinds.' + item.kind)),
        field('partOf', item.kind === 'plugin' ? null : item.pluginDisplayName || item.plugin || item.group.label),
        field('version', item.version),
        field('author', item.author),
        field('state', stateText),
        field('sources', item.sources.map((s) => t('sources.' + s)).join(', ')),
        field('mcp', item.mcpServers?.join(', ')),
        field('homepage', homepage),
        field('paths', h('ul', { class: 'paths' }, item.paths.map((p) => h('li', {}, h('code', {}, p))))),
      ),
    ),
  );
  return details;
}

function renderList() {
  const list = $('#list');
  const status = $('#status');
  const all = state.data?.items ?? [];

  if (state.error && !state.data) {
    status.textContent = t('status.loadError');
    list.replaceChildren();
    return;
  }
  if (!state.data) {
    status.textContent = t('status.loading');
    return;
  }
  if (!all.length) {
    status.textContent = t('status.empty');
    list.replaceChildren();
    return;
  }

  const items = visibleItems();
  const filtered = state.q || state.kind || state.source;
  const clear = filtered
    ? h(
        'button',
        {
          type: 'button',
          class: 'quiet',
          onclick: () => {
            Object.assign(state, { q: '', kind: null, source: null });
            $('#q').value = '';
            render();
          },
        },
        t('actions.clear'),
      )
    : null;
  const countText = !items.length
    ? t('status.noMatch')
    : filtered
      ? t('status.filtered', { n: items.length, total: all.length })
      : t('status.count', { n: all.length });
  status.replaceChildren(...[state.error ? t('status.loadError') + ' ' : null, countText, clear ? ' ' : null, clear].filter(Boolean));

  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.group.key)) groups.set(it.group.key, { group: it.group, items: [] });
    groups.get(it.group.key).items.push(it);
  }

  list.replaceChildren(
    ...[...groups.values()].map(({ group, items: members }) =>
      h(
        'section',
        { class: 'group' },
        h(
          'header',
          { class: 'group__head' },
          h('h2', {}, groupTitle(group, all.filter((i) => i.group.key === group.key))),
          group.label ? h('code', { class: 'group__where' }, group.label) : null,
          h('span', { class: 'group__count' }, members.length),
        ),
        members.map(entry),
      ),
    ),
  );
}

function renderSummaryBox() {
  const box = $('#summary-box');
  const d = state.data;
  if (!d || !d.items.length) return box.replaceChildren();
  const { job } = d;
  const parts = [h('h2', {}, t('summary.title'))];

  if (job.running) {
    parts.push(
      h('p', {}, t('summary.running', { done: job.done + job.failed, total: job.total })),
      h('progress', { max: Math.max(job.total, 1), value: job.done + job.failed }),
    );
  } else if (!d.summarizer) {
    parts.push(h('p', {}, t('summary.noProvider')));
  } else if (d.pending === 0) {
    parts.push(h('p', {}, t('summary.allDone')));
  } else {
    parts.push(
      h('p', {}, t('summary.intro')),
      h('button', { type: 'button', class: 'primary', onclick: startSummaries }, t('summary.make', { n: d.pending })),
    );
  }
  if (!job.running && job.failed > 0) parts.push(h('p', { class: 'warn' }, t('summary.failed', { n: job.failed })));
  if (state.startError) parts.push(h('p', { class: 'warn' }, t('summary.startError')));
  box.replaceChildren(...parts);
}

function renderScanned() {
  const el = $('#scanned');
  const scanned = state.data?.scanned ?? [];
  el.hidden = !scanned.length;
  el.querySelector('ul').replaceChildren(
    ...scanned.map((s) =>
      h(
        'li',
        { class: s.found ? '' : 'is-missing' },
        h('span', {}, t('sources.' + s.source)),
        h('code', {}, s.path),
        h('span', {}, t(s.found ? 'scanned.found' : 'scanned.missing')),
      ),
    ),
  );
}

function render() {
  renderChrome();
  renderLegend();
  renderList();
  renderSummaryBox();
  renderScanned();
}

// ---------- events ----------

$('#lang-switch').addEventListener('click', (e) => {
  const lang = e.target.closest('[data-lang]')?.dataset.lang;
  if (!lang) return;
  state.lang = lang;
  store.set('lang', lang);
  render();
});

$('#theme-switch').addEventListener('click', (e) => {
  const theme = e.target.closest('[data-theme-choice]')?.dataset.themeChoice;
  if (!theme) return;
  state.theme = theme;
  store.set('theme', theme);
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  renderChrome();
});

$('#q').addEventListener('input', (e) => {
  state.q = e.target.value.trim();
  renderLegend();
  renderList();
});

$('#rescan').addEventListener('click', load);

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) {
    e.preventDefault();
    $('#q').focus();
  }
});

// ---------- start ----------

const [ko, en] = await Promise.all(['ko', 'en'].map((l) => fetch(`/i18n/${l}.json`).then((r) => r.json())));
state.dict = { ko, en };
render();
load();
