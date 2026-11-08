import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createApp } from '../src/web/app.js';

export const HOST = '127.0.0.1:8787';

export function makeEnv() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfs-test-'));
  const cfg = loadConfig({ dataDir, startWorker: false, port: 8787, host: '127.0.0.1', publicBaseUrl: '' });
  const db = openDb(cfg.dataDir);
  const app = createApp(db, cfg);
  return { dataDir, cfg, db, app };
}

/** Cookie を保持する簡易クライアント */
export class Client {
  cookies = new Map<string, string>();
  constructor(private app: { request: (p: string, init?: RequestInit) => Response | Promise<Response> }) {}
  async req(p: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('host', HOST);
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const res = await this.app.request(p, { ...init, headers, redirect: 'manual' });
    for (const sc of res.headers.getSetCookie()) {
      const [kv] = sc.split(';');
      const [k, v] = kv.split('=');
      if (/Max-Age=0/i.test(sc) || v === '') this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
    return res;
  }
  get(p: string) {
    return this.req(p);
  }
  post(p: string, data: Record<string, string | string[]>, extraHeaders: Record<string, string> = {}) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(data)) (Array.isArray(v) ? v : [v]).forEach((x) => body.append(k, x));
    return this.req(p, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', ...extraHeaders } });
  }
  async csrf(p = '/admin/settings'): Promise<string> {
    const html = await (await this.get(p)).text();
    const m = html.match(/name="_csrf" value="([^"]+)"/);
    if (!m) throw new Error('csrf not found on ' + p);
    return m[1];
  }
}

export async function setupAndLogin(app: any) {
  const c = new Client(app);
  await c.post('/setup', { username: 'admin', password: 'TestPassw0rd123', password2: 'TestPassw0rd123' });
  const r = await c.post('/login', { username: 'admin', password: 'TestPassw0rd123' });
  if (r.status !== 302) throw new Error('login failed ' + r.status);
  return c;
}
