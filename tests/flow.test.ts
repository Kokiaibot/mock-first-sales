// 管理画面（HTTP）経由の受け入れテスト。架空企業・固定サイトのみ使用（外部通信なし）。
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeEnv, setupAndLogin, Client, HOST } from './helpers.js';
import { drain, enqueue, recoverJobs, runOne } from '../src/jobs/engine.js';
import { all, get, run, openDb } from '../src/db.js';
import { seed } from '../scripts/seed-demo.js';
import { contentHash, sendApproved, recoverInterruptedSends } from '../src/outreach/approval.js';
import { closeBrowser } from '../src/analysis/browser.js';
import { createApp } from '../src/web/app.js';

const env = makeEnv();
let c: Client;
let csrf: string;

beforeAll(async () => {
  c = await setupAndLogin(env.app);
  csrf = await c.csrf();
});

const ids = () => Object.fromEntries(all(env.db, 'SELECT id, website_domain FROM companies WHERE merged_into IS NULL').map((r) => [r.website_domain, r.id]));

describe('基本: 起動・初期設定・ログイン・認可', () => {
  it('未ログインでは管理画面に入れない', async () => {
    const anon = new Client(env.app);
    expect((await anon.get('/admin/companies')).headers.get('location')).toBe('/login');
  });
  it('初期設定は一度だけ・弱いパスワードは拒否', async () => {
    const e2 = makeEnv();
    const a = new Client(e2.app);
    const weak = await a.post('/setup', { username: 'admin', password: 'short', password2: 'short' });
    expect(weak.status).toBe(400);
    await a.post('/setup', { username: 'admin', password: 'TestPassw0rd123', password2: 'TestPassw0rd123' });
    expect((await a.get('/setup')).headers.get('location')).toBe('/login');
  });
  it('ログイン失敗が続くとロック', async () => {
    const e3 = makeEnv();
    const a = new Client(e3.app);
    await a.post('/setup', { username: 'admin', password: 'TestPassw0rd123', password2: 'TestPassw0rd123' });
    for (let i = 0; i < 5; i++) await a.post('/login', { username: 'admin', password: 'wrongpassword1' });
    const r = await a.post('/login', { username: 'admin', password: 'TestPassw0rd123' });
    expect(r.status).toBe(401);
    expect(await r.text()).toContain('ロック');
  });
  it('CSRF トークンなし・別オリジンの POST を拒否', async () => {
    expect((await c.post('/admin/settings/ai', { enabled: 'on' })).status).toBe(403);
    expect((await c.post('/admin/settings/ai', { _csrf: 'x'.repeat(32) })).status).toBe(403);
    expect((await c.post('/admin/settings/ai', { _csrf: csrf }, { origin: 'http://evil.example' })).status).toBe(403);
  });
  it('不正な Host ヘッダ（DNS リバインディング）を拒否', async () => {
    const r = await env.app.request('/admin/', { headers: { host: 'evil.example:8787' } });
    expect(r.status).toBe(421);
  });
  it('セキュリティヘッダ・noindex', async () => {
    const r = await c.get('/admin/');
    expect(r.headers.get('content-security-policy')).toContain("script-src 'none'");
    expect(r.headers.get('x-robots-tag')).toContain('noindex');
    expect(await (await c.get('/robots.txt')).text()).toContain('Disallow: /');
  });
});

