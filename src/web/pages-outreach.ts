// モックプレビュー・比較、営業文編集、送信承認キュー、送信履歴、AI 推敲
import fs from 'node:fs';
import path from 'node:path';
import type { Hono } from 'hono';
import type { Env, Ctx } from './app.js';
import { all, get, audit, getSetting } from '../db.js';
import { html, safeHref } from '../util/html.js';
import { page, csrfField, postButton, fmt, statusBadge } from './layout.js';
import { form, str, idParam, redirectFlash, flashOf } from './helpers.js';
import { getCompany } from '../domain/companies.js';
import { getMock, mockSpec, previewState, previewUrls, revokeMock, reissueMock, markReviewed } from '../mock/service.js';
import { renderMock, type MockPage } from '../mock/render.js';
import { getDraft, updateDraft } from '../outreach/draft.js';
import { approve, approvalBlockers, contentHash, evaluateApproval, revokeApproval, sendApproved, approvalQueue, resolveUnknownSend, approvalSnapshot } from '../outreach/approval.js';
import { buildEml } from '../outreach/eml.js';
import { getSender } from '../outreach/draft.js';
import { latestAnalysis, findingsOf } from '../analysis/analyze.js';
import { CATEGORIES } from '../analysis/rules.js';
import { buildRefinePrompt, runCodex, validateRefined, codexStatus } from '../ai/codex.js';
import { logUsage } from '../domain/usage.js';

const MOCK_IFRAME_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'self'; base-uri 'none'";

