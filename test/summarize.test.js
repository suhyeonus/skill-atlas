import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarize, attachSummaries, loadCache, pending } from '../src/summarize.js';

const items = [
  { kind: 'skill', name: 'alpha', description: 'First skill' },
  { kind: 'skill', name: 'beta', description: 'Second skill' },
  { kind: 'skill', name: 'empty', description: '' },
];

const reply = (ids) =>
  '```json\n' +
  JSON.stringify(ids.map((id) => ({ id, ko: { oneLine: `요약 ${id}`, whenToUse: '필요할 때' }, en: { oneLine: `Summary ${id}`, whenToUse: 'When needed' } }))) +
  '\n```';

test('summarize: caches results, skips cached and empty items, survives a bad reply', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-atlas-cache-'));
  const cacheFile = path.join(dir, 'nested', 'summaries.json');
  let calls = 0;

  // The model only answers for the first entry: the second counts as failed and is retried later.
  const first = await summarize(items, { cacheFile, ask: async () => (calls++, reply(['1'])) });
  assert.deepEqual([first.done, first.failed, first.total], [1, 1, 2]);

  const cache = loadCache(cacheFile);
  const withSummaries = attachSummaries(items, cache);
  assert.equal(withSummaries[0].summary.ko.oneLine, '요약 1');
  assert.equal(withSummaries[1].summary, null);
  assert.deepEqual(pending(items, { cache }).map((i) => i.name), ['beta']);

  const second = await summarize(items, { cacheFile, ask: async (prompt) => (calls++, assert.ok(!prompt.includes('First skill')), reply(['1'])) });
  assert.deepEqual([second.done, second.failed], [1, 0]);

  const third = await summarize(items, { cacheFile, ask: async () => (calls++, '') });
  assert.equal(third.total, 0);
  assert.equal(calls, 2, 'nothing is sent when everything is cached');

  const broken = await summarize(items, { cacheFile, force: true, ask: async () => 'sorry, no' });
  assert.equal(broken.failed, 2);
  assert.equal(broken.errors.length, 1);
  assert.equal(attachSummaries(items, loadCache(cacheFile))[0].summary.en.oneLine, 'Summary 1', 'a failed run keeps old summaries');

  fs.rmSync(dir, { recursive: true, force: true });
});