describe('検索条件・データ取込', () => {
  it('検索条件を保存・再表示できる', async () => {
    const r = await c.post('/admin/search/save', { _csrf: csrf, name: '横浜の工務店', prefecture: '神奈川県', city: '横浜市', industry: '工務店', keyword: '', maxCandidates: '30', requireContact: 'email', improvementRoom: 'some', excludeContacted: 'on' });
    expect(r.status).toBe(302);
    const html = await (await c.get(r.headers.get('location')!.split('?')[0])).text();
    expect(html).toContain('value="横浜の工務店"');
    expect(html).toMatch(/<option selected>神奈川県<\/option>/);
    expect(html).toContain('value="30"');
    expect(html).toMatch(/value="email" selected/);
  });
  it('許諾された CSV を取り込み、サイトなしは除外・重複は統合・数式は拒否', async () => {
    const csv = [
      '企業名,都道府県,市区町村,業種,公式サイトURL,メールアドレス,利用許諾・再利用条件,架空データ',
      'テスト商事株式会社,東京都,港区,卸売,https://test-shoji.example/,info@test-shoji.example,検証用データ,1',
      '（株）テスト商事,東京都,港区,卸売,https://www.test-shoji.example/,,検証用データ,1',
      'サイトなし株式会社,東京都,港区,卸売,,,検証用データ,1',
      '=HYPERLINK("http://evil"),東京都,港区,卸売,https://evil.example/,,検証用データ,1',
    ].join('\n');
    const fd = new FormData();
    fd.set('_csrf', csrf);
    fd.set('confirm', 'on');
    fd.set('file', new File([csv], 'a.csv', { type: 'text/csv' }));
    const r = await c.req('/admin/import', { method: 'POST', body: fd });
    const loc = decodeURIComponent(r.headers.get('location')!.replace(/\+/g, ' '));
    expect(loc).toContain('新規 1／重複統合 1／サイトなし除外 1／エラー 1');
    const shoji = all(env.db, "SELECT * FROM companies WHERE website_domain = 'test-shoji.example'");
    expect(shoji).toHaveLength(1);
    expect(get(env.db, "SELECT status FROM companies WHERE name = 'サイトなし株式会社'")!.status).toBe('excluded');
    expect(get(env.db, "SELECT COUNT(*) n FROM companies WHERE name LIKE '=%'")!.n).toBe(0);
  });
  it('CSV 出力は数式を無害化', async () => {
    run(env.db, "UPDATE companies SET memo = '=cmd|calc' WHERE name = 'テスト商事株式会社'");
    const text = await (await c.get('/admin/export.csv')).text();
    expect(text).toContain("'=cmd|calc");
  });
});

