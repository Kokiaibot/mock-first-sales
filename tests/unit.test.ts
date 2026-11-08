import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { parseCsv, toCsv, looksLikeFormula } from '../src/util/csv.js';
import { normalizeCompanyName, normalizeUrl, parseStrictDate, domainOf } from '../src/util/normalize.js';
import { isBlockedIp, validateTarget, BlockedUrlError } from '../src/net/ssrf.js';
import { safeFetch, parseRobots, parseRetryAfter } from '../src/net/fetcher.js';
import { readFixture } from '../src/net/fixtures.js';
import { findProhibition, findSalesDesk, assessFromPages } from '../src/domain/eligibility.js';
import { checkQuality } from '../src/outreach/draft.js';
import { esc, html, safeHref } from '../src/util/html.js';
import { buildEml } from '../src/outreach/eml.js';
import { validateRefined } from '../src/ai/codex.js';
import { extractFacts, extractServiceNames } from '../src/analysis/extract.js';
import { evaluate } from '../src/analysis/rules.js';
import { loadConfig } from '../src/config.js';

describe('CSV', () => {
  it('引用符・改行・BOM を正しく解析する', () => {
    const rows = parseCsv('﻿企業名,メモ\r\n"A,株式会社","複数\n行"\r\nB社,""""\n');
    expect(rows).toEqual([['企業名', 'メモ'], ['A,株式会社', '複数\n行'], ['B社', '"']]);
  });
  it('数式インジェクション: 出力時に無害化、取込時に検出', () => {
    const out = toCsv([['=HYPERLINK("http://evil")', '+1', '-2', '@SUM(A1)', 'normal']]);
    expect(out).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(out).toContain("'+1");
    expect(out).toContain("'@SUM(A1)");
    expect(looksLikeFormula('=1+1')).toBe(true);
    expect(looksLikeFormula('＝1')).toBe(true);
    expect(looksLikeFormula('株式会社')).toBe(false);
  });
});

describe('正規化', () => {
  it('企業名の法人格・表記ゆれを吸収', () => {
    expect(normalizeCompanyName('株式会社みなと工務店')).toBe(normalizeCompanyName('（株）みなと 工務店'));
  });
  it('URL は http(s) のみ・認証情報付き拒否', () => {
    expect(normalizeUrl('example.co.jp')).toBe('https://example.co.jp/');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('https://user:pw@example.com')).toBeNull();
    expect(domainOf('https://www.Example.com/x')).toBe('example.com');
  });
  it('不正な日時を拒否する', () => {
    expect(parseStrictDate('2026-02-31')).toBeNull();
    expect(parseStrictDate('2026-13-01')).toBeNull();
    expect(parseStrictDate('9999-01-01')).toBeNull();
    expect(parseStrictDate('2026/11/08')).toBeNull();
    expect(parseStrictDate('2026-11-08T10:00:00Z')).not.toBeNull();
    expect(parseStrictDate('2026-11-08')).not.toBeNull();
  });
});

describe('SSRF 対策', () => {
  it('内部アドレスを拒否', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0'])
      expect(isBlockedIp(ip), ip).toBe(true);
    expect(isBlockedIp('93.184.216.34')).toBe(false);
  });
  it('スキーム・ポート・内部ホスト・内部に解決されるホストを拒否', async () => {
    await expect(validateTarget('file:///etc/passwd')).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(validateTarget('http://localhost/')).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(validateTarget('http://example.com:8080/')).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(validateTarget('http://169.254.169.254/latest')).rejects.toBeInstanceOf(BlockedUrlError);
    const rebinding = async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }];
    await expect(validateTarget('http://evil.test/', rebinding)).rejects.toBeInstanceOf(BlockedUrlError);
    const ok = await validateTarget('https://good.test/', async () => [{ address: '93.184.216.34', family: 4 }]);
    expect(ok.address).toBe('93.184.216.34');
  });
  it('ローカルの HTTP サーバーには接続しない（リダイレクト先も検査）', async () => {
    const srv = http.createServer((_q, r) => r.writeHead(302, { location: 'http://127.0.0.1:1/secret' }).end());
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as any).port;
    await expect(safeFetch(`http://127.0.0.1:${port}/`, { fixturesDir: '/nonexistent' })).rejects.toBeInstanceOf(BlockedUrlError);
    srv.close();
  });
  it('固定サイトのパストラバーサルを拒否', () => {
    const cfg = loadConfig({ dataDir: '/tmp/mfs-unit', startWorker: false });
    expect(readFixture(cfg.fixturesDir, new URL('https://minato-koumuten.example/../../package.json')).status).toBe(404);
    expect(readFixture(cfg.fixturesDir, new URL('https://minato-koumuten.example/%2e%2e/%2e%2e/package.json')).status).toBe(404);
    expect(readFixture(cfg.fixturesDir, new URL('https://minato-koumuten.example/')).status).toBe(200);
  });
  it('robots.txt と Retry-After の解釈', () => {
    expect(parseRobots('User-agent: *\nDisallow: /private\n\nUser-agent: other\nDisallow: /')).toEqual(['/private']);
    expect(parseRetryAfter('120')).toBe(120);
    expect(parseRetryAfter(undefined)).toBe(60);
    expect(parseRetryAfter('99999')).toBe(3600);
  });
});

