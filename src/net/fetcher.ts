// 安全な HTTP 取得。名前解決結果を固定して接続し、リダイレクトごとに再検証する。
// 403/429 等のアクセス制限は回避しない（429 は Retry-After を尊重して再試行に回す）。
import http from 'node:http';
import https from 'node:https';
import { LIMITS } from '../config.js';
import { validateTarget, BlockedUrlError, type Resolver } from './ssrf.js';
import { readFixture } from './fixtures.js';

export const USER_AGENT = 'MockFirstSalesBot/0.1 (+site review for proposal; local tool)';

export class RetryAfterError extends Error {
  constructor(public readonly retryAfterSec: number, msg: string) {
    super(msg);
    this.name = 'RetryAfterError';
  }
}
export class AccessDeniedError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'AccessDeniedError';
  }
}
export { BlockedUrlError };

export interface FetchResult {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: Buffer;
  text: string;
  redirects: string[];
  fixture: boolean;
  elapsedMs: number;
  fetchedAt: string;
}

export interface FetchOptions {
  fixturesDir: string;
  resolver?: Resolver;
  timeoutMs?: number;
  maxBytes?: number;
  method?: 'GET' | 'HEAD';
}

const lastHit = new Map<string, number>();
async function politeDelay(host: string): Promise<void> {
  const prev = lastHit.get(host) ?? 0;
  const wait = prev + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

export function parseRetryAfter(v: string | undefined): number {
  if (!v) return 60;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.min(3600, Math.max(1, n));
  const d = Date.parse(v);
  if (!Number.isNaN(d)) return Math.min(3600, Math.max(1, Math.ceil((d - Date.now()) / 1000)));
  return 60;
}

export async function safeFetch(rawUrl: string, opts: FetchOptions): Promise<FetchResult> {
  const started = Date.now();
  const redirects: string[] = [];
  let current = rawUrl;
  for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
    const target = await validateTarget(current, opts.resolver);
    let status: number;
    let headers: Record<string, string | string[] | undefined>;
    let body: Buffer;
    if (target.fixture) {
      const f = readFixture(opts.fixturesDir, target.url);
      status = f.status;
      headers = { 'content-type': f.contentType };
      body = f.body;
    } else {
      await politeDelay(target.url.hostname);
      const r = await rawRequest(target.url, target.address!, target.family!, opts);
      status = r.status;
      headers = r.headers;
      body = r.body;
    }
    if (status >= 300 && status < 400 && headers.location) {
      const next = new URL(String(headers.location), target.url).toString();
      redirects.push(next);
      current = next;
      continue;
    }
    if (status === 429 || status === 503) {
      throw new RetryAfterError(parseRetryAfter(headers['retry-after'] as string | undefined), `HTTP ${status}（アクセス制限）`);
    }
    if (status === 401 || status === 403) {
      throw new AccessDeniedError(`HTTP ${status}: アクセスが拒否されました（回避は行いません）`);
    }
    const contentType = String(headers['content-type'] ?? '');
    return {
      requestedUrl: rawUrl,
      finalUrl: current,
      status,
      contentType,
      body,
      text: decodeBody(body, contentType),
      redirects,
      fixture: target.fixture,
      elapsedMs: Date.now() - started,
      fetchedAt: new Date().toISOString(),
    };
  }
  throw new BlockedUrlError(`リダイレクトが多すぎます（${LIMITS.maxRedirects} 回超）`);
}

function rawRequest(url: URL, address: string, family: number, opts: FetchOptions) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const maxBytes = opts.maxBytes ?? LIMITS.fetchMaxBytes;
    const req = mod.request(
      url,
      {
        method: opts.method ?? 'GET',
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,*/*;q=0.5', 'accept-language': 'ja,en;q=0.5' },
        timeout: opts.timeoutMs ?? LIMITS.fetchTimeoutMs,
        // 検証済みアドレスに固定（DNS リバインディング対策）
        lookup: (_h: string, _o: any, cb: any) => {
          if (_o && _o.all) cb(null, [{ address, family }]);
          else cb(null, address, family);
        },
        servername: url.hostname,
      } as any,
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy(new Error(`応答サイズ上限（${maxBytes} バイト）を超えました`));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('タイムアウトしました')));
    req.on('error', reject);
    req.end();
  });
}

export function decodeBody(body: Buffer, contentType: string): string {
  let charset = /charset=([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const head = body.subarray(0, 4096).toString('latin1');
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  const label = (charset || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(label === 'sjis' || label === 'x-sjis' ? 'shift_jis' : label).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

// robots.txt（User-agent: * のみ解釈）
const robotsCache = new Map<string, string[]>();
export async function isAllowedByRobots(url: string, opts: FetchOptions): Promise<boolean> {
  const u = new URL(url);
  const key = u.origin;
  if (!robotsCache.has(key)) {
    let rules: string[] = [];
    try {
      const r = await safeFetch(new URL('/robots.txt', u).toString(), { ...opts, maxBytes: 256 * 1024 });
      if (r.status === 200) rules = parseRobots(r.text);
    } catch (e) {
      if (e instanceof RetryAfterError) throw e;
      rules = [];
    }
    robotsCache.set(key, rules);
  }
  const path = u.pathname;
  return !robotsCache.get(key)!.some((d) => d && path.startsWith(d));
}

export function parseRobots(text: string): string[] {
  const disallow: string[] = [];
  let applies = false;
  for (const line of text.split(/\r?\n/)) {
    const l = line.replace(/#.*/, '').trim();
    const m = /^([\w-]+)\s*:\s*(.*)$/.exec(l);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === 'user-agent') applies = v === '*' || /mockfirstsales/i.test(v);
    else if (k === 'disallow' && applies && v) disallow.push(v);
  }
  return disallow;
}
