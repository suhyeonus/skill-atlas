import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, firstParagraph } from './frontmatter.js';
import { resolveRoots, tildify } from './paths.js';

/** The label Claude itself uses for skills the desktop app syncs down (`anthropic-skills:pdf`). */
export const APP_SKILLS_GROUP = 'anthropic-skills';

const readText = (p) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
const readJson = (p) => {
  const t = readText(p);
  if (t == null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};
const stat = (p) => {
  try {
    return fs.statSync(p); // follows symlinks
  } catch {
    return null;
  }
};
const isDir = (p) => !!stat(p)?.isDirectory();
const isFile = (p) => !!stat(p)?.isFile();
const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};
const children = (p) => {
  try {
    return fs.readdirSync(p).filter((n) => !n.startsWith('.')).sort();
  } catch {
    return [];
  }
};
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

// ---------- single items ----------

function skillItem(dir, base) {
  const { data, body } = parseFrontmatter(readText(path.join(dir, 'SKILL.md')) ?? '');
  return {
    kind: 'skill',
    name: str(data.name) || path.basename(dir),
    description: str(data.description) || firstParagraph(body),
    path: real(dir),
    ...base,
  };
}

/** Skills in `dir`: either `dir` is itself a skill, or each child folder with a SKILL.md is. */
function scanSkills(dir, base, skip = []) {
  if (!isDir(dir)) return [];
  if (isFile(path.join(dir, 'SKILL.md'))) return [skillItem(dir, base)];
  const out = [];
  for (const name of children(dir)) {
    if (skip.includes(name)) continue;
    const d = path.join(dir, name);
    if (isFile(path.join(d, 'SKILL.md'))) out.push(skillItem(d, base));
  }
  return out;
}

/** Agents and slash commands are single markdown files with the same kind of header. */
function scanMarkdown(target, kind, base) {
  const files = isFile(target)
    ? [target]
    : children(target)
        .filter((n) => n.toLowerCase().endsWith('.md') && n.toLowerCase() !== 'readme.md')
        .map((n) => path.join(target, n));
  const out = [];
  for (const file of files) {
    const text = readText(file);
    if (text == null) continue;
    const { data, body } = parseFrontmatter(text);
    out.push({
      kind,
      name: str(data.name) || path.basename(file, path.extname(file)),
      description: str(data.description) || firstParagraph(body),
      path: real(file),
      ...base,
    });
  }
  return out;
}

/** Names of the MCP servers a plugin ships. Only the names are kept; commands, env and headers are dropped. */
function mcpServerNames(root, manifest) {
  const names = new Set();
  const collect = (obj) => {
    const servers = obj && typeof obj === 'object' ? (obj.mcpServers ?? obj) : null;
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return;
    for (const [k, v] of Object.entries(servers)) if (v && typeof v === 'object') names.add(k);
  };
  collect(readJson(path.join(root, '.mcp.json')));
  if (manifest.mcpServers && typeof manifest.mcpServers === 'object') collect({ mcpServers: manifest.mcpServers });
  return [...names].sort();
}

/** Resolve a path named in a plugin manifest, refusing anything that escapes the plugin folder. */
function inside(root, rel) {
  if (typeof rel !== 'string') return null;
  const abs = path.resolve(root, rel);
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}