export function registerOutreach(app: Hono<Env>, ctx: Ctx) {
  const { db, cfg } = ctx;

  // ---- モック：プレビュー・比較・管理 ----
  app.get('/admin/mocks/:id', (c) => {
    const s = c.get('session');
    const m = getMock(db, idParam(c));
    if (!m) return c.notFound();
    const co = getCompany(db, m.company_id)!;
    const spec = mockSpec(m);
    const urls = previewUrls(cfg, m);
    const st = previewState(m);
    const cur = all(db, "SELECT * FROM screenshots WHERE company_id = ? AND kind IN ('pc','sp') ORDER BY id DESC LIMIT 2", co.id);
    const pcShot = cur.find((x) => x.kind === 'pc');
    const view = c.req.query('view') === 'sp' ? 'sp' : 'pc';
    const body = html`<h1>モックプレビュー・比較：${co.name}</h1>
<div class="next"><b>状態：</b>${m.superseded ? '旧版（新しいモックがあります）' : { active: '公開中', expired: '期限切れ', revoked: '失効' }[st]}
<b>管理者確認：</b>${m.admin_reviewed_at ? `確認済み（${fmt(m.admin_reviewed_at)}）` : '未確認 — 内容を確認して「確認済みにする」を押してください（承認の前提条件）'}</div>
<div class="grid">
<div class="card"><h2 style="margin-top:0">顧客向けプレビュー</h2>
<table><tr><th>ローカルURL</th><td><code>${urls.local}</code><div class="small mute">この PC からのみ閲覧可能（相手先からは見られません）</div></td></tr>
<tr><th>外部閲覧URL</th><td>${urls.external ? html`<code>${urls.external}</code>` : html`<span class="badge warn">未設定</span><div class="small mute">公開環境へのデプロイは承認後に行う段階のため未実装です</div>`}</td></tr>
<tr><th>閲覧コード</th><td><code style="font-size:16px;letter-spacing:.15em">${m.view_code}</code></td></tr>
<tr><th>有効期限</th><td>${fmt(m.expires_at)}</td></tr>
<tr><th>識別子</th><td class="small">推測困難なランダム値（192bit）。検索エンジン登録防止: noindex メタ・X-Robots-Tag・robots.txt</td></tr></table>
<div class="row" style="margin-top:10px">${m.admin_reviewed_at ? '' : postButton(s, `/admin/mocks/${m.id}/review`, '内容を確認した（確認済みにする）', 'ok')}
${postButton(s, `/admin/mocks/${m.id}/revoke`, '失効させる', 'ng')}
<form method="post" action="/admin/mocks/${m.id}/reissue" class="inline">${csrfField(s)}<input name="days" type="number" min="1" max="90" value="14" style="width:70px" aria-label="有効日数">日で<button class="sec" type="submit">URL・コードを再発行</button></form></div>
<p class="small mute">再発行・失効すると旧URLは使えなくなり、この営業文の承認は解除されます。</p></div>
<div class="card"><h2 style="margin-top:0">このモックの内容</h2><table>
<tr><th>業種テンプレート</th><td>${spec.industryLabel}（レイアウト: ${spec.layout}）</td></tr>
<tr><th>配色</th><td><span style="display:inline-block;width:18px;height:18px;border-radius:4px;vertical-align:middle;background:${/^#[0-9a-f]{6}$/i.test(spec.palette.primary) ? spec.palette.primary : '#999'}"></span> ${spec.palette.source}</td></tr>
<tr><th>見出し</th><td>${spec.hero.headline}<div class="small mute">リード文: ${spec.hero.leadSource}</div></td></tr>
<tr><th>生成方法</th><td><span class="badge src-template">テンプレート＋ルール</span>（AI 未使用）</td></tr>
<tr><th>動く機能</th><td>${spec.workingFeatures.join('／')}</td></tr><tr><th>ダミー機能</th><td>${spec.dummyFeatures.join('／')}</td></tr>
<tr><th>素材の出典</th><td class="small">${spec.assets.map((a) => `${a.name}: ${a.source}（${a.license}）`).join('／')}</td></tr></table>
<p class="small mute">「80%完成」とは実測の進捗率ではなく、顧客がデザインと主要構成を検討できる完成度を指します。</p></div></div>

<div class="card"><h2 style="margin-top:0">既存サイトと改善案の比較</h2>
<div class="row" style="margin-bottom:8px"><a class="btn ${view === 'pc' ? '' : 'sec'}" href="?view=pc">PC表示</a><a class="btn ${view === 'sp' ? '' : 'sec'}" href="?view=sp">スマートフォン表示</a>
<a class="btn sec" href="/admin/mocks/${m.id}/view/">モックを全画面で開く</a></div>
<div class="cmp"><div><h3>現在のサイト（${fmt(pcShot?.created_at)} 撮影）</h3>${pcShot ? html`<img src="/admin/screenshots/${view === 'sp' ? cur.find((x) => x.kind === 'sp')?.id ?? pcShot.id : pcShot.id}" alt="既存サイト" style="width:${view === 'sp' ? '390px' : '100%'};border:1px solid #e1e4e8;border-radius:8px">` : html`<p class="mute">スクリーンショット未取得</p>`}</div>
<div><h3>リニューアル試作</h3><iframe title="モック" class="${view === 'sp' ? 'frame-sp' : ''}" src="/admin/mocks/${m.id}/view/" sandbox="allow-same-origin allow-scripts allow-forms"></iframe></div></div>
<h3>主な改善点</h3><table><tr><th>項目</th><th>現在（観察した事実）</th><th>試作での方針</th></tr>${spec.improvements.map((i) => html`<tr><td>${CATEGORIES[Number(i.category)]}</td><td class="small">${i.before}</td><td>${i.after}</td></tr>`)}</table></div>
<p><a href="/admin/companies/${co.id}">← 企業詳細へ</a></p>`;
    return c.html(page('モックプレビュー', 'companies', s, body, flashOf(c)));
  });

  const viewHandler = (c: any) => {
    const m = getMock(db, idParam(c));
    if (!m) return c.notFound();
    const pg = (c.req.param('page') || 'index') as MockPage;
    if (!['index', 'services', 'contact', 'thanks'].includes(pg)) return c.notFound();
    c.header('Content-Security-Policy', MOCK_IFRAME_CSP);
    c.header('X-Frame-Options', 'SAMEORIGIN');
    return c.html(renderMock(mockSpec(m), pg, { base: `/admin/mocks/${m.id}/view/`, audience: 'admin', expiresAt: m.expires_at }));
  };
  app.get('/admin/mocks/:id/view/', viewHandler);
  app.get('/admin/mocks/:id/view/:page', viewHandler);

  app.post('/admin/mocks/:id/review', async (c) => {
    const id = idParam(c);
    markReviewed(db, id, `admin:${c.get('session').adminId}`);
    return redirectFlash(c, `/admin/mocks/${id}`, { ok: '確認済みにしました' });
  });
  app.post('/admin/mocks/:id/revoke', async (c) => {
    const id = idParam(c);
    revokeMock(db, id, `admin:${c.get('session').adminId}`);
    return redirectFlash(c, `/admin/mocks/${id}`, { ok: '失効させました。旧URLは表示できなくなります' });
  });
  app.post('/admin/mocks/:id/reissue', async (c) => {
    const id = idParam(c);
    const f = await form(c);
    const m = getMock(db, id);
    try {
      reissueMock(db, id, Number(str(f, 'days')), `admin:${c.get('session').adminId}`);
    } catch (e) {
      return redirectFlash(c, `/admin/mocks/${id}`, { err: (e as Error).message });
    }
    // 下書き中のURL・コードは古くなるため、営業文の再作成を促す
    const d = get(db, 'SELECT id FROM drafts WHERE mock_id = ? AND archived = 0', id);
    return redirectFlash(c, `/admin/mocks/${id}`, { ok: `再発行しました。${d ? `営業文 #${d.id} の URL・コードを更新してください（品質チェックで検出されます）` : ''}`, err: m ? undefined : undefined });
  });

  // ---- 営業文 ----
  app.get('/admin/drafts/:id', (c) => {
    const s = c.get('session');
    const d = getDraft(db, idParam(c));
    if (!d) return c.notFound();
    const co = getCompany(db, d.company_id)!;
    const m = getMock(db, d.mock_id)!;
    const q = JSON.parse(d.quality || '{}');
    const st = evaluateApproval(db, d);
    const blockers = approvalBlockers(db, cfg, d);
    const hash = contentHash(db, d);
    const urls = previewUrls(cfg, m);
    const ai = getSetting(db, 'ai', { enabled: false });
    const methodBadge = d.generation_method.includes('ai') ? html`<span class="badge src-ai">AI推敲あり</span>` : html`<span class="badge src-template">テンプレート生成</span>`;
    const body = html`<h1>営業文の確認・編集：${co.name}</h1>
<div class="next"><b>承認状態：</b>${{ none: '未承認', valid: `承認済み（${fmt(st.approval?.approved_at)}、期限 ${fmt(st.approval?.expires_at)}）`, invalidated: `承認解除（${st.reason}）`, expired: '承認期限切れ' }[st.state]}
${d.archived ? html`<br><span class="badge mute">旧版の下書きです</span>` : ''}</div>
<div class="grid"><div class="card"><h2 style="margin-top:0">編集</h2>
<form method="post" action="/admin/drafts/${d.id}">${csrfField(s)}
<label>宛先（営業リストに登録されたアドレスのみ送信可）</label><input name="recipient" value="${d.recipient}" style="width:100%">
<label>件名</label><input name="subject" value="${d.subject}" style="width:100%" maxlength="200">
<label>本文</label><textarea name="body" rows="26">${d.body}</textarea>
<p class="small mute">保存すると承認は解除され、品質チェックを再実行します。</p><p><button type="submit">保存</button> ${methodBadge}</p></form></div>
<div><div class="card"><h2 style="margin-top:0">品質チェック（ルール）</h2>
${q.errors?.length ? html`<ul class="flash err">${q.errors.map((e: string) => html`<li>${e}</li>`)}</ul>` : html`<p class="badge ok">必須項目・禁止表現のチェックを通過</p>`}
${q.warnings?.length ? html`<ul class="small">${q.warnings.map((e: string) => html`<li>${e}</li>`)}</ul>` : ''}
<p class="small mute">特定電子メール法の表示項目の確認は補助機能であり、法令適合を保証するものではありません。</p></div>
<div class="card"><h2 style="margin-top:0">プレビューとの一致</h2><table>
<tr><th>モック</th><td><a href="/admin/mocks/${m.id}">#${m.id}</a>（${{ active: '公開中', expired: '期限切れ', revoked: '失効' }[previewState(m)]}）</td></tr>
<tr><th>本文中のURL</th><td>${d.body.includes(urls.external ?? urls.local) ? html`<span class="badge ok">現在のURLと一致</span>` : html`<span class="badge ng">不一致</span>`}</td></tr>
<tr><th>閲覧コード</th><td>${d.body.includes(m.view_code) ? html`<span class="badge ok">一致</span>` : html`<span class="badge ng">不一致</span>`}</td></tr></table></div>
<div class="card"><h2 style="margin-top:0">AI による推敲（任意）</h2>
${ai.enabled ? html`<form method="post" action="/admin/drafts/${d.id}/ai-preview">${csrfField(s)}<button class="sec" type="submit">送信内容を確認する（まだ送信しません）</button></form>`
  : html`<p class="small mute">AI 連携は無効です（送信者情報・連携設定で有効化）。AI 未接続でも全機能を利用できます。</p>`}</div>
<div class="card"><h2 style="margin-top:0">次の操作</h2>${blockers.length ? html`<p>承認できない理由：</p><ul class="small">${blockers.map((b) => html`<li>${b}</li>`)}</ul>` : html`<p class="badge ok">承認可能です</p>`}
<p><a class="btn" href="/admin/approvals/${d.id}">送信承認画面へ</a></p></div></div></div>
<p><a href="/admin/companies/${co.id}">← 企業詳細へ</a></p>`;
    void hash;
    return c.html(page('営業文', 'approvals', s, body, flashOf(c)));
  });

  app.post('/admin/drafts/:id', async (c) => {
    const id = idParam(c);
    const f = await form(c);
    try {
      updateDraft(db, cfg, id, { subject: str(f, 'subject'), body: str(f, 'body'), recipient: str(f, 'recipient') }, `admin:${c.get('session').adminId}`);
    } catch (e) {
      return redirectFlash(c, `/admin/drafts/${id}`, { err: (e as Error).message });
    }
    return redirectFlash(c, `/admin/drafts/${id}`, { ok: '保存しました（承認は解除されました）' });
  });

  // AI: 送信内容の表示 → 利用者の同意 → 実行
  app.post('/admin/drafts/:id/ai-preview', async (c) => {
    const s = c.get('session');
    const d = getDraft(db, idParam(c));
    if (!d) return c.notFound();
    const co = getCompany(db, d.company_id)!;
    const a = latestAnalysis(db, d.company_id);
    const obs = a ? findingsOf(db, a.id).filter((f) => f.status === 'issue').map((f) => `${CATEGORIES[f.category]}: ${f.fact}`) : [];
    const prompt = buildRefinePrompt({ companyName: co.name, observations: obs, draftBody: d.body });
    const st = codexStatus();
    return c.html(page('AI 推敲の確認', 'approvals', s, html`<h1>外部 AI（Codex CLI）へ送信する内容の確認</h1>
<div class="card"><p><b>送信先：</b>Codex CLI（ChatGPT ログイン）→ OpenAI のサーバー</p><p><b>必要性：</b>営業文の言い回しを整えるため。事実・URL・署名は変更させません。</p>
<p><b>費用：</b>ChatGPT プランの Codex 利用枠を消費します（金額は未計測。利用枠には上限があります）。API キーへの自動切替は行いません。</p>
<p><b>Codex の状態：</b>${st.installed ? `インストール済み ${st.version}` : '未インストール'}／ログイン: ${st.loggedIn}／${st.detail}</p></div>
<h2>送信される全文</h2><pre class="small">${prompt}</pre>
<form method="post" action="/admin/drafts/${d.id}/ai-run" class="card">${csrfField(s)}<input type="hidden" name="prompt_hash" value="${contentHash(db, d)}">
<label><input type="checkbox" name="consent" required> 上記の内容（宛先企業名・観察内容・下書き本文）を外部 AI に送信することに同意します</label>
<p><button type="submit" ${st.installed && st.loggedIn !== 'no' ? '' : 'disabled'}>同意して送信</button> <a class="btn sec" href="/admin/drafts/${d.id}">やめる</a></p></form>`));
  });

  app.post('/admin/drafts/:id/ai-run', async (c) => {
    const s = c.get('session');
    const id = idParam(c);
    const d = getDraft(db, id);
    const f = await form(c);
    if (!d) return c.notFound();
    if (str(f, 'consent') !== 'on') return redirectFlash(c, `/admin/drafts/${id}`, { err: '外部送信への同意がありません' });
    if (str(f, 'prompt_hash') !== contentHash(db, d)) return redirectFlash(c, `/admin/drafts/${id}`, { err: '確認後に内容が変わったため送信しませんでした' });
    const co = getCompany(db, d.company_id)!;
    const m = getMock(db, d.mock_id)!;
    const a = latestAnalysis(db, d.company_id);
    const obs = a ? findingsOf(db, a.id).filter((x) => x.status === 'issue').map((x) => `${CATEGORIES[x.category]}: ${x.fact}`) : [];
    const sender = getSender(db);
    audit(db, `admin:${s.adminId}`, 'ai.send', `draft:${id}`, 'codex exec');
    try {
      const out = await runCodex(buildRefinePrompt({ companyName: co.name, observations: obs, draftBody: d.body }));
      logUsage(db, { service: 'codex-cli', operation: 'refine-draft', companyId: co.id, units: '1 call', costStatus: 'plan_quota' });
      const v = validateRefined(out, [m.view_code, previewUrls(cfg, m).external ?? previewUrls(cfg, m).local, sender.companyName, sender.address, sender.email, '配信停止']);
      if (!v.ok) return redirectFlash(c, `/admin/drafts/${id}`, { err: `AI の出力を採用しませんでした: ${v.reason}` });
      updateDraft(db, cfg, id, { subject: d.subject, body: v.body, recipient: d.recipient }, `admin:${s.adminId}`, 'ai');
      return redirectFlash(c, `/admin/drafts/${id}`, { ok: 'AI の推敲結果を反映しました。必ず内容を確認してください（承認は解除されています）' });
    } catch (e) {
      logUsage(db, { service: 'codex-cli', operation: 'refine-draft(failed)', companyId: co.id, costStatus: 'unmeasured', detail: (e as Error).message });
      return redirectFlash(c, `/admin/drafts/${id}`, { err: `Codex 実行に失敗しました: ${(e as Error).message}` });
    }
  });

  // ---- 送信承認キュー ----
  app.get('/admin/approvals', (c) => {
    const s = c.get('session');
    const rows = approvalQueue(db);
    const body = html`<h1>送信承認キュー</h1>
<p class="mute">承認は利用者だけが行えます。自動処理・AI が承認することはありません。承認後に宛先・本文・関連情報が変わると承認は自動で解除されます。</p>
<table><thead><tr><th>企業</th><th>件名</th><th>宛先</th><th>営業可否</th><th>承認状態</th><th>承認の可否</th><th></th></tr></thead><tbody>
${rows.length ? rows.map((d) => {
      const st = evaluateApproval(db, d);
      const b = approvalBlockers(db, cfg, d);
      return html`<tr><td><a href="/admin/companies/${d.company_id}">${d.company_name}</a></td><td>${d.subject}</td><td>${d.recipient || '—'}</td>
<td>${d.eligibility === 'ok' ? html`<span class="badge ok">送信可</span>` : html`<span class="badge warn">未確定</span>`}</td>
<td>${{ none: '未承認', valid: '承認済み', invalidated: `解除（${st.reason}）`, expired: '期限切れ' }[st.state]}</td>
<td class="small">${b.length ? html`<span class="badge ng">不可 ${b.length}件</span>` : html`<span class="badge ok">可</span>`}</td><td><a class="btn" href="/admin/approvals/${d.id}">確認</a></td></tr>`;
    }) : html`<tr><td colspan="7" class="mute">承認待ちの営業文はありません</td></tr>`}</tbody></table>`;
    return c.html(page('送信承認キュー', 'approvals', s, body, flashOf(c)));
  });

  app.get('/admin/approvals/:id', (c) => {
    const s = c.get('session');
    const d = getDraft(db, idParam(c));
    if (!d) return c.notFound();
    const co = getCompany(db, d.company_id)!;
    const m = getMock(db, d.mock_id)!;
    const st = evaluateApproval(db, d);
    const blockers = approvalBlockers(db, cfg, d);
    const hash = contentHash(db, d);
    const snap = approvalSnapshot(db, d);
    const body = html`<h1>送信承認：${co.name} ${statusBadge(co.status)}</h1>
<div class="next"><b>承認状態：</b>${{ none: '未承認', valid: '承認済み', invalidated: `解除（${st.reason}）`, expired: '期限切れ' }[st.state]}　<b>送信方式：</b>模擬送信（外部には送信しません。EML を出力します）</div>
<div class="grid"><div class="card"><h2 style="margin-top:0">確認する内容</h2><table>
<tr><th>対象企業</th><td>${co.name}（${co.public_id}）</td></tr><tr><th>送信先</th><td><b>${d.recipient}</b><div class="small mute">掲載確認: ${co.email_evidence_url || '—'}</div></td></tr>
<tr><th>営業可否</th><td>${co.eligibility === 'ok' ? '送信可' : '未確定/不可'}<div class="small">${co.eligibility_note}</div></td></tr>
<tr><th>件名</th><td>${d.subject}</td></tr>
<tr><th>プレビュー</th><td><a href="/admin/mocks/${m.id}">#${m.id}</a> 期限 ${fmt(m.expires_at)}／閲覧コード ${m.view_code}</td></tr>
<tr><th>内容ハッシュ</th><td class="small"><code>${hash.slice(0, 16)}…</code>（承認はこの内容に紐づきます）</td></tr></table>
<h3>本文</h3><pre>${d.body}</pre></div>
<div><div class="card"><h2 style="margin-top:0">承認</h2>
${blockers.length ? html`<p>次の理由により承認できません：</p><ul>${blockers.map((b) => html`<li>${b}</li>`)}</ul>` : ''}
${st.state === 'valid' ? html`<p class="badge ok">承認済み（${fmt(st.approval?.approved_at)}）</p>
<form method="post" action="/admin/approvals/${d.id}/send">${csrfField(s)}<input type="hidden" name="hash" value="${hash}">
<label><input type="checkbox" name="confirm" required> 送信直前の再確認（禁止・拒否・重複・期限）を行ったうえで模擬送信します</label><p><button class="ok" type="submit">模擬送信する</button></p></form>
${postButton(s, `/admin/approvals/${d.id}/revoke`, '承認を取り消す', 'sec')}`
  : html`<form method="post" action="/admin/approvals/${d.id}/approve">${csrfField(s)}<input type="hidden" name="hash" value="${hash}">
<label><input type="checkbox" name="confirm" required> 対象企業・送信先・件名・本文・プレビューを確認しました</label>
<p><button type="submit" ${blockers.length ? 'disabled' : ''}>この内容で承認する</button></p></form>`}
<p class="small mute">実送信は未実装です（送信サーバー設定・接続先・送信内容の承認が整った後に有効化する段階）。</p></div>
<div class="card"><h2 style="margin-top:0">EML</h2><p class="small">送信内容を EML 形式で確認できます（ダウンロードのみ・送信しません）。</p><a class="btn sec" href="/admin/drafts/${d.id}/eml">EML をダウンロード</a></div>
<div class="card small"><h2 style="margin-top:0">承認対象スナップショット</h2><pre>${JSON.stringify(snap, null, 2)}</pre></div></div></div>
<p><a href="/admin/drafts/${d.id}">← 営業文の編集へ</a></p>`;
    return c.html(page('送信承認', 'approvals', s, body, flashOf(c)));
  });

  app.post('/admin/approvals/:id/approve', async (c) => {
    const id = idParam(c);
    const f = await form(c);
    if (str(f, 'confirm') !== 'on') return redirectFlash(c, `/admin/approvals/${id}`, { err: '確認のチェックが必要です' });
    try {
      approve(db, cfg, id, str(f, 'hash'), c.get('session').adminId);
    } catch (e) {
      return redirectFlash(c, `/admin/approvals/${id}`, { err: (e as Error).message });
    }
    return redirectFlash(c, `/admin/approvals/${id}`, { ok: '承認しました' });
  });
  app.post('/admin/approvals/:id/revoke', async (c) => {
    const id = idParam(c);
    revokeApproval(db, id, '利用者が取り消し', `admin:${c.get('session').adminId}`);
    return redirectFlash(c, `/admin/approvals/${id}`, { ok: '承認を取り消しました' });
  });
  app.post('/admin/approvals/:id/send', async (c) => {
    const id = idParam(c);
    const f = await form(c);
    if (str(f, 'confirm') !== 'on') return redirectFlash(c, `/admin/approvals/${id}`, { err: '再確認のチェックが必要です' });
    const r = sendApproved(db, cfg, id, str(f, 'hash'), c.get('session').adminId, 'simulated');
    if (r.status === 'sent') return redirectFlash(c, '/admin/sends', { ok: r.message });
    return redirectFlash(c, r.status === 'unknown' ? '/admin/sends' : `/admin/approvals/${id}`, { err: `送信しませんでした: ${r.message}` });
  });

  app.get('/admin/drafts/:id/eml', (c) => {
    const d = getDraft(db, idParam(c));
    if (!d) return c.notFound();
    const sender = getSender(db);
    if (!sender.email || !d.recipient) return redirectFlash(c, `/admin/approvals/${d.id}`, { err: '送信者メールまたは宛先が未設定です' });
    const eml = buildEml({ from: sender.email, fromName: sender.companyName || sender.email, to: d.recipient, subject: d.subject, body: d.body, messageIdDomain: sender.email.split('@')[1] });
    return c.body(eml, 200, { 'Content-Type': 'message/rfc822', 'Content-Disposition': `attachment; filename="draft-${d.id}.eml"` });
  });

  // ---- 送信履歴 ----
  app.get('/admin/sends', (c) => {
    const s = c.get('session');
    const rows = all(db, 'SELECT s.*, c.name AS company_name FROM sends s JOIN companies c ON c.id = s.company_id ORDER BY s.id DESC LIMIT 500');
    const label: Record<string, string> = { sent: '送信済み', unknown: '要確認', failed: '失敗', sending: '処理中', blocked: 'ブロック' };
    const blocked = all(db, "SELECT * FROM audit_log WHERE action = 'send.blocked' ORDER BY id DESC LIMIT 20");
    const body = html`<h1>送信履歴</h1>
<p class="mute">模擬送信と実送信は区別して記録します（現在は模擬送信のみ）。結果が不明な送信は「要確認」となり、自動再送しません。</p>
<table><thead><tr><th>#</th><th>企業</th><th>宛先</th><th>方式</th><th>結果</th><th>詳細</th><th>日時</th><th></th></tr></thead><tbody>
${rows.length ? rows.map((x) => html`<tr><td>${x.id}</td><td><a href="/admin/companies/${x.company_id}">${x.company_name}</a></td><td>${x.recipient_norm}</td>
<td>${x.mode === 'simulated' ? html`<span class="badge mute">模擬送信</span>` : html`<span class="badge warn">実送信</span>`}</td>
<td><span class="badge ${x.status === 'sent' ? 'ok' : x.status === 'unknown' ? 'warn' : 'ng'}">${label[x.status] ?? x.status}</span></td><td class="small">${x.detail}</td><td class="small">${fmt(x.created_at)}</td>
<td>${x.eml_file ? html`<a href="/admin/sends/${x.id}/eml">EML</a>` : ''}
${x.status === 'unknown' ? html`<form method="post" action="/admin/sends/${x.id}/resolve">${csrfField(s)}<input name="note" placeholder="確認内容" required><select name="result"><option value="sent">送信済みと確認</option><option value="failed">未送信と確認</option></select><button class="sec" type="submit">確定</button></form>` : ''}</td></tr>`)
  : html`<tr><td colspan="8" class="mute">送信履歴はありません</td></tr>`}</tbody></table>
<h2>送信ブロックの記録（直近）</h2><table><tr><th>日時</th><th>対象</th><th>理由</th></tr>${blocked.map((b) => html`<tr><td class="small">${fmt(b.created_at)}</td><td>${b.target}</td><td class="small">${b.detail}</td></tr>`)}</table>`;
    return c.html(page('送信履歴', 'sends', s, body, flashOf(c)));
  });

  app.get('/admin/sends/:id/eml', (c) => {
    const r = get(db, 'SELECT eml_file FROM sends WHERE id = ?', idParam(c));
    if (!r?.eml_file || !/^send-\d+\.eml$/.test(r.eml_file)) return c.notFound();
    const p = path.join(cfg.dataDir, 'outbox', r.eml_file);
    if (!fs.existsSync(p)) return c.notFound();
    return c.body(fs.readFileSync(p), 200, { 'Content-Type': 'message/rfc822', 'Content-Disposition': `attachment; filename="${r.eml_file}"` });
  });

  app.post('/admin/sends/:id/resolve', async (c) => {
    const f = await form(c);
    try {
      resolveUnknownSend(db, idParam(c), str(f, 'result') === 'sent' ? 'sent' : 'failed', str(f, 'note', 500), `admin:${c.get('session').adminId}`);
    } catch (e) {
      return redirectFlash(c, '/admin/sends', { err: (e as Error).message });
    }
    return redirectFlash(c, '/admin/sends', { ok: '確定しました' });
  });

  void safeHref;
}
