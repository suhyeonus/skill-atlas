import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFrontmatter, firstParagraph } from '../src/frontmatter.js';
import { resolveRoots, tildify } from '../src/paths.js';
import { scan } from '../src/scan.js';

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
const skill = (name, desc) => `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n`;

test('frontmatter: plain, quoted, folded, literal, wrapped, nested', () => {
  const { data, body } = parseFrontmatter(
    [
      '---',
      'name: demo',
      'description: "Says \\"hi\\": a test"',
      'folded: >-',
      '  first line',
      '  second line',
      '',
      '  new paragraph',
      'literal: |',
      '  a',
      '  b',
      'wrapped: starts here',
      '  and continues',
      'korean: 한글 설명입니다',
      "single: 'it''s fine'",
      'metadata:',
      '  origin: ECC',
      'tools:',
      '  - Read',
      '  - Bash',
      '---',
      '',
      '# Title',
      '',
      'Body text.',
    ].join('\n'),
  );
  assert.equal(data.name, 'demo');
  assert.equal(data.description, 'Says "hi": a test');
  assert.equal(data.folded, 'first line second line\nnew paragraph');
  assert.equal(data.literal, 'a\nb');
  assert.equal(data.wrapped, 'starts here and continues');
  assert.equal(data.korean, '한글 설명입니다');
  assert.equal(data.single, "it's fine");
  assert.deepEqual(data.metadata, { origin: 'ECC' });
  assert.deepEqual(data.tools, ['Read', 'Bash']);
  assert.equal(firstParagraph(body), 'Body text.');
});

test('frontmatter: missing header and CRLF', () => {
  assert.deepEqual(parseFrontmatter('# Just a doc').data, {});
  assert.equal(parseFrontmatter('---\r\nname: x\r\n---\r\nbody').data.name, 'x');
});

test('paths: per-OS desktop folder and tildify', () => {
  const mac = resolveRoots({ home: '/Users/a', platform: 'darwin', env: {} });
  assert.ok(mac.desktopSessions.startsWith('/Users/a/Library/Application Support/Claude'));
  const linux = resolveRoots({ home: '/home/a', platform: 'linux', env: {} });
  assert.ok(linux.desktopSessions.startsWith('/home/a/.config/Claude'));
  const custom = resolveRoots({ home: '/home/a', platform: 'linux', env: { CLAUDE_CONFIG_DIR: '/x/cfg' } });
  assert.equal(custom.userSkills, path.join('/x/cfg', 'skills'));
  assert.equal(tildify('/Users/a/.claude/skills', '/Users/a'), '~/.claude/skills');
  assert.equal(tildify('/Users/ab/x', '/Users/a'), '/Users/ab/x');
});