describe('制作: 分析→モック→営業文（架空企業3社）', () => {
  beforeAll(async () => {
    seed(env.db);
    for (const id of Object.values(ids())) {
      const co = get(env.db, 'SELECT * FROM companies WHERE id = ?', id)!;
      if (co.is_fictional && co.status === 'new' && co.website_domain !== 'test-shoji.example') {
        await c.post(`/admin/companies/${id}/pipeline`, { _csrf: csrf });
      }
    }
    await drain(env.db, env.cfg);
    await closeBrowser();
  });

  it('サイトなし企業は除外、重複は統合されている', () => {
    expect(get(env.db, "SELECT site_status, status FROM companies WHERE name = '有限会社まるや商店'")).toMatchObject({ site_status: 'no_site', status: 'excluded' });
    expect(all(env.db, "SELECT id FROM companies WHERE website_domain = 'minato-koumuten.example'")).toHaveLength(1);
  });

  it('営業禁止表示のある企業は送信対象外（モックも作らない）', () => {
    const h = get(env.db, "SELECT * FROM companies WHERE website_domain = 'hikari-seiki.example'")!;
    expect(h.eligibility).toBe('ng');
    expect(h.status).toBe('excluded');
    expect(get(env.db, 'SELECT COUNT(*) n FROM mocks WHERE company_id = ?', h.id)!.n).toBe(0);
  });

  it('証拠付き分析結果（7項目・根拠URL・確認日時・スクリーンショット）が保存される', async () => {
    const id = ids()['minato-koumuten.example'];
    const fs_ = all(env.db, 'SELECT f.* FROM findings f JOIN analyses a ON a.id = f.analysis_id WHERE a.company_id = ?', id);
    expect(fs_).toHaveLength(7);
    expect(fs_.every((f) => f.evidence_url && f.checked_at && f.fact)).toBe(true);
    const shots = all(env.db, "SELECT kind FROM screenshots WHERE company_id = ? AND kind IN ('pc','sp')", id).map((r) => r.kind).sort();
    expect(shots).toEqual(['pc', 'sp']);
    const html = await (await c.get(`/admin/companies/${id}/analysis`)).text();
    expect(html).toContain('ルールによる分析');
    expect(html).toContain('Lighthouse');
  });

  it('異なる3社について異なるモックを生成（企業名の置換だけではない）', () => {
    const specs = ['minato-koumuten.example', 'sakuradai-dental.example', 'aoba-kaikei.example'].map((d) => JSON.parse(get(env.db, 'SELECT spec FROM mocks WHERE company_id = ?', ids()[d])!.spec));
    expect(new Set(specs.map((s) => s.industry)).size).toBe(3);
    expect(new Set(specs.map((s) => s.palette.primary)).size).toBe(3);
    expect(new Set(specs.map((s) => s.hero.headline)).size).toBe(3);
    expect(new Set(specs.map((s) => s.services.map((x: any) => x.name).join())).size).toBe(3);
    expect(new Set(specs.map((s) => s.sections.join())).size).toBeGreaterThan(1);
    // 確認できたブランドカラーを継承
    expect(specs[0].palette.primary).toBe('#1f6f5c');
    // 架空の実績を生成しない
    for (const s of specs) expect(JSON.stringify(s)).not.toMatch(/お客様の声：|受賞しました|実績\d+件/);
  });

  it('PC・スマートフォンで横スクロールが発生しない（モック）', async () => {
    const { chromium } = await import('playwright-core');
    let browser;
    try {
      browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' });
    } catch {
      return; // ブラウザなし環境はスキップ（E2E で別途確認）
    }
    const id = ids()['sakuradai-dental.example'];
    const m = get(env.db, 'SELECT id FROM mocks WHERE company_id = ?', id)!;
    const { renderMock } = await import('../src/mock/render.js');
    const spec = JSON.parse(get(env.db, 'SELECT spec FROM mocks WHERE id = ?', m.id)!.spec);
    for (const page of ['index', 'services', 'contact'] as const) {
      for (const width of [1366, 390]) {
        const ctx = await browser.newContext({ viewport: { width, height: 800 } });
        const p = await ctx.newPage();
        await p.setContent(renderMock(spec, page, { base: '/', audience: 'admin' }));
        const sw = await p.evaluate(() => document.documentElement.scrollWidth);
        expect(sw, `${page}@${width}`).toBeLessThanOrEqual(width);
        await ctx.close();
      }
    }
    await browser.close();
  });

  it('デモページ間を遷移できる（管理者プレビュー）', async () => {
    const m = get(env.db, 'SELECT id FROM mocks WHERE company_id = ?', ids()['aoba-kaikei.example'])!;
    const top = await (await c.get(`/admin/mocks/${m.id}/view/`)).text();
    expect(top).toContain(`href="/admin/mocks/${m.id}/view/services"`);
    expect(top).toContain(`href="/admin/mocks/${m.id}/view/contact"`);
    for (const p of ['services', 'contact', 'thanks']) expect((await c.get(`/admin/mocks/${m.id}/view/${p}`)).status).toBe(200);
    expect(top).toContain('noindex');
  });

  it('営業文と企業別プレビューが一致する', () => {
    for (const d of ['minato-koumuten.example', 'sakuradai-dental.example', 'aoba-kaikei.example']) {
      const id = ids()[d];
      const m = get(env.db, 'SELECT * FROM mocks WHERE company_id = ? AND superseded = 0', id)!;
      const dr = get(env.db, 'SELECT * FROM drafts WHERE company_id = ? AND archived = 0', id)!;
      expect(dr.body).toContain(`/p/${m.token}/`);
      expect(dr.body).toContain(m.view_code);
      expect(dr.body).toContain(d.replace('.example', ''));
      expect(dr.body).toContain('正式な制作物ではありません');
      expect(dr.body).toContain('配信停止');
      expect(JSON.parse(dr.quality).errors).toEqual([]);
      expect(get(env.db, 'SELECT status FROM companies WHERE id = ?', id)!.status).toBe('awaiting_approval');
    }
  });

  it('閲覧コード・期限・失効・再発行が機能する', async () => {
    const id = ids()['minato-koumuten.example'];
    const m = get(env.db, 'SELECT * FROM mocks WHERE company_id = ?', id)!;
    const visitor = new Client(env.app);
    expect((await visitor.get(`/p/${m.token}/`)).status).toBe(401);
    expect((await visitor.get(`/p/${'x'.repeat(32)}/`)).status).toBe(404);
    await visitor.post(`/p/${m.token}/unlock`, { code: 'WRONG123' });
    expect((await visitor.get(`/p/${m.token}/`)).status).toBe(401);
    await visitor.post(`/p/${m.token}/unlock`, { code: m.view_code.toLowerCase() });
    const ok = await visitor.get(`/p/${m.token}/`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('x-robots-tag')).toContain('noindex');
    expect((await visitor.get(`/p/${m.token}/services`)).status).toBe(200);
    // 管理者セッションと顧客プレビューは別権限
    expect((await visitor.get('/admin/')).status).toBe(302);
    // 期限切れ
    run(env.db, 'UPDATE mocks SET expires_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), m.id);
    expect((await visitor.get(`/p/${m.token}/`)).status).toBe(410);
    // 再発行: 旧URLは無効、新URLで有効
    await c.post(`/admin/mocks/${m.id}/reissue`, { _csrf: csrf, days: '14' });
    const m2 = get(env.db, 'SELECT * FROM mocks WHERE id = ?', m.id)!;
    expect(m2.token).not.toBe(m.token);
    expect((await visitor.get(`/p/${m.token}/`)).status).toBe(404);
    expect((await visitor.get(`/p/${m2.token}/`)).status).toBe(401);
    // 不正な有効日数
    const bad = await c.post(`/admin/mocks/${m.id}/reissue`, { _csrf: csrf, days: '-5' });
    expect(decodeURIComponent(bad.headers.get('location')!)).toContain('1〜90');
    // 失効
    await c.post(`/admin/mocks/${m.id}/revoke`, { _csrf: csrf });
    expect((await visitor.get(`/p/${m2.token}/`)).status).toBe(410);
  });
});

describe('承認・送信', () => {
  let did: number;
  let cid: number;
  const approvePage = async () => (await c.get(`/admin/approvals/${did}`)).text();
  const hashOnPage = async () => (await approvePage()).match(/name="hash" value="([0-9a-f]{64})"/)?.[1] ?? '';

  beforeAll(() => {
    cid = ids()['sakuradai-dental.example'];
    did = get(env.db, 'SELECT id FROM drafts WHERE company_id = ? AND archived = 0', cid)!.id;
  });

  it('営業可否・モック確認が未了なら承認できない（未承認送信も拒否）', async () => {
    const r = await c.post(`/admin/approvals/${did}/approve`, { _csrf: csrf, hash: await hashOnPage(), confirm: 'on' });
    expect(decodeURIComponent(r.headers.get('location')!)).toContain('承認できません');
    const s = await c.post(`/admin/approvals/${did}/send`, { _csrf: csrf, hash: 'x', confirm: 'on' });
    expect(decodeURIComponent(s.headers.get('location')!)).toContain('送信しませんでした');
    expect(get(env.db, 'SELECT COUNT(*) n FROM sends')!.n).toBe(0);
  });

  it('メール公開だけでは送信可にならない（根拠・メモ必須）', async () => {
    const r = await c.post(`/admin/companies/${cid}/eligibility`, { _csrf: csrf, decision: 'ok', basis: '', note: '' });
    expect(decodeURIComponent(r.headers.get('location')!)).toContain('根拠');
    expect(get(env.db, 'SELECT eligibility FROM companies WHERE id = ?', cid)!.eligibility).toBe('unreviewed');
  });

  it('営業禁止表示のある企業は送信可にできない', async () => {
    const hid = ids()['hikari-seiki.example'];
    const r = await c.post(`/admin/companies/${hid}/eligibility`, { _csrf: csrf, decision: 'ok', basis: 'published_business_email', note: '確認' });
    expect(decodeURIComponent(r.headers.get('location')!)).toContain('営業禁止表示');
  });

  it('確認内容に紐づいた承認 → 本文変更で承認解除', async () => {
    await c.post(`/admin/companies/${cid}/eligibility`, { _csrf: csrf, decision: 'ok', basis: 'published_business_email', note: '問い合わせページで公開アドレスを確認、拒否表示なし（テスト）' });
    const m = get(env.db, 'SELECT id FROM mocks WHERE company_id = ?', cid)!;
    await c.post(`/admin/mocks/${m.id}/review`, { _csrf: csrf });
    // 画面表示後に内容が変わった場合のハッシュでは承認されない
    const stale = await c.post(`/admin/approvals/${did}/approve`, { _csrf: csrf, hash: 'f'.repeat(64), confirm: 'on' });
    expect(decodeURIComponent(stale.headers.get('location')!)).toContain('内容が変更');
    const r = await c.post(`/admin/approvals/${did}/approve`, { _csrf: csrf, hash: await hashOnPage(), confirm: 'on' });
    expect(decodeURIComponent(r.headers.get('location')!)).toContain('承認しました');
    expect(get(env.db, 'SELECT COUNT(*) n FROM approvals WHERE draft_id = ? AND revoked_at IS NULL', did)!.n).toBe(1);
    // 本文を変更 → 承認解除
    const d = get(env.db, 'SELECT * FROM drafts WHERE id = ?', did)!;
    await c.post(`/admin/drafts/${did}`, { _csrf: csrf, subject: d.subject, recipient: d.recipient, body: d.body + '\nよろしくお願いいたします。' });
    expect(get(env.db, 'SELECT COUNT(*) n FROM approvals WHERE draft_id = ? AND revoked_at IS NULL', did)!.n).toBe(0);
  });

  it('宛先を営業リスト外に変えると承認できない', async () => {
    const d = get(env.db, 'SELECT * FROM drafts WHERE id = ?', did)!;
    await c.post(`/admin/drafts/${did}`, { _csrf: csrf, subject: d.subject, recipient: 'someone@other.example', body: d.body });
    expect(await approvePage()).toContain('宛先が営業リストに登録された企業のメールアドレスと一致しません');
    await c.post(`/admin/drafts/${did}`, { _csrf: csrf, subject: d.subject, recipient: d.recipient, body: d.body });
  });

  it('承認後に関連情報（企業メール）が変わると承認が無効になる', async () => {
    await c.post(`/admin/approvals/${did}/approve`, { _csrf: csrf, hash: await hashOnPage(), confirm: 'on' });
    const before = get(env.db, 'SELECT email FROM companies WHERE id = ?', cid)!.email;
    run(env.db, 'UPDATE companies SET email = ? WHERE id = ?', 'changed@sakuradai-dental.example', cid); // 画面外での変更も検出
    const a = get(env.db, 'SELECT * FROM approvals WHERE draft_id = ? AND revoked_at IS NULL', did)!;
    const r = sendApproved(env.db, env.cfg, did, a.content_hash, 1);
    expect(r.status).toBe('blocked');
    run(env.db, 'UPDATE companies SET email = ? WHERE id = ?', before, cid);
  });

  it('配信停止された企業には承認済みでも送信しない', async () => {
    const aid = ids()['aoba-kaikei.example'];
    const ad = get(env.db, 'SELECT id FROM drafts WHERE company_id = ? AND archived = 0', aid)!.id;
    await c.post(`/admin/companies/${aid}/eligibility`, { _csrf: csrf, decision: 'ok', basis: 'sales_desk', note: '営業窓口アドレスの記載を確認（テスト）' });
    await c.post(`/admin/mocks/${get(env.db, 'SELECT id FROM mocks WHERE company_id = ?', aid)!.id}/review`, { _csrf: csrf });
    const page = await (await c.get(`/admin/approvals/${ad}`)).text();
    const hash = page.match(/name="hash" value="([0-9a-f]{64})"/)![1];
    await c.post(`/admin/approvals/${ad}/approve`, { _csrf: csrf, hash, confirm: 'on' });
    // 承認後に受信者が配信停止
    const tok = get(env.db, 'SELECT unsubscribe_token FROM companies WHERE id = ?', aid)!.unsubscribe_token;
    const visitor = new Client(env.app);
    const sig = (await (await visitor.get(`/u/${tok}`)).text()).match(/name="sig" value="([^"]+)"/)![1];
    await visitor.post(`/u/${tok}`, { sig });
    const r = await c.post(`/admin/approvals/${ad}/send`, { _csrf: csrf, hash, confirm: 'on' });
    expect(decodeURIComponent(r.headers.get('location')!)).toContain('送信しませんでした');
    expect(get(env.db, 'SELECT COUNT(*) n FROM sends WHERE company_id = ?', aid)!.n).toBe(0);
  });

  it('模擬送信は「模擬送信」として記録され、EML が出力される', async () => {
    const hash = await hashOnPage();
    await c.post(`/admin/approvals/${did}/approve`, { _csrf: csrf, hash, confirm: 'on' });
    const r = await c.post(`/admin/approvals/${did}/send`, { _csrf: csrf, hash, confirm: 'on' });
    expect(r.headers.get('location')).toContain('/admin/sends');
    const s = get(env.db, 'SELECT * FROM sends WHERE draft_id = ?', did)!;
    expect(s).toMatchObject({ mode: 'simulated', status: 'sent' });
    expect(fs.existsSync(path.join(env.dataDir, 'outbox', s.eml_file))).toBe(true);
    expect(get(env.db, 'SELECT status FROM companies WHERE id = ?', cid)!.status).toBe('sent');
    expect(await (await c.get('/admin/sends')).text()).toContain('模擬送信');
  });

  it('重複送信をブロック（同じ承認の再利用・同一企業）', () => {
    const r = sendApproved(env.db, env.cfg, did, 'anything', 1);
    expect(r.status).toBe('blocked');
    expect(get(env.db, 'SELECT COUNT(*) n FROM sends WHERE company_id = ?', cid)!.n).toBe(1);
  });

  it('実送信は未実装のため拒否', () => {
    expect(sendApproved(env.db, env.cfg, did, 'x', 1, 'real').status).toBe('blocked');
  });

  it('送信結果が不明なら「要確認」とし、自動再送しない', async () => {
    const mid = ids()['minato-koumuten.example'];
    // 失効したモックを再発行して下書きを作り直す
    const m = get(env.db, 'SELECT id FROM mocks WHERE company_id = ?', mid)!;
    await c.post(`/admin/mocks/${m.id}/reissue`, { _csrf: csrf, days: '14' });
    run(env.db, 'UPDATE drafts SET archived = 1 WHERE company_id = ?', mid);
    enqueue(env.db, 'draft', mid);
    await drain(env.db, env.cfg);
    const d = get(env.db, 'SELECT id FROM drafts WHERE company_id = ? AND archived = 0', mid)!;
    await c.post(`/admin/companies/${mid}/eligibility`, { _csrf: csrf, decision: 'ok', basis: 'published_business_email', note: '会社概要ページで確認（テスト）' });
    await c.post(`/admin/mocks/${m.id}/review`, { _csrf: csrf });
    const hash = (await (await c.get(`/admin/approvals/${d.id}`)).text()).match(/name="hash" value="([0-9a-f]{64})"/)![1];
    await c.post(`/admin/approvals/${d.id}/approve`, { _csrf: csrf, hash, confirm: 'on' });
    process.env.SIMULATE_SEND_RESULT = 'unknown';
    try {
      await c.post(`/admin/approvals/${d.id}/send`, { _csrf: csrf, hash, confirm: 'on' });
    } finally {
      delete process.env.SIMULATE_SEND_RESULT;
    }
    expect(get(env.db, 'SELECT status FROM sends WHERE draft_id = ?', d.id)!.status).toBe('unknown');
    // 再送の試み → ブロック
    expect(sendApproved(env.db, env.cfg, d.id, hash, 1).status).toBe('blocked');
    expect(get(env.db, 'SELECT COUNT(*) n FROM sends WHERE draft_id = ?', d.id)!.n).toBe(1);
  });

  it('不正な日付の商談登録を拒否', async () => {
    for (const date of ['2026-02-30', '2999-01-01', 'abc', '2026-11-08<script>']) {
      const r = await c.post('/admin/deals', { _csrf: csrf, company_id: String(cid), kind: 'replied', date });
      expect(decodeURIComponent(r.headers.get('location')!)).toContain('日付が不正');
    }
    const ok = await c.post('/admin/deals', { _csrf: csrf, company_id: String(cid), kind: 'replied', date: '2026-11-08' });
    expect(decodeURIComponent(ok.headers.get('location')!)).toContain('登録しました');
    expect(get(env.db, 'SELECT status FROM companies WHERE id = ?', cid)!.status).toBe('replied');
  });
});