function scanPlugin(root, base, meta = {}) {
  if (!isDir(root)) return [];
  const manifest =
    readJson(path.join(root, '.claude-plugin', 'plugin.json')) ?? readJson(path.join(root, 'plugin.json')) ?? {};
  const name = str(manifest.name) || str(meta.name) || path.basename(root);
  const author = typeof manifest.author === 'string' ? manifest.author : str(manifest.author?.name);
  const repo = typeof manifest.repository === 'string' ? manifest.repository : str(manifest.repository?.url);

  const plugin = {
    kind: 'plugin',
    name,
    displayName: str(meta.displayName) || null,
    description: str(manifest.description),
    version: str(manifest.version) || str(meta.version) || null,
    author: author || null,
    homepage: str(manifest.homepage) || repo || str(meta.homepage) || null,
    marketplace: str(meta.marketplace) || null,
    mcpServers: mcpServerNames(root, manifest),
    enabled: meta.enabled ?? null,
    path: real(root),
    ...base,
  };

  const childBase = { ...base, plugin: name, enabled: meta.enabled ?? null };
  const dirs = (declared, fallback) => {
    const picked = list(declared).map((r) => inside(root, r)).filter(Boolean);
    return picked.length ? picked : [path.join(root, fallback)];
  };

  const out = [plugin];
  for (const d of dirs(manifest.skills, 'skills')) out.push(...scanSkills(d, childBase));
  for (const d of dirs(manifest.agents, 'agents')) out.push(...scanMarkdown(d, 'agent', childBase));
  for (const d of dirs(manifest.commands, 'commands')) out.push(...scanMarkdown(d, 'command', childBase));
  return out;
}

// ---------- desktop app buckets ----------

/**
 * The desktop app keeps what it syncs in folders that each carry a manifest.json:
 * `{skills: [...]}` next to skill folders, or `{plugins: [...]}` next to plugin folders.
 */
function scanBucket(dir) {
  const manifest = readJson(path.join(dir, 'manifest.json'));
  if (!manifest || typeof manifest !== 'object') return [];
  const base = { source: 'desktop' };
  const out = [];

  if (Array.isArray(manifest.plugins)) {
    for (const p of manifest.plugins) {
      const root = [p?.name, p?.id].filter(Boolean).map((n) => path.join(dir, String(n))).find(isDir);
      if (!root) continue;
      out.push(
        ...scanPlugin(root, base, {
          displayName: p.displayName,
          marketplace: p.marketplaceName,
          homepage: p.upstreamRepoUrl,
        }),
      );
    }
  }

  if (Array.isArray(manifest.skills)) {
    const byName = new Map(manifest.skills.map((s) => [s?.name, s]));
    const skillsDir = isDir(path.join(dir, 'skills')) ? path.join(dir, 'skills') : dir;
    for (const item of scanSkills(skillsDir, { ...base, plugin: APP_SKILLS_GROUP })) {
      const m = byName.get(item.name) ?? byName.get(path.basename(item.path));
      out.push({
        ...item,
        description: item.description || str(m?.description),
        enabled: typeof m?.enabled === 'boolean' ? m.enabled : null,
        creator: str(m?.creatorType) || null,
      });
    }
  }
  return out;
}

/** Folders at or below `dir` that hold a manifest.json. Stops descending once one is found. */
function findBuckets(dir, depth) {
  if (!isDir(dir)) return [];
  if (isFile(path.join(dir, 'manifest.json'))) return [dir];
  if (depth <= 0) return [];
  return children(dir).flatMap((n) => findBuckets(path.join(dir, n), depth - 1));
}

// ---------- merge ----------

function merge(items) {
  const map = new Map();
  for (const it of items) {
    const key = [it.kind, it.plugin ?? '', it.name, it.source === 'project' ? it.project : ''].join('|');
    const prev = map.get(key);
    if (!prev) {
      const { source, path: p, ...rest } = it;
      map.set(key, { ...rest, sources: [source], paths: [p] });
      continue;
    }
    if (!prev.sources.includes(it.source)) prev.sources.push(it.source);
    if (!prev.paths.includes(it.path)) prev.paths.push(it.path);
    for (const k of ['displayName', 'description', 'version', 'author', 'homepage', 'marketplace', 'creator']) {
      if (!prev[k] && it[k]) prev[k] = it[k];
    }
    if (prev.enabled == null && it.enabled != null) prev.enabled = it.enabled;
    if (it.mcpServers?.length) prev.mcpServers = [...new Set([...(prev.mcpServers ?? []), ...it.mcpServers])].sort();
  }
  return [...map.values()];
}

// ---------- entry point ----------

/**
 * Scan this machine and return one entry per skill, plugin, agent and command.
 *
 * @param {Parameters<typeof resolveRoots>[0] & {sources?: string[]}} [opts]
 */
