// Web アプリ本体（Hono）。管理画面認証と顧客向けプレビューの権限は別系統。
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { DB } from '../db.js';
import { get } from '../db.js';
import type { AppConfig } from '../config.js';
import { needsSetup, createAdmin, login, getSession, logout, type Session } from '../auth.js';
import { bare, CSS } from './layout.js';
import { html } from '../util/html.js';
import { appSecret } from '../secrets.js';
import { registerPublic } from './public.js';
import { registerCompanies } from './pages-companies.js';
import { registerOutreach } from './pages-outreach.js';
import { registerMisc } from './pages-misc.js';
import { safeEqual } from '../util/crypto.js';

export type Env = { Variables: { session: Session } };
export interface Ctx {
  db: DB;
  cfg: AppConfig;
  secret: string;
}

const ADMIN_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'none'; frame-src 'self'; form-action 'self'; frame-ancestors 'self'; base-uri 'none'; object-src 'none'";

export function createApp(db: DB, cfg: AppConfig) {
  const ctx: Ctx = { db, cfg, secret: appSecret(cfg.dataDir) };
  const app = new Hono<Env>();
  const allowedHosts = new Set([`127.0.0.1:${cfg.port}`, `localhost:${cfg.port}`, `[::1]:${cfg.port}`, `${cfg.host}:${cfg.port}`]);
  let publicHost = '';
  try {
    if (cfg.publicBaseUrl) publicHost = new URL(cfg.publicBaseUrl).host;
  } catch {
    /* 無視 */
  }

  // Host ヘッダ検証（DNS リバインディング対策）。公開ホストはプレビュー・配信停止のみ許可
  app.use('*', async (c, next) => {
    const host = (c.req.header('host') || '').toLowerCase();
    const path = c.req.path;
    const isPublicPath = path.startsWith('/p/') || path.startsWith('/u/') || path === '/robots.txt';
    if (!allowedHosts.has(host) && !(publicHost && host === publicHost && isPublicPath)) {
      return c.text('Misdirected Request', 421);
    }
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin'); // no-referrer だとフォーム POST の Origin が null になる
    c.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    if (!c.res.headers.get('Content-Security-Policy')) c.header('Content-Security-Policy', ADMIN_CSP);
    if (!c.res.headers.get('Cache-Control')) c.header('Cache-Control', 'no-store');
  });

  app.get('/static/admin.css', (c) => {
    c.header('Cache-Control', 'max-age=300');
    return c.body(CSS, 200, { 'Content-Type': 'text/css; charset=utf-8' });
  });
  app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n'));
  app.get('/', (c) => c.redirect(needsSetup(db) ? '/setup' : '/admin'));
  app.get('/healthz', (c) => c.json({ ok: true }));

  // ---- 初期設定 ----
  app.get('/setup', (c) => {
    if (!needsSetup(db)) return c.redirect('/login');
    return c.html(setupPage());
  });
  app.post('/setup', async (c) => {
    if (!needsSetup(db)) return c.redirect('/login');
    if (!sameOrigin(c)) return c.text('Forbidden', 403);
    const f = (await c.req.parseBody()) as Record<string, string>;
    if (f.password !== f.password2) return c.html(setupPage('確認用パスワードが一致しません'), 400);
    try {
      createAdmin(db, String(f.username ?? ''), String(f.password ?? ''));
    } catch (e) {
      return c.html(setupPage((e as Error).message), 400);
    }
    return c.redirect('/login?setup=1');
  });

  // ---- ログイン ----
  app.get('/login', (c) => {
    if (needsSetup(db)) return c.redirect('/setup');
    return c.html(loginPage(c.req.query('setup') ? undefined : undefined, !!c.req.query('setup')));
  });
  app.post('/login', async (c) => {
    if (!sameOrigin(c)) return c.text('Forbidden', 403);
    const f = (await c.req.parseBody()) as Record<string, string>;
    const r = login(db, String(f.username ?? ''), String(f.password ?? ''));
    if (!r.ok) return c.html(loginPage(r.message), 401);
    setCookie(c, 'sid', r.token, { httpOnly: true, sameSite: 'Strict', path: '/', secure: false, maxAge: 12 * 3600 });
    return c.redirect('/admin');
  });
  app.post('/logout', async (c) => {
    const s = getSession(db, getCookie(c, 'sid'));
    const f = (await c.req.parseBody()) as Record<string, string>;
    if (s && f._csrf && safeEqual(String(f._csrf), s.csrf)) logout(db, getCookie(c, 'sid'));
    deleteCookie(c, 'sid', { path: '/' });
    return c.redirect('/login');
  });

  // ---- 顧客向け（プレビュー・配信停止）。管理者セッションは使わない ----
  registerPublic(app, ctx);

  // ---- 管理画面（認証必須・CSRF 検証） ----
  app.use('/admin/*', async (c, next) => {
    if (needsSetup(db)) return c.redirect('/setup');
    const s = getSession(db, getCookie(c, 'sid'));
    if (!s) return c.redirect('/login');
    if (c.req.method === 'POST') {
      if (!sameOrigin(c)) return c.text('Forbidden（Origin 不一致）', 403);
      const ct = c.req.header('content-type') || '';
      if (!ct.includes('application/x-www-form-urlencoded') && !ct.includes('multipart/form-data')) return c.text('Unsupported Media Type', 415);
      const f = (await c.req.parseBody({ all: true })) as Record<string, unknown>;
      const tok = typeof f._csrf === 'string' ? f._csrf : '';
      if (!tok || !safeEqual(tok, s.csrf)) return c.text('Forbidden（CSRF トークン不一致）', 403);
    }
    c.set('session', s);
    await next();
  });
  app.get('/admin', (c) => c.redirect('/admin/'));

  registerCompanies(app, ctx);
  registerOutreach(app, ctx);
  registerMisc(app, ctx);

  app.notFound((c) => c.html(bare('ページが見つかりません', html`<p><a href="/admin/">管理画面へ戻る</a></p>`), 404));
  app.onError((e, c) => {
    console.error('[error]', c.req.method, c.req.path, (e as Error).message);
    return c.html(bare('エラーが発生しました', html`<p>${(e as Error).message}</p><p><a href="/admin/">管理画面へ戻る</a></p>`), 500);
  });
  void get;
  return app;
}