describe('営業可否の自動判定', () => {
  it('営業禁止表示を検出し、送信可は自動で出さない', () => {
    expect(findProhibition('営業・勧誘目的のお問い合わせはお断りしております')).toBeTruthy();
    expect(findProhibition('セールスのご連絡はご遠慮ください')).toBeTruthy();
    expect(findProhibition('お気軽にお問い合わせください')).toBeNull();
    expect(findSalesDesk('営業・業者の方からのご連絡は partner@x.example までお願いします')).toBeTruthy();
    const a = assessFromPages([{ url: 'u', text: 'info@x.example' }], 'info@x.example');
    expect(a.verdict).toBe('needs_review');
    const b = assessFromPages([{ url: 'u', text: '営業お断り' }], '');
    expect(b.verdict).toBe('blocked');
  });
});

describe('営業文の品質チェック', () => {
  const sender = { companyName: '架空社', contactName: '山田', address: '横浜市', phone: '', email: 's@x.example', optOutEmail: '' };
  const base = `架空社 山田 横浜市 s@x.example\n試作（デモ）であり、正式な制作物ではありません。\nURL https://p/1 コード ABCD\n配信停止はご返信ください`;
  it('必須表示があれば通過', () => {
    expect(checkQuality(base, '件名', sender, { previewUrl: 'https://p/1', viewCode: 'ABCD', observationCount: 2 }).ok).toBe(true);
  });
  it('根拠のない効果保証を拒否', () => {
    const r = checkQuality(base + '\nリニューアルで問い合わせが倍増します。', '件名', sender, { previewUrl: 'https://p/1', viewCode: 'ABCD', observationCount: 2 });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('効果保証');
    expect(checkQuality(base + '\n売上が必ず上がります', '件名', sender, { previewUrl: 'https://p/1', viewCode: 'ABCD', observationCount: 2 }).ok).toBe(false);
  });
  it('配信停止・住所・プレビューURLの欠落を拒否', () => {
    const r = checkQuality('架空社 山田 s@x.example', '件名', sender, { previewUrl: 'https://p/1', viewCode: 'ABCD', observationCount: 0 });
    expect(r.errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe('XSS・ヘッダインジェクション', () => {
  it('テンプレートは自動エスケープ', () => {
    expect(html`<p>${'<script>alert(1)</script>'}</p>`.value).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(esc(`"'`)).toBe('&quot;&#39;');
    expect(safeHref('javascript:alert(1)')).toBe('#');
  });
  it('EML のヘッダに改行を注入できない', () => {
    expect(() => buildEml({ from: 'a@x.example', fromName: 'A', to: 'b@x.example\r\nBcc: c@evil', subject: 's', body: 'b', messageIdDomain: 'x' })).toThrow();
    const eml = buildEml({ from: 'a@x.example', fromName: 'A', to: 'b@x.example', subject: '件名\r\nBcc: c@evil', body: 'b', messageIdDomain: 'x' });
    expect(eml).not.toMatch(/^Bcc:/m);
  });
});

describe('AI 出力の検証', () => {
  it('事実が欠落した出力は採用しない', () => {
    expect(validateRefined('{"body":"' + 'あ'.repeat(60) + '"}', ['ABCD']).ok).toBe(false);
    expect(validateRefined('説明のみ', []).ok).toBe(false);
    const ok = validateRefined('{"body":"' + 'あ'.repeat(60) + ' ABCD"}', ['ABCD']);
    expect(ok.ok).toBe(true);
  });
});

describe('分析ルール', () => {
  it('取得できなければ全項目「未確認」（問題なしと推定しない）', () => {
    const f = evaluate({ top: null, pages: [], pc: null, sp: null, fetchError: 'timeout' });
    expect(f).toHaveLength(7);
    expect(f.every((x) => x.status === 'unverified')).toBe(true);
  });
  it('ブラウザ未接続時は表示系を未確認とする', () => {
    const facts = extractFacts('https://a.example/', '<html><head><meta name="viewport" content="width=device-width"><title>t</title></head><body><h1>見出し</h1><a href="/contact">お問い合わせ</a></body></html>');
    const f = evaluate({ top: facts, pages: [facts], pc: null, sp: null });
    expect(f.find((x) => x.category === 1)!.status).toBe('unverified');
  });
  it('サービス名は列挙文からのみ抽出し、地名の列挙は除外', () => {
    const p = extractFacts('https://a.example/', '<body><p>注文住宅／リフォーム／外壁塗装 など</p><p>対応エリア：港北区、都筑区、神奈川区</p></body>');
    expect(extractServiceNames([p])).toEqual(['注文住宅', 'リフォーム', '外壁塗装']);
  });
});
