import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.js';

/** Plain http so the Host and Origin headers can be set freely. */
function request(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('server: serves the page and API to this machine only', async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-atlas-srv-')));
  const skillDir = path.join(home, '.claude', 'skills', 'alpha');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: alpha\ndescription: First skill\n---\n');
  fs.writeFileSync(path.join(home, 'secret.txt'), 'top secret');

  const reply = JSON.stringify([{ id: '1', ko: { oneLine: '요약', whenToUse: '필요할 때' }, en: { oneLine: 'Summary', whenToUse: 'When needed' } }]);
  const { server, port } = await startServer({
    port: 0,
    scanOpts: { home, platform: 'linux', env: {} },
    summarizeOpts: { cacheFile: path.join(home, 'cache', 'summaries.json'), ask: async () => reply },
  });

  try {
    const page = await request(port);
    assert.equal(page.status, 200);
    assert.match(page.body, /Skill Atlas/);
    assert.match(page.headers['content-security-policy'], /default-src 'self'/);

    const before = JSON.parse((await request(port, { path: '/api/items' })).body);
    assert.equal(before.items.length, 1);
    assert.equal(before.items[0].summary, null);
    assert.equal(before.pending, 1);

    // A page on another site cannot read the list or start a job.
    assert.equal((await request(port, { path: '/api/items', headers: { host: 'evil.example' } })).status, 403);
    const post = (headers) => request(port, { method: 'POST', path: '/api/summarize', headers, body: '{}' });
    assert.equal((await post({ 'content-type': 'application/json', origin: 'http://evil.example' })).status, 403);
    assert.equal((await post({ 'content-type': 'text/plain' })).status, 403);

    // Nothing outside web/ is served.
    for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2f..%2fsecret.txt', '/app.js.map']) {
      assert.equal((await request(port, { path: p })).status, 404, p);
    }

    assert.equal((await post({ 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` })).status, 202);
    let job;
    for (let i = 0; i < 50; i++) {
      job = JSON.parse((await request(port, { path: '/api/summarize' })).body);
      if (!job.running) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.deepEqual([job.running, job.done, job.failed], [false, 1, 0]);

    const after = JSON.parse((await request(port, { path: '/api/items' })).body);
    assert.equal(after.items[0].summary.ko.oneLine, '요약');
    assert.equal(after.pending, 0);
  } finally {
    server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