describe('ジョブ', () => {
  it('同じ処理の重複登録を防ぐ', () => {
    const id = ids()['test-shoji.example'];
    const a = enqueue(env.db, 'analyze', id);
    const b = enqueue(env.db, 'analyze', id);
    expect(a.id).toBe(b.id);
    expect(b.created).toBe(false);
  });
  it('失敗後に安全に再実行でき、成果物は重複しない', async () => {
    const id = ids()['test-shoji.example'];
    await drain(env.db, env.cfg); // 固定サイトが無いので 404 → 恒久失敗
    const j = get(env.db, "SELECT * FROM jobs WHERE company_id = ? AND type = 'analyze' ORDER BY id DESC", id)!;
    expect(j.status).toBe('failed');
    expect(j.last_error).toContain('404');
    const r = await c.post(`/admin/jobs/${j.id}/retry`, { _csrf: csrf });
    expect(decodeURIComponent(r.headers.get('location')!)).toContain('操作しました');
    await drain(env.db, env.cfg);
    expect(get(env.db, 'SELECT status FROM jobs WHERE id = ?', j.id)!.status).toBe('failed');
    // 成功済み企業を再分析しても分析結果・モックは増えない
    const mid = ids()['sakuradai-dental.example'];
    const before = [get(env.db, 'SELECT COUNT(*) n FROM analyses WHERE company_id = ?', mid)!.n, get(env.db, 'SELECT COUNT(*) n FROM mocks WHERE company_id = ?', mid)!.n];
    enqueue(env.db, 'analyze', mid, { chain: true, dedupeSuffix: 'again' });
    await drain(env.db, env.cfg);
    const after = [get(env.db, 'SELECT COUNT(*) n FROM analyses WHERE company_id = ?', mid)!.n, get(env.db, 'SELECT COUNT(*) n FROM mocks WHERE company_id = ?', mid)!.n];
    expect(after).toEqual(before);
    expect(get(env.db, 'SELECT COUNT(*) n FROM sends WHERE company_id = ?', mid)!.n).toBe(1);
    await closeBrowser();
  });
  it('中断・再起動後に再開できる（処理中ジョブ・送信中を復元）', async () => {
    const id = ids()['aoba-kaikei.example'];
    run(env.db, 'UPDATE companies SET opt_out = 0 WHERE id = ?', id);
    const j = enqueue(env.db, 'mock', id, { dedupeSuffix: 'restart' });
    run(env.db, "UPDATE jobs SET status = 'running', attempts = 1, lease_until = ? WHERE id = ?", new Date().toISOString(), j.id);
    run(env.db, "INSERT INTO sends (draft_id, company_id, channel, mode, recipient_norm, idempotency_key, status, created_at, updated_at) VALUES (1, ?, 'email', 'simulated', 'x@y.example', 'k-restart', 'sending', 'now', 'now')", id);
    // 再起動を模擬: DB を開き直す
    const db2 = openDb(env.dataDir);
    expect(recoverJobs(db2)).toBeGreaterThanOrEqual(1);
    expect(recoverInterruptedSends(db2)).toBe(1);
    createApp(db2, env.cfg);
    await runOne(db2, env.cfg);
    expect(get(db2, 'SELECT status FROM jobs WHERE id = ?', j.id)!.status).toBe('succeeded');
    expect(get(db2, "SELECT status FROM sends WHERE idempotency_key = 'k-restart'")!.status).toBe('unknown');
  });
  it('処理中に配信停止された企業の後続処理は止まる', async () => {
    const id = ids()['aoba-kaikei.example'];
    run(env.db, 'UPDATE companies SET opt_out = 1 WHERE id = ?', id);
    const j = enqueue(env.db, 'draft', id, { dedupeSuffix: 'optout' });
    await runOne(env.db, env.cfg);
    expect(get(env.db, 'SELECT * FROM jobs WHERE id = ?', j.id)).toMatchObject({ status: 'failed' });
  });
  it('費用・処理履歴を確認できる（費用不明は未計測）', async () => {
    const html = await (await c.get('/admin/costs')).text();
    expect(html).toContain('local-template');
    expect(html).toContain('未計測');
    expect(html).toContain('gBizINFO');
  });
  it('主要画面がすべて表示できる', async () => {
    for (const p of ['/admin/', '/admin/search', '/admin/companies', '/admin/import', '/admin/approvals', '/admin/sends', '/admin/deals', '/admin/analytics', '/admin/costs', '/admin/jobs', '/admin/suppressions', '/admin/settings', '/admin/status', '/admin/companies/new'])
      expect((await c.get(p)).status, p).toBe(200);
    void HOST;
  });
});
