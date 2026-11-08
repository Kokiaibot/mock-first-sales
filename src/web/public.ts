// 顧客向けルート: 試作プレビュー（閲覧コード・期限・失効）と配信停止
import type { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Env, Ctx } from './app.js';
import { get, run, nowIso, audit } from '../db.js';
import { checkViewCode, previewCookieValue, previewState, mockSpec } from '../mock/service.js';
import { renderMock, type MockPage } from '../mock/render.js';
import { html, esc } from '../util/html.js';
import { hmac, safeEqual } from '../util/crypto.js';
import { addSuppression } from '../domain/eligibility.js';

const PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'self'; base-uri 'none'";
const PAGES: Record<string, MockPage> = { '': 'index', services: 'services', contact: 'contact', thanks: 'thanks' };

function simplePage(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<style>body{font-family:"Yu Gothic UI","Hiragino Sans",system-ui,sans-serif;background:#f5f6f8;color:#1f2933;margin:0}main{max-width:460px;margin:12vh auto;background:#fff;border:1px solid #e1e4e8;border-radius:12px;padding:28px}
input{font:inherit;padding:10px;border:1px solid #cbd2d9;border-radius:8px;width:100%;letter-spacing:.15em;text-transform:uppercase}button{font:inherit;background:#2563eb;color:#fff;border:0;border-radius:8px;padding:10px 18px;margin-top:12px;cursor:pointer}.err{color:#b91c1c}.mute{color:#616e7c;font-size:13px}</style></head>
<body><main>${body}</main></body></html>`;
}

export function registerPublic(app: Hono<Env>, ctx: Ctx) {
  const { db, secret } = ctx;

  const findMock = (token: string) => (/^[A-Za-z0-9_-]{20,64}$/.test(token) ? get(db, 'SELECT * FROM mocks WHERE token = ?', token) : undefined);

  app.get('/p/:token', (c) => c.redirect(`/p/${encodeURIComponent(c.req.param('token'))}/`));

  const handler = (c: any) => {
    c.header('Content-Security-Policy', PREVIEW_CSP);
    const token = c.req.param('token');
    const m = findMock(token);
    // 存在しない・失効・期限切れはいずれも同じ文面（推測を困難にする）
    if (!m) return c.html(simplePage('プレビュー', '<h1>このプレビューは表示できません</h1><p class="mute">URL が正しくないか、公開が終了しています。</p>'), 404);
    const st = previewState(m);
    if (st !== 'active') return c.html(simplePage('プレビュー', `<h1>このプレビューは${st === 'expired' ? '閲覧期限が終了しました' : '公開を終了しました'}</h1><p class="mute">再度ご覧になりたい場合は、ご案内メールの送信者までご連絡ください。</p>`), 410);
    const cookie = getCookie(c, `pv${m.id}`);
    if (!cookie || !safeEqual(cookie, previewCookieValue(secret, m))) {
      return c.html(codePage(token, !!c.req.query('bad'), !!c.req.query('locked')), 401);
    }
    const page = PAGES[c.req.param('page') ?? ''];
    if (!page) return c.html(simplePage('プレビュー', '<h1>ページが見つかりません</h1>'), 404);
    return c.html(renderMock(mockSpec(m), page, { base: `/p/${token}/`, audience: 'client', expiresAt: m.expires_at }));
  };
  app.get('/p/:token/', handler);
  app.get('/p/:token/:page', handler);

  app.post('/p/:token/unlock', async (c) => {
    const token = c.req.param('token');
    const m = findMock(token);
    if (!m || previewState(m) !== 'active') return c.redirect(`/p/${encodeURIComponent(token)}/`);
    const f = (await c.req.parseBody()) as Record<string, string>;
    const r = checkViewCode(m, String(f.code ?? ''));
    if (r === 'locked') return c.redirect(`/p/${token}/?locked=1`);
    if (r === 'bad') return c.redirect(`/p/${token}/?bad=1`);
    const maxAge = Math.max(60, Math.floor((new Date(m.expires_at).getTime() - Date.now()) / 1000));
    setCookie(c, `pv${m.id}`, previewCookieValue(secret, m), { httpOnly: true, sameSite: 'Lax', path: `/p/${token}/`, maxAge, secure: c.req.url.startsWith('https:') });
    audit(db, 'preview', 'preview.unlock', `mock:${m.id}`);
    return c.redirect(`/p/${token}/`);
  });

  // ---- 配信停止 ----
  const unsubSig = (t: string) => hmac(secret, `unsub:${t}`);
  app.get('/u/:token', (c) => {
    const t = c.req.param('token');
    const co = /^[A-Za-z0-9_-]{10,64}$/.test(t) ? get(db, 'SELECT id, name, opt_out FROM companies WHERE unsubscribe_token = ?', t) : undefined;
    if (!co) return c.html(simplePage('配信停止', '<h1>URL が正しくありません</h1>'), 404);
    if (co.opt_out) return c.html(simplePage('配信停止', '<h1>配信停止済みです</h1><p>今後ご連絡することはありません。</p>'));
    return c.html(simplePage('配信停止', html`<h1>配信停止の手続き</h1><p>${co.name} 様宛ての今後のご連絡を停止します。</p>
<form method="post" action="/u/${t}"><input type="hidden" name="sig" value="${unsubSig(t)}"><button type="submit">配信を停止する</button></form>`.value));
  });
  app.post('/u/:token', async (c) => {
    const t = c.req.param('token');
    const f = (await c.req.parseBody()) as Record<string, string>;
    const co = /^[A-Za-z0-9_-]{10,64}$/.test(t) ? get(db, 'SELECT id FROM companies WHERE unsubscribe_token = ?', t) : undefined;
    if (!co || !f.sig || !safeEqual(String(f.sig), unsubSig(t))) return c.html(simplePage('配信停止', '<h1>手続きできませんでした</h1>'), 400);
    addSuppression(db, 'company', String(co.id), '受信者が配信停止ページで手続き', 'recipient');
    run(db, 'UPDATE companies SET updated_at = ? WHERE id = ?', nowIso(), co.id);
    return c.html(simplePage('配信停止', '<h1>配信を停止しました</h1><p>今後ご連絡することはありません。</p>'));
  });
}

function codePage(token: string, bad: boolean, locked: boolean): string {
  return simplePage('試作プレビュー', html`<h1>試作プレビュー</h1><p class="mute">ご案内メールに記載の「閲覧コード」を入力してください。</p>
${bad ? html`<p class="err" role="alert">閲覧コードが正しくありません。</p>` : ''}${locked ? html`<p class="err" role="alert">入力の誤りが続いたため、しばらく時間をおいてお試しください。</p>` : ''}
<form method="post" action="/p/${token}/unlock"><label for="code">閲覧コード</label><input id="code" name="code" required maxlength="16" autocomplete="off"><button type="submit">表示する</button></form>
<p class="mute">このページは提案用の試作です。検索エンジンには登録されません。</p>`.value);
}
