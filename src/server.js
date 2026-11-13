import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from './scan.js';
import { attachSummaries, detectProvider, loadCache, pending, summarize } from './summarize.js';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

function send(res, status, body, type = TYPES['.json']) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { ...SECURITY, 'Content-Type': type });
  res.end(data);
}

/**
 * The request handler, separate from listen() so tests can drive it.
 * `summarizeOpts` lets tests swap the model call and cache file.
 */
export function createHandler({ scanOpts = {}, getPort, summarizeOpts = {} }) {
  const job = { running: false, done: 0, total: 0, failed: 0, errors: [] };
  const provider = () => (summarizeOpts.ask ? 'custom' : detectProvider());

  return async function handler(req, res) {
    // Only answer requests addressed to this machine by name. A web page on another
    // site that points a hostname at 127.0.0.1 fails this check.
    const port = getPort();
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(req.headers.host ?? '')) return send(res, 403, { error: 'forbidden host' });

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/api/items' && req.method === 'GET') {
      const { items, scanned } = scan(scanOpts);
      const cache = loadCache(summarizeOpts.cacheFile);
      return send(res, 200, {
        items: attachSummaries(items, cache),
        scanned,
        summarizer: provider(),
        pending: pending(items, { cache }).length,
        job,
      });
    }

    if (url.pathname === '/api/summarize' && req.method === 'GET') return send(res, 200, job);

    if (url.pathname === '/api/summarize' && req.method === 'POST') {
      const origin = req.headers.origin;
      const sameOrigin = !origin || allowedHosts.some((h) => origin === `http://${h}`);
      if (!sameOrigin || !(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return send(res, 403, { error: 'forbidden' });
      }
      if (!provider()) return send(res, 409, { error: 'no-provider' });
      if (job.running) return send(res, 409, { error: 'busy' });

      const { items } = scan(scanOpts);
      Object.assign(job, { running: true, done: 0, failed: 0, errors: [], total: pending(items, { cache: loadCache(summarizeOpts.cacheFile) }).length });
      summarize(items, { ...summarizeOpts, onProgress: (p) => Object.assign(job, p) })
        .then((r) => Object.assign(job, { done: r.done, failed: r.failed, total: r.total, errors: r.errors }))
        .catch((e) => Object.assign(job, { errors: [e.message] }))
        .finally(() => (job.running = false));
      return send(res, 202, job);
    }

    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });

    // Static files, never outside web/.
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return send(res, 400, { error: 'bad path' });
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(WEB, path.normalize(rel));
    if (!file.startsWith(WEB) || !TYPES[path.extname(file)]) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      send(res, 200, req.method === 'HEAD' ? '' : data, TYPES[path.extname(file)]);
    });
  };
}

/** Start on 127.0.0.1, moving to the next port when the wanted one is taken. */
export function startServer({ port = 4317, scanOpts, summarizeOpts, tries = 10 } = {}) {
  return new Promise((resolve, reject) => {
    let current = port;
    const server = http.createServer(createHandler({ scanOpts, summarizeOpts, getPort: () => server.address()?.port ?? current }));
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE' && current < port + tries) server.listen(++current, '127.0.0.1');
      else reject(e);
    });
    server.on('listening', () => resolve({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}/` }));
    server.listen(current, '127.0.0.1');
  });
}
