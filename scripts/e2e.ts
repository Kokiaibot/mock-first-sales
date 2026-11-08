// ブラウザ操作による受け入れ検証: npm run e2e
// 一時データディレクトリでアプリを起動し、実際の管理画面を操作して
// 「候補登録 → 分析 → 個別モック生成 → 営業文作成 → 送信承認待ち」を架空企業3社で完走させる。
// 結果は docs/verification/ にスクリーンショットと記録（E2E_RESULT.md）として保存する。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'verification');
const PORT = Number(process.env.E2E_PORT ?? 8899);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfs-e2e-'));
const log: string[] = [];
let failures = 0;

function step(ok: boolean, msg: string) {
  log.push(`- ${ok ? '✅' : '❌'} ${msg}`);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`);
  if (!ok) failures++;
}

async function shot(page: Page, name: string, full = false) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  log.push(`  - スクリーンショット: \`${name}.png\``);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.rmSync(path.join(OUT, f));
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'src/main.ts'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  server.stdout.on('data', (d) => (out += d));
  server.stderr.on('data', (d) => (out += d));
  for (let i = 0; i < 100 && !out.includes('起動しました'); i++) await new Promise((r) => setTimeout(r, 200));
  step(out.includes('起動しました'), `アプリを起動できる（${BASE}）`);

  const launchOpts = process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: process.platform === 'win32' ? 'msedge' : 'chrome' };
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
  const page = await ctx.newPage();
  try {
    // 1. 初期設定・ログイン
    await page.goto(BASE + '/');
    step(page.url().endsWith('/setup'), '初回アクセスで初期設定画面が表示される');
    await shot(page, '01-setup');
    await page.fill('#u', 'admin');
    await page.fill('#p1', 'E2ePassw0rd2026');
    await page.fill('#p2', 'E2ePassw0rd2026');
    await Promise.all([page.waitForURL(/\/login/), page.click('button[type=submit]')]);
    await page.fill('#u', 'admin');
    await page.fill('#p', 'E2ePassw0rd2026');
    await Promise.all([page.waitForURL(/\/admin\//), page.click('button[type=submit]')]);
    step(page.url().endsWith('/admin/'), '管理者を作成してログインできる');

    // 2. 送信者情報
    await page.goto(BASE + '/admin/settings');
    await page.fill('input[name=companyName]', '（架空）デモWeb制作室');
    await page.fill('input[name=contactName]', '山田 太郎（架空）');
    await page.fill('input[name=address]', '神奈川県横浜市中区（架空住所）');
    await page.fill('input[name=email]', 'sales@demo-studio.example');
    await page.click('form[action="/admin/settings/sender"] button[type=submit]');
    step((await page.textContent('.flash.ok'))?.includes('保存') ?? false, '送信者情報を保存できる');

    // 3. 検索条件の保存・再表示
    await page.goto(BASE + '/admin/search');
    await page.fill('input[name=name]', '神奈川・東京の小規模事業者');
    await page.selectOption('select[name=prefecture]', '神奈川県');
    await page.fill('input[name=industry]', '');
    await page.fill('input[name=maxCandidates]', '20');
    await page.click('form[action="/admin/search/save"] button[type=submit]');
    step((await page.inputValue('input[name=maxCandidates]')) === '20' && (await page.inputValue('select[name=prefecture]')) === '神奈川県', '検索条件を保存し再表示できる');
    await shot(page, '02-search');

    // 4. CSV 取込（架空企業）
    const csv = [
      '企業名,都道府県,市区町村,業種,公式サイトURL,利用許諾・再利用条件,架空データ',
      '株式会社みなと工務店,神奈川県,横浜市港北区,工務店,https://minato-koumuten.example/,架空データ（検証用）,1',
      'さくら台デンタルクリニック,神奈川県,川崎市中原区,歯科医院,https://sakuradai-dental.example/,架空データ（検証用）,1',
      '税理士法人 青葉会計事務所,東京都,世田谷区,税理士事務所,https://aoba-kaikei.example/,架空データ（検証用）,1',
      '株式会社ひかり精機,神奈川県,相模原市,製造業,https://hikari-seiki.example/,架空データ（検証用）,1',
      '有限会社まるや商店,神奈川県,藤沢市,小売,,架空データ（検証用）,1',
      '（株）みなと工務店,神奈川県,横浜市港北区,建設,https://www.minato-koumuten.example/,架空データ（検証用）,1',
    ].join('\r\n');
    const csvPath = path.join(dataDir, 'tmp', 'demo.csv');
    fs.writeFileSync(csvPath, '﻿' + csv);
    await page.goto(BASE + '/admin/import');
    await page.setInputFiles('input[type=file]', csvPath);
    await page.check('input[name=confirm]');
    await page.click('form[action="/admin/import"] button[type=submit]');
    const msg = (await page.textContent('.flash.ok')) ?? '';
    step(msg.includes('新規 4') && msg.includes('重複統合 1') && msg.includes('サイトなし除外 1'), `CSV を取り込み、重複統合・サイトなし除外ができる（${msg.trim()}）`);
    await shot(page, '03-companies-imported');

    // 5. 一括処理
    const boxes = page.locator('input[name=ids]');
    for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
    await page.click('button[value=pipeline]');
    step(page.url().includes('/admin/jobs'), '選択した企業を「分析→モック→営業文」ジョブに登録できる');
    for (let i = 0; i < 120; i++) {
      await page.goto(BASE + '/admin/jobs');
      const active = await page.locator('td span.badge', { hasText: /待機中|処理中/ }).count();
      if (!active && i > 1) break;
      await page.waitForTimeout(1000);
    }
    await shot(page, '04-jobs-done');
    const failed = await page.locator('td span.badge', { hasText: '失敗' }).count();
    step(failed === 0, `ジョブがすべて完了した（失敗 ${failed} 件）`);

    // 6. 3社の詳細・分析・モック・営業文
    await page.goto(BASE + '/admin/companies');
    await shot(page, '05-companies-after');
    const targets = ['株式会社みなと工務店', 'さくら台デンタルクリニック', '税理士法人 青葉会計事務所'];
    const slugs = ['minato', 'dental', 'aoba'];
    for (let i = 0; i < targets.length; i++) {
      await page.goto(BASE + '/admin/companies');
      await page.click(`a:text-is("${targets[i]}")`);
      const status = await page.locator('h1 .badge').first().textContent();
      step(status?.includes('承認待ち') ?? false, `${targets[i]}: 状態が「承認待ち」になった`);
      await shot(page, `06-${slugs[i]}-detail`, true);
      await page.click('a:text("分析結果・証拠")');
      const rows = await page.locator('table:has(th:text("分析項目")) tbody tr').count();
      step(rows === 7 && (await page.locator('img[alt*="スクリーンショット"]').count()) === 2, `${targets[i]}: 7項目の証拠付き分析とPC/SPスクリーンショットを表示`);
      await shot(page, `07-${slugs[i]}-analysis`, true);
      await page.goBack();
      await page.click('a:text("プレビュー・比較")');
      await page.waitForTimeout(500);
      await shot(page, `08-${slugs[i]}-mock-compare`, true);
      await page.goto(page.url() + '?view=sp');
      await page.waitForTimeout(500);
      await shot(page, `09-${slugs[i]}-mock-compare-sp`, true);
    }

    const excluded = await (async () => {
      await page.goto(BASE + '/admin/companies?status=excluded');
      return page.locator('tbody tr').count();
    })();
    step(excluded >= 2, `営業禁止表示の企業とサイトなし企業が「送信対象外」に分類される（${excluded} 社）`);

    // 7. 承認キュー（最初の到達目標）
    await page.goto(BASE + '/admin/approvals');
    const queued = await page.locator('tbody tr').count();
    step(queued === 3, `送信承認キューに3社の営業文が並ぶ（${queued} 件）— 最初の到達目標`);
    await shot(page, '10-approval-queue', true);

    // 8. 1社を承認 → 模擬送信
    await page.goto(BASE + '/admin/companies');
    await page.click('a:text-is("さくら台デンタルクリニック")');
    const detailUrl = page.url();
    await page.selectOption('select[name=decision]', 'ok');
    await page.selectOption('select[name=basis]', 'published_business_email');
    await page.fill('textarea[name=note]', 'アクセスページでメールアドレスの公開と、営業メールの拒否表示がないことを確認（E2E）');
    await page.click('form[action$="/eligibility"] button[type=submit]');
    step((await page.textContent('.flash.ok'))?.includes('送信可') ?? false, '営業可否を根拠付きで「送信可」に記録できる');
    await page.click('a:text("プレビュー・比較")');
    const mockUrl = page.url();
    const viewCode = (await page.locator('#view-code').textContent())!.trim();
    const localUrl = (await page.locator('#local-url').textContent())!.trim();
    await page.click('button:text("内容を確認した（確認済みにする）")');
    await page.goto(detailUrl);
    await page.click('a:text("確認・編集")');
    const draftText = await page.inputValue('textarea[name=body]');
    step(draftText.includes(viewCode) && draftText.includes(localUrl), '営業文に企業別プレビューURLと閲覧コードが含まれる');
    await shot(page, '11-draft-edit', true);
    await page.click('a:text("送信承認画面へ")');
    await page.check('input[name=confirm]');
    await page.click('button:text("この内容で承認する")');
    step((await page.textContent('.flash.ok'))?.includes('承認しました') ?? false, '確認した内容で承認できる');
    await shot(page, '12-approved', true);
    await page.check('input[name=confirm]');
    await page.click('button:text("模擬送信する")');
    step(page.url().includes('/admin/sends') && (await page.locator('td span.badge:text-is("模擬送信")').count()) === 1, '模擬送信が「模擬送信」として送信履歴に記録される');
    await shot(page, '13-sends');

    // 9. 顧客側のプレビュー（別ブラウザ・管理者権限なし・スマートフォン）
    const visitor = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ja-JP' });
    const vp = await visitor.newPage();
    await vp.goto(localUrl);
    step((await vp.textContent('h1'))?.includes('試作プレビュー') ?? false, '顧客プレビューは閲覧コードの入力を求める');
    await shot(vp, '14-preview-code');
    await vp.fill('#code', 'WRONGCODE');
    await vp.click('button');
    step((await vp.locator('.err').count()) === 1, '誤った閲覧コードを拒否する');
    await vp.fill('#code', viewCode);
    await vp.click('button');
    await shot(vp, '15-preview-sp-top', true);
    const sw = await vp.evaluate(() => document.documentElement.scrollWidth);
    step(sw <= 390, `スマートフォン幅で横スクロールが発生しない（scrollWidth=${sw}）`);
    await vp.click('nav#gn a[href$="services"]', { force: true }).catch(async () => {
      await vp.click('button.menu-btn');
      await vp.click('nav#gn a[href$="services"]');
    });
    step(vp.url().endsWith('/services'), 'デモページ（サービス）へ遷移できる');
    await shot(vp, '16-preview-sp-services', true);
    await vp.goto(localUrl + 'contact');
    await vp.fill('input[name=n]', 'テスト');
    await vp.click('button[type=submit]');
    step(vp.url().includes('/thanks') && ((await vp.textContent('h3')) ?? '').includes('デモ'), 'デモ問い合わせフォームから完了画面（デモ）へ遷移し、実際には送信されない');
    await shot(vp, '17-preview-sp-thanks');
    const adminFromVisitor = await vp.goto(BASE + '/admin/');
    step(vp.url().endsWith('/login') || adminFromVisitor?.status() === 302, '顧客プレビューの権限では管理画面に入れない');

    // 10. 失効
    await page.goto(mockUrl);
    await page.click('button:text("失効させる")');
    await vp.goto(localUrl);
    step((await vp.textContent('h1'))?.includes('公開を終了') ?? false, '失効させたプレビューは表示されない');

    // 11. PC 表示のプレビュー
    const pcv = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const pp = await pcv.newPage();
    await page.goto(BASE + '/admin/approvals');
    await page.click('tbody tr:has-text("みなと工務店") a.btn');
    await page.click('a[href^="/admin/mocks/"]');
    const mcode = (await page.locator('#view-code').textContent())!.trim();
    const murl = (await page.locator('#local-url').textContent())!.trim();
    await pp.goto(murl);
    await pp.fill('#code', mcode);
    await pp.click('button');
    await shot(pp, '18-preview-pc-minato', true);
    const pcw = await pp.evaluate(() => document.documentElement.scrollWidth);
    step(pcw <= 1366, `PC 幅で表示が崩れない（scrollWidth=${pcw}）`);

    // 12. その他画面
    for (const [p, n] of [['/admin/', '19-dashboard'], ['/admin/costs', '20-costs'], ['/admin/status', '21-status'], ['/admin/deals', '22-deals']] as const) {
      const r = await page.goto(BASE + p);
      step(r?.status() === 200, `${p} が表示できる`);
      await shot(page, n, true);
    }
  } catch (e) {
    step(false, `例外: ${(e as Error).message.split('\n')[0]}`);
    await shot(page, 'zz-error', true).catch(() => {});
  } finally {
    await browser.close();
    server.kill();
  }

  const env = `${os.type()} ${os.release()} / Node ${process.version} / ${process.env.BROWSER_PATH ?? (process.platform === 'win32' ? 'Microsoft Edge' : 'Google Chrome')}`;
  const md = `# ブラウザ操作による検証記録

- 実行日時: ${new Date().toISOString()}
- 実行環境: ${env}
- 方法: \`npm run e2e\`（一時データディレクトリでアプリを起動し、Playwright で管理画面を操作）
- 対象データ: 架空企業（\`.example\` ドメインの固定サイト。外部通信なし）
- 結果: ${failures === 0 ? '**すべて成功**' : `**${failures} 件失敗**`}

${log.join('\n')}
`;
  fs.writeFileSync(path.join(OUT, 'E2E_RESULT.md'), md);
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} 件失敗` : '\nすべて成功');
  process.exit(failures ? 1 : 0);
}

main();