export function scan(opts = {}) {
  const r = resolveRoots(opts);
  const want = (s) => !opts.sources?.length || opts.sources.includes(s);
  const raw = [];
  const scanned = [];
  const note = (source, p) => scanned.push({ source, path: tildify(p, r.home), found: !!stat(p) });

  if (want('user')) {
    note('user', r.userSkills);
    raw.push(...scanSkills(r.userSkills, { source: 'user' }, ['synced']));
    raw.push(...scanMarkdown(r.userAgents, 'agent', { source: 'user' }));
    raw.push(...scanMarkdown(r.userCommands, 'command', { source: 'user' }));
  }

  if (want('plugin')) {
    note('plugin', r.installedPlugins);
    const installed = readJson(r.installedPlugins)?.plugins ?? {};
    const enabledMap = readJson(r.settings)?.enabledPlugins; // the only settings key we look at
    for (const [key, entries] of Object.entries(installed)) {
      const [name, marketplace] = key.split('@');
      for (const e of list(entries)) {
        if (!e?.installPath) continue;
        raw.push(
          ...scanPlugin(e.installPath, { source: 'plugin' }, {
            name,
            marketplace,
            version: e.version,
            enabled: enabledMap && typeof enabledMap === 'object' ? enabledMap[key] === true : null,
          }),
        );
      }
    }
  }

  if (want('desktop')) {
    for (const [root, depth] of [[r.syncedSkills, 1], [r.syncedPlugins, 1], [r.desktopSessions, 4]]) {
      note('desktop', root);
      for (const bucket of findBuckets(root, depth)) raw.push(...scanBucket(bucket));
    }
  }

  if (want('project')) {
    for (const proj of r.projects) {
      const dot = path.join(proj, '.claude');
      note('project', dot);
      const base = { source: 'project', project: tildify(proj, r.home) };
      raw.push(...scanSkills(path.join(dot, 'skills'), base));
      raw.push(...scanMarkdown(path.join(dot, 'agents'), 'agent', base));
      raw.push(...scanMarkdown(path.join(dot, 'commands'), 'command', base));
    }
  }

  if (want('agents')) {
    for (const dir of r.agentSkillDirs) {
      note('agents', dir);
      raw.push(...scanSkills(dir, { source: 'agents' }));
    }
  }

  const items = merge(raw).map((it) => ({
    id: [it.kind, it.plugin ?? '', it.name, it.project ?? ''].join(':'),
    ...it,
    plugin: it.plugin ?? null,
    enabled: it.enabled ?? null,
    paths: it.paths.map((p) => tildify(p, r.home)),
    group: groupOf(it),
  }));

  // Children of a plugin inherit its display name so lists can show "ClickUp" rather than a raw id.
  const pluginLabels = new Map(items.filter((i) => i.kind === 'plugin').map((p) => [p.name, p.displayName]));
  for (const it of items) if (it.plugin && pluginLabels.get(it.plugin)) it.pluginDisplayName = pluginLabels.get(it.plugin);

  const kindOrder = { plugin: 0, skill: 1, agent: 2, command: 3 };
  items.sort(
    (a, b) =>
      GROUP_ORDER.indexOf(a.group.type) - GROUP_ORDER.indexOf(b.group.type) ||
      a.group.key.localeCompare(b.group.key) ||
      kindOrder[a.kind] - kindOrder[b.kind] ||
      a.name.localeCompare(b.name),
  );

  return { items, scanned };
}

export const GROUP_ORDER = ['user', 'project', 'agents', 'app', 'plugin'];

/** Which heading an item is listed under. */
function groupOf(it) {
  if (it.kind === 'plugin') return { type: 'plugin', key: `plugin:${it.name}` };
  if (it.plugin === APP_SKILLS_GROUP) return { type: 'app', key: 'app' };
  if (it.plugin) return { type: 'plugin', key: `plugin:${it.plugin}` };
  if (it.project) return { type: 'project', key: `project:${it.project}`, label: it.project };
  return it.sources.includes('user') ? { type: 'user', key: 'user' } : { type: 'agents', key: 'agents' };
}