test('scan: finds every source, merges duplicates, hides secrets', () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-atlas-')));
  const claude = path.join(home, '.claude');

  // user skills: one real, one workspace folder without SKILL.md, one symlink into ~/.agents
  write(path.join(claude, 'skills', 'alpha', 'SKILL.md'), skill('alpha', 'First skill'));
  write(path.join(claude, 'skills', 'alpha-workspace', 'notes.md'), 'scratch');
  write(path.join(home, '.agents', 'skills', 'shared', 'SKILL.md'), skill('shared', 'Shared skill'));
  fs.symlinkSync(path.join(home, '.agents', 'skills', 'shared'), path.join(claude, 'skills', 'shared'));

  // installed plugin with a skill, an agent, a command and an MCP server that carries a secret
  const tool = path.join(claude, 'plugins', 'cache', 'market', 'tool', '1.0.0');
  write(
    path.join(tool, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'tool', description: 'A tool plugin', version: '1.0.0', author: { name: 'Acme' } }),
  );
  write(path.join(tool, 'skills', 'tool-use', 'SKILL.md'), skill('tool-use', 'Use the tool'));
  write(path.join(tool, 'agents', 'helper.md'), '---\nname: helper\ndescription: Helps\n---\n');
  write(path.join(tool, 'commands', 'go.md'), 'Run the thing.\n');
  write(
    path.join(tool, '.mcp.json'),
    JSON.stringify({ mcpServers: { toolserver: { command: 'x', env: { TOKEN: 'super-secret-value' } } } }),
  );
  write(
    path.join(claude, 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'tool@market': [{ installPath: tool, version: '1.0.0' }] } }),
  );
  write(
    path.join(claude, 'settings.json'),
    JSON.stringify({ enabledPlugins: { 'tool@market': true }, env: { OTHER: 'another-secret' } }),
  );

  // desktop app: the same plugin again under an opaque folder name, plus synced skills in two buckets
  const bucket = path.join(claude, 'plugins', 'synced', 'bucket1');
  write(
    path.join(bucket, 'manifest.json'),
    JSON.stringify({ plugins: [{ id: 'plugin_1', name: 'uuid-123', displayName: 'Tool', marketplaceName: 'dir' }] }),
  );
  write(path.join(bucket, 'uuid-123', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'tool' }));
  write(path.join(bucket, 'uuid-123', 'skills', 'tool-use', 'SKILL.md'), skill('tool-use', 'Use the tool'));

  const synced = path.join(claude, 'skills', 'synced', 'bucket1');
  write(path.join(synced, 'manifest.json'), JSON.stringify({ skills: [{ name: 'pdf', enabled: false, creatorType: 'anthropic' }] }));
  write(path.join(synced, 'pdf', 'SKILL.md'), skill('pdf', 'Work with PDFs'));
  const session = path.join(home, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions', 'skills-plugin', 'a', 'b');
  write(path.join(session, 'manifest.json'), JSON.stringify({ skills: [{ name: 'pdf', enabled: false }] }));
  write(path.join(session, 'skills', 'pdf', 'SKILL.md'), skill('pdf', 'Work with PDFs'));

  // project
  const proj = path.join(home, 'work', 'app');
  write(path.join(proj, '.claude', 'skills', 'alpha', 'SKILL.md'), skill('alpha', 'Project flavour of alpha'));

  const { items, scanned } = scan({ home, platform: 'darwin', env: {}, projects: [proj] });
  const find = (kind, name, plugin = null) => items.filter((i) => i.kind === kind && i.name === name && i.plugin === plugin);

  assert.equal(items.some((i) => i.name === 'alpha-workspace'), false, 'folders without SKILL.md are skipped');

  const alphas = find('skill', 'alpha');
  assert.equal(alphas.length, 2, 'user and project skills with the same name stay separate');
  assert.deepEqual(alphas.map((a) => a.sources[0]).sort(), ['project', 'user']);

  const [shared] = find('skill', 'shared');
  assert.deepEqual(shared.sources.sort(), ['agents', 'user']);
  assert.equal(shared.paths.length, 1, 'a symlink and its target count as one place');
  assert.equal(shared.paths[0], '~/.agents/skills/shared');

  const [plugin] = find('plugin', 'tool');
  assert.deepEqual(plugin.sources.sort(), ['desktop', 'plugin']);
  assert.equal(plugin.displayName, 'Tool');
  assert.equal(plugin.enabled, true);
  assert.equal(plugin.author, 'Acme');
  assert.deepEqual(plugin.mcpServers, ['toolserver']);

  assert.equal(find('skill', 'tool-use', 'tool').length, 1, 'plugin skills found twice are merged');
  assert.equal(find('skill', 'tool-use', 'tool')[0].pluginDisplayName, 'Tool');
  assert.equal(find('agent', 'helper', 'tool').length, 1);
  assert.equal(find('command', 'go', 'tool')[0].description, 'Run the thing.');

  const [pdf] = find('skill', 'pdf', 'anthropic-skills');
  assert.equal(pdf.enabled, false);
  assert.equal(pdf.paths.length, 2);

  const dump = JSON.stringify({ items, scanned });
  assert.equal(dump.includes('super-secret-value'), false);
  assert.equal(dump.includes('another-secret'), false);
  assert.equal(dump.includes(home), false, 'the home folder is always shown as ~');

  assert.deepEqual(scan({ home, platform: 'darwin', env: {}, sources: ['agents'] }).items.map((i) => i.name), ['shared']);

  fs.rmSync(home, { recursive: true, force: true });
});