/** Origin / Referer が自ホストと一致するか（ブラウザ外からの POST で Origin が無い場合は CSRF トークンで防御） */
export function sameOrigin(c: Context): boolean {
  const origin = c.req.header('origin');
  const host = c.req.header('host');
  if (!origin || origin === 'null') return !origin;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function setupPage(err?: string): string {
  return bare('初期設定：管理者アカウントの作成', html`
<p class="mute">このアプリの管理画面にログインする管理者を作成します。パスワードはこの PC 内にハッシュ化して保存されます。</p>
<form method="post" action="/setup" class="card">
<label for="u">ユーザー名（半角英数字）</label><input id="u" name="username" required pattern="[A-Za-z0-9_.\\-]{3,40}" autocomplete="username">
<label for="p1">パスワード（12文字以上・英字と数字を含む）</label><input id="p1" name="password" type="password" required minlength="12" autocomplete="new-password">
<label for="p2">パスワード（確認）</label><input id="p2" name="password2" type="password" required minlength="12" autocomplete="new-password">
<p><button type="submit">管理者を作成</button></p></form>`, err);
}

function loginPage(err?: string, justSetup = false): string {
  return bare('ログイン', html`${justSetup ? html`<div class="flash ok">管理者を作成しました。ログインしてください。</div>` : ''}
<form method="post" action="/login" class="card">
<label for="u">ユーザー名</label><input id="u" name="username" required autocomplete="username">
<label for="p">パスワード</label><input id="p" name="password" type="password" required autocomplete="current-password">
<p><button type="submit">ログイン</button></p></form>`, err);
}
