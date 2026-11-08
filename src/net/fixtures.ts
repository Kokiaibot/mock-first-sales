// 架空企業用の固定サイト（fixtures/sites/<host>/...）。ネットワーク通信を一切行わない。
import fs from 'node:fs';
import path from 'node:path';

export interface FixtureResponse {
  status: number;
  contentType: string;
  body: Buffer;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
};

export function readFixture(fixturesDir: string, url: URL): FixtureResponse {
  const host = url.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host)) return notFound();
  const root = path.resolve(fixturesDir, host);
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const candidates = [p, p + '.html', p + '/index.html'];
  for (const c of candidates) {
    const full = path.resolve(root, '.' + c);
    // パストラバーサル対策
    if (!full.startsWith(root + path.sep)) return notFound();
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      return {
        status: 200,
        contentType: TYPES[path.extname(full)] ?? 'application/octet-stream',
        body: fs.readFileSync(full),
      };
    }
  }
  return notFound();
}

function notFound(): FixtureResponse {
  return { status: 404, contentType: 'text/html; charset=utf-8', body: Buffer.from('<h1>404</h1>') };
}
