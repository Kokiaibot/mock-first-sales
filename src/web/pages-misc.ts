// ダッシュボード・設定・検索条件・商談管理・成果分析・コスト・ジョブ・配信停止・実装状況
import type { Hono } from 'hono';
import type { Env, Ctx } from './app.js';
import { all, get, run, nowIso, audit, getSetting, setSetting } from '../db.js';
import { html, raw, safeHref } from '../util/html.js';
import { page, csrfField, postButton, fmt, statusBadge } from './layout.js';
import { form, str, idParam, redirectFlash, flashOf } from './helpers.js';
import { STATUS_LABELS, setStatus, getCompany } from '../domain/companies.js';
import { getSender, senderMissing, type SenderProfile } from '../outreach/draft.js';
import { getSecret, setSecret } from '../secrets.js';
import { changePassword } from '../auth.js';
import { listProfiles, saveProfile, parseCriteria, getProfile, applyCriteria, DEFAULT_CRITERIA, type SearchCriteria } from '../domain/search.js';
import { PREFECTURES, parseStrictDate, normalizeEmail } from '../util/normalize.js';
import { discoverFromGbiz, GBIZ_LICENSE } from '../sources/gbizinfo.js';
import { listJobs, retryJob, setJobPaused, cancelJob, JOB_LABELS, JOB_STATUS_LABELS } from '../jobs/engine.js';
import { SERVICES, COST_STATUS_LABELS } from '../domain/usage.js';
import { addSuppression, listSuppressions } from '../domain/eligibility.js';
import { codexStatus } from '../ai/codex.js';
import { browserUnavailableReason } from '../analysis/browser.js';
import { IMPLEMENTATION_STATUS } from '../status.js';

export function registerMisc(app: Hono<Env>, ctx: Ctx) {
  const { db, cfg } = ctx;

  // ---- ダッシュボード ----
  app.get('/admin/', (c) => {
    const s = c.get('session');
    const counts = Object.fromEntries(all(db, 'SELECT status, COUNT(*) n FROM companies WHERE merged_into IS NULL GROUP BY status').map((r) => [r.status, r.n]));
    const jobsActive = get(db, "SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')")!.n;
    const jobsFailed = get(db, "SELECT COUNT(*) n FROM jobs WHERE status = 'failed'")!.n;
    const unknown = get(db, "SELECT COUNT(*) n FROM sends WHERE status = 'unknown'")!.n;
    const missing = senderMissing(getSender(db));
    const todo: string[] = [];
    if (missing.length) todo.push(`送信者情報を設定してください（未設定: ${missing.join('、')}）`);
    if (!counts.new && !Object.keys(counts).length) todo.push('候補企業を登録してください（CSV 取込・手動登録・架空データ投入 npm run seed:demo）');
    if (counts.new) todo.push(`未分析の企業が ${counts.new} 社あります（候補企業一覧で選択して処理）`);
    if (counts.awaiting_approval) todo.push(`承認待ちが ${counts.awaiting_approval} 件あります（営業可否の確認 → 承認）`);
    if (jobsFailed) todo.push(`失敗したジョブが ${jobsFailed} 件あります（ジョブ・エラー画面で原因と再実行条件を確認）`);
    if (unknown) todo.push(`送信結果が「要確認」のものが ${unknown} 件あります`);
    const recent = all(db, 'SELECT * FROM audit_log ORDER BY id DESC LIMIT 12');
    const body = html`<h1>ダッシュボード</h1>
<div class="kpi">${Object.entries(STATUS_LABELS).map(([k, v]) => html`<div><span class="small mute">${v}</span><b><a href="/admin/companies?status=${k}" style="text-decoration:none">${counts[k] ?? 0}</a></b></div>`)}</div>
<div class="grid" style="margin-top:16px"><div class="card"><h2 style="margin-top:0">次に必要な操作</h2>${todo.length ? html`<ul>${todo.map((t) => html`<li>${t}</li>`)}</ul>` : html`<p class="mute">現在必要な操作はありません</p>`}</div>
<div class="card"><h2 style="margin-top:0">処理状況</h2><p>実行中・待機中のジョブ: <b>${jobsActive}</b>／失敗: <b>${jobsFailed}</b>　<a href="/admin/jobs">ジョブ画面へ</a></p>
<p class="small mute">送信方式: <b>模擬送信のみ</b>（実送信は未実装）／AI: ${getSetting(db, 'ai', { enabled: false }).enabled ? '有効（承認制）' : '無効（ルール・テンプレートのみ）'}</p>
<p class="small mute">ブラウザ（撮影）: ${browserUnavailableReason() ? `未接続 — ${browserUnavailableReason()}` : '初回撮影時に接続'}</p></div></div>
<div class="card"><h2 style="margin-top:0">最近の操作</h2><table>${recent.map((r) => html`<tr><td class="small">${fmt(r.created_at)}</td><td>${r.actor}</td><td>${r.action}</td><td class="small">${r.target} ${r.detail}</td></tr>`)}</table></div>`;
    return c.html(page('ダッシュボード', 'home', s, body, flashOf(c), { refresh: jobsActive ? 5 : undefined }));
  });

  // ---- 送信者情報・連携設定 ----
  app.get('/admin/settings', (c) => {
    const s = c.get('session');
    const sender = getSender(db);
    const ai = getSetting(db, 'ai', { enabled: false });
    const cx = c.req.query('check') ? codexStatus() : null;
    const field = (k: keyof SenderProfile, label: string, type = 'text') => html`<div><label>${label}</label><input name="${k}" type="${type}" value="${sender[k]}" style="width:100%"></div>`;
    const body = html`<h1>送信者情報・連携設定</h1>
<form method="post" action="/admin/settings/sender" class="card">${csrfField(s)}<h2 style="margin-top:0">送信者情報（営業文の署名・法令表示に使用）</h2>
<div class="grid">${field('companyName', '会社名 *')}${field('contactName', '担当者氏名 *')}${field('address', '所在地（住所） *')}${field('phone', '電話番号')}${field('email', '連絡先メール *', 'email')}${field('optOutEmail', '配信停止受付メール（空欄なら連絡先メール）', 'email')}</div>
<p class="small mute">特定電子メール法で求められる送信者の氏名・名称、住所、受信拒否の連絡先などの表示に使います。正確な情報を入力してください。</p><p><button type="submit">保存</button></p></form>

<form method="post" action="/admin/settings/ai" class="card">${csrfField(s)}<h2 style="margin-top:0">AI 連携（Codex CLI・任意）</h2>
<label><input type="checkbox" name="enabled" ${ai.enabled ? raw('checked') : ''}> 営業文の推敲に Codex CLI を使う（実行ごとに送信内容を表示して同意を求めます）</label>
<p class="small">ChatGPT ログインの Codex CLI のみを使用し、API キー（従量課金）へ自動で切り替えることはありません。分析・モック生成・営業文の作成は AI なしで動作します。</p>
<p class="small">準備（PowerShell）: <code>npm i -g @openai/codex</code> → <code>codex login</code>（「Sign in with ChatGPT」を選択）</p>
<p><button type="submit">保存</button> <a class="btn sec" href="/admin/settings?check=1">Codex の状態を確認</a></p>
${cx ? html`<p class="small">インストール: ${cx.installed ? `済（${cx.version}）` : '未'}／ログイン: ${cx.loggedIn}／${cx.detail}</p>` : ''}</form>

<form method="post" action="/admin/settings/gbiz" class="card">${csrfField(s)}<h2 style="margin-top:0">gBizINFO 連携（任意）</h2>
<p>状態: ${getSecret(cfg.dataDir, 'gbizinfoToken') ? html`<span class="badge ok">トークン設定済み</span>` : html`<span class="badge warn">未設定（外部条件待ち）</span>`}</p>
<p class="small">gBizINFO の Web API 利用申請（無料）で発行されたトークンを、この画面に直接入力してください（チャット等に貼り付けないでください）。値は data/secrets.json に保存され、画面・ログには表示しません。</p>
<label>API トークン（変更する場合のみ入力。空欄で保存すると削除）</label><input name="token" type="password" autocomplete="off" style="width:100%">
<p class="small mute">出典表示: ${GBIZ_LICENSE}</p><p><button type="submit">保存</button></p></form>

<div class="card"><h2 style="margin-top:0">公開URL（外部閲覧）</h2><p>現在: ${cfg.publicBaseUrl ? html`<code>${cfg.publicBaseUrl}</code>` : html`<span class="badge warn">未設定 — ローカルURLのみ</span>`}</p>
<p class="small">外部から閲覧できるプレビューには公開環境へのデプロイが必要です（承認後の作業・未実装）。環境変数 PUBLIC_BASE_URL で設定します（docs/DEPLOY.md）。</p></div>

<form method="post" action="/admin/settings/password" class="card">${csrfField(s)}<h2 style="margin-top:0">管理者パスワードの変更</h2>
<div class="grid"><div><label>現在のパスワード</label><input name="current" type="password" required autocomplete="current-password"></div><div><label>新しいパスワード</label><input name="next" type="password" required minlength="12" autocomplete="new-password"></div></div>
<p><button type="submit">変更（全セッションがログアウトされます）</button></p></form>`;
    return c.html(page('送信者情報・連携設定', 'settings', s, body, flashOf(c)));
  });

  app.post('/admin/settings/sender', async (c) => {
    const f = await form(c);
    const v: SenderProfile = {
      companyName: str(f, 'companyName', 100).trim(), contactName: str(f, 'contactName', 60).trim(), address: str(f, 'address', 200).trim(),
      phone: str(f, 'phone', 30).trim(), email: str(f, 'email', 200).trim().toLowerCase(), optOutEmail: str(f, 'optOutEmail', 200).trim().toLowerCase(),
    };
    if (v.email && !normalizeEmail(v.email)) return redirectFlash(c, '/admin/settings', { err: '連絡先メールの形式が不正です' });
    if (v.optOutEmail && !normalizeEmail(v.optOutEmail)) return redirectFlash(c, '/admin/settings', { err: '配信停止受付メールの形式が不正です' });
    if (/[\r\n]/.test(Object.values(v).join(''))) return redirectFlash(c, '/admin/settings', { err: '改行は使用できません' });
    setSetting(db, 'sender', v);
    // 署名が変わると既存の承認は無効（本文ハッシュは変わらないが署名整合のため解除）
    run(db, "UPDATE approvals SET revoked_at = ?, revoke_reason = '送信者情報が変更された' WHERE revoked_at IS NULL", nowIso());
    audit(db, `admin:${c.get('session').adminId}`, 'settings.sender');
    return redirectFlash(c, '/admin/settings', { ok: '送信者情報を保存しました。既存の下書きの署名は自動では書き換わらないため、必要に応じて営業文を再作成してください' });
  });
  app.post('/admin/settings/ai', async (c) => {
    const f = await form(c);
    setSetting(db, 'ai', { enabled: str(f, 'enabled') === 'on' });
    audit(db, `admin:${c.get('session').adminId}`, 'settings.ai', '', str(f, 'enabled'));
    return redirectFlash(c, '/admin/settings', { ok: 'AI 連携の設定を保存しました' });
  });
  app.post('/admin/settings/gbiz', async (c) => {
    const f = await form(c);
    const t = str(f, 'token', 200).trim();
    if (t && !/^[A-Za-z0-9_\-.]{8,200}$/.test(t)) return redirectFlash(c, '/admin/settings', { err: 'トークンの形式が不正です' });
    setSecret(cfg.dataDir, 'gbizinfoToken', t);
    audit(db, `admin:${c.get('session').adminId}`, 'settings.gbiz', '', t ? 'set' : 'cleared');
    return redirectFlash(c, '/admin/settings', { ok: t ? 'トークンを保存しました' : 'トークンを削除しました' });
  });
  app.post('/admin/settings/password', async (c) => {
    const f = await form(c);
    try {
      changePassword(db, c.get('session').adminId, str(f, 'current'), str(f, 'next'));
    } catch (e) {
      return redirectFlash(c, '/admin/settings', { err: (e as Error).message });
    }
    return c.redirect('/login');
  });

  // ---- 検索条件設定 ----
  const criteriaForm = (s: any, cr: SearchCriteria, id: number | null, name: string) => html`
<form method="post" action="/admin/search/save" class="card">${csrfField(s)}${id ? html`<input type="hidden" name="id" value="${id}">` : ''}
<div class="grid"><div><label>条件名</label><input name="name" value="${name}" required></div>
<div><label>都道府県</label><select name="prefecture"><option value="">指定なし</option>${PREFECTURES.map((p) => html`<option ${cr.prefecture === p ? raw('selected') : ''}>${p}</option>`)}</select></div>
<div><label>市区町村</label><input name="city" value="${cr.city}"></div><div><label>業種</label><input name="industry" value="${cr.industry}" placeholder="例）工務店"></div>
<div><label>キーワード</label><input name="keyword" value="${cr.keyword}"></div><div><label>最大候補数（1〜200）</label><input name="maxCandidates" type="number" min="1" max="200" value="${cr.maxCandidates}"></div>
<div><label>問い合わせ手段</label><select name="requireContact">${[['either', 'メールまたはフォーム（未分析含む）'], ['email', '公開メールあり'], ['form', '問い合わせページあり'], ['any', '指定なし']].map(([k, v]) => html`<option value="${k}" ${cr.requireContact === k ? raw('selected') : ''}>${v}</option>`)}</select></div>
<div><label>Webサイト改善余地</label><select name="improvementRoom">${[['any', '指定なし'], ['some', '改善余地 2 項目以上'], ['many', '改善余地 4 項目以上']].map(([k, v]) => html`<option value="${k}" ${cr.improvementRoom === k ? raw('selected') : ''}>${v}</option>`)}</select></div></div>
<label><input type="checkbox" name="excludeContacted" ${cr.excludeContacted ? raw('checked') : ''}> 営業済み企業を除外</label>
<p class="small mute">公式Webサイトの存在は必須条件です（URLのない企業は常に除外）。</p><p><button type="submit">保存</button></p></form>`;

  app.get('/admin/search', (c) => {
    const s = c.get('session');
    const profiles = listProfiles(db);
    const body = html`<h1>検索条件設定</h1>
<p class="mute">保存した条件で、登録済み候補の絞り込み（ローカル）と、外部データ（gBizINFO・トークン設定時）からの候補発見ができます。Google Maps の一括取得は行いません。</p>
${profiles.length ? html`<table><tr><th>条件名</th><th>内容</th><th>更新</th><th></th></tr>${profiles.map((p) => html`<tr><td><a href="/admin/search/${p.id}">${p.name}</a></td>
<td class="small">${[p.c.prefecture, p.c.city, p.c.industry, p.c.keyword].filter(Boolean).join(' / ') || '指定なし'}／最大${p.c.maxCandidates}件${p.c.excludeContacted ? '／営業済み除外' : ''}</td><td class="small">${fmt(p.updated_at)}</td>
<td><a class="btn sec" href="/admin/search/${p.id}">表示・実行</a></td></tr>`)}</table>` : ''}
<h2>新しい条件</h2>${criteriaForm(s, DEFAULT_CRITERIA, null, '')}`;
    return c.html(page('検索条件設定', 'search', s, body, flashOf(c)));
  });

  app.post('/admin/search/save', async (c) => {
    const f = (await form(c)) as Record<string, string>;
    const id = Number(str(f, 'id')) || null;
    const nid = saveProfile(db, id, str(f, 'name'), parseCriteria(Object.fromEntries(Object.keys(f).map((k) => [k, str(f, k)]))));
    return redirectFlash(c, `/admin/search/${nid}`, { ok: '検索条件を保存しました' });
  });

  app.get('/admin/search/:id', (c) => {
    const s = c.get('session');
    const p = getProfile(db, idParam(c));
    if (!p) return c.notFound();
    const rows = applyCriteria(db, p.c);
    const hasToken = !!getSecret(cfg.dataDir, 'gbizinfoToken');
    const body = html`<h1>検索条件：${p.name}</h1>${criteriaForm(s, p.c, p.id, p.name)}
<div class="card"><h2 style="margin-top:0">外部データから候補を発見（gBizINFO）</h2>
${hasToken ? postButton(s, `/admin/search/${p.id}/discover`, 'gBizINFO で検索して候補に追加') : html`<p class="badge warn">gBizINFO トークン未設定のため利用できません（外部条件待ち）</p>`}
<p class="small mute">gBizINFO に公式サイトURLが含まれない企業は「URL未登録」として除外され、推測したURLを公式サイトとして確定しません。</p></div>
<h2>登録済み候補への適用結果（${rows.length} 件）</h2>
<form method="post" action="/admin/companies/bulk">${csrfField(s)}<p><button name="action" value="pipeline" type="submit">選択企業を処理</button></p>
<table><tr><th></th><th>企業</th><th>地域</th><th>業種</th><th>状態</th></tr>${rows.map((r) => html`<tr><td><input type="checkbox" name="ids" value="${r.id}" checked></td><td><a href="/admin/companies/${r.id}">${r.name}</a></td><td>${r.prefecture}${r.city}</td><td>${r.industry}</td><td>${statusBadge(r.status)}</td></tr>`)}</table></form>`;
    return c.html(page('検索条件', 'search', s, body, flashOf(c)));
  });

  app.post('/admin/search/:id/discover', async (c) => {
    const id = idParam(c);
    const p = getProfile(db, id);
    if (!p) return c.notFound();
    try {
      const r = await discoverFromGbiz(db, cfg.dataDir, p.c);
      return redirectFlash(c, `/admin/search/${id}`, { ok: `取得 ${r.fetched} 件：新規 ${r.created}／統合 ${r.merged}／URL未登録で除外 ${r.excludedNoSite}` });
    } catch (e) {
      return redirectFlash(c, `/admin/search/${id}`, { err: (e as Error).message });
    }
  });

  // ---- 返信・商談・受注 ----
  app.get('/admin/deals', (c) => {
    const s = c.get('session');
    const companies = all(db, "SELECT id, name, status FROM companies WHERE merged_into IS NULL AND status IN ('sent','replied','meeting','won','lost') ORDER BY name");
    const rows = all(db, 'SELECT o.*, c.name FROM outcomes o JOIN companies c ON c.id = o.company_id ORDER BY o.occurred_at DESC LIMIT 300');
    const body = html`<h1>返信・商談・受注管理</h1>
<p class="mute">返信の自動検知は<b>未実装</b>です（手動登録）。受注後は作成済みモックをベースに本制作へ進めます（docs/PRODUCTION.md）。</p>
<form method="post" action="/admin/deals" class="card">${csrfField(s)}<div class="grid">
<div><label>企業（送信済み以降）</label><select name="company_id" required>${companies.map((x) => html`<option value="${x.id}">${x.name}（${STATUS_LABELS[x.status]}）</option>`)}</select></div>
<div><label>種別</label><select name="kind"><option value="replied">返信あり</option><option value="meeting">商談</option><option value="won">受注</option><option value="lost">失注</option></select></div>
<div><label>日付（YYYY-MM-DD）</label><input name="date" required pattern="\\d{4}-\\d{2}-\\d{2}" placeholder="2026-11-08"></div><div><label>受注金額（円・任意）</label><input name="amount" type="number" min="0" max="1000000000"></div></div>
<label>メモ</label><input name="note" style="width:100%"><label><input type="checkbox" name="optout"> 相手から配信停止の依頼があった</label><p><button type="submit">登録</button></p></form>
<table><tr><th>日付</th><th>企業</th><th>種別</th><th>金額</th><th>メモ</th></tr>${rows.map((r) => html`<tr><td>${r.occurred_at.slice(0, 10)}</td><td><a href="/admin/companies/${r.company_id}">${r.name}</a></td><td>${STATUS_LABELS[r.kind]}</td><td>${r.amount_jpy ?? ''}</td><td>${r.note}</td></tr>`)}</table>`;
    return c.html(page('返信・商談・受注', 'deals', s, body, flashOf(c)));
  });

  app.post('/admin/deals', async (c) => {
    const s = c.get('session');
    const f = await form(c);
    const cid = Number(str(f, 'company_id'));
    const kind = str(f, 'kind');
    const d = parseStrictDate(str(f, 'date'));
    if (!['replied', 'meeting', 'won', 'lost'].includes(kind)) return redirectFlash(c, '/admin/deals', { err: '種別が不正です' });
    if (!d || d.getTime() > Date.now() + 86400_000) return redirectFlash(c, '/admin/deals', { err: '日付が不正です（存在する日付・未来日不可）' });
    const co = getCompany(db, cid);
    if (!co) return redirectFlash(c, '/admin/deals', { err: '企業が見つかりません' });
    const amtRaw = str(f, 'amount');
    const amount = amtRaw ? Number(amtRaw) : null;
    if (amount !== null && (!Number.isInteger(amount) || amount < 0)) return redirectFlash(c, '/admin/deals', { err: '金額が不正です' });
    run(db, 'INSERT INTO outcomes (company_id, kind, note, amount_jpy, occurred_at, created_at) VALUES (?,?,?,?,?,?)', cid, kind, str(f, 'note', 500), amount, d.toISOString(), nowIso());
    setStatus(db, cid, kind as any, `admin:${s.adminId}`);
    if (str(f, 'optout') === 'on') addSuppression(db, 'company', String(cid), '返信で配信停止の依頼', `admin:${s.adminId}`);
    return redirectFlash(c, '/admin/deals', { ok: '登録しました' });
  });

  // ---- 営業成果分析 ----
  app.get('/admin/analytics', (c) => {
    const s = c.get('session');
    const n = (sql: string, ...p: any[]) => get(db, sql, ...p)!.n as number;
    const sent = n("SELECT COUNT(DISTINCT company_id) n FROM sends WHERE status = 'sent'");
    const simulated = n("SELECT COUNT(*) n FROM sends WHERE status = 'sent' AND mode = 'simulated'");
    const replied = n("SELECT COUNT(DISTINCT company_id) n FROM outcomes WHERE kind IN ('replied','meeting','won','lost')");
    const meeting = n("SELECT COUNT(DISTINCT company_id) n FROM outcomes WHERE kind IN ('meeting','won')");
    const won = n("SELECT COUNT(DISTINCT company_id) n FROM outcomes WHERE kind = 'won'");
    const amount = get(db, "SELECT COALESCE(SUM(amount_jpy),0) n FROM outcomes WHERE kind = 'won'")!.n;
    const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');
    const byInd = all(db, `SELECT c.industry, COUNT(DISTINCT s.company_id) sent, COUNT(DISTINCT CASE WHEN o.kind IN ('replied','meeting','won','lost') THEN o.company_id END) rep
      FROM sends s JOIN companies c ON c.id = s.company_id LEFT JOIN outcomes o ON o.company_id = s.company_id WHERE s.status = 'sent' GROUP BY c.industry`);
    const body = html`<h1>営業成果分析</h1>
<p class="mute">現在の送信はすべて模擬送信（${simulated} 件）のため、返信率等は検証用の参考値です。</p>
<div class="kpi"><div><span class="small mute">送信済み企業</span><b>${sent}</b></div><div><span class="small mute">返信あり</span><b>${replied}</b>${pct(replied, sent)}</div>
<div><span class="small mute">商談</span><b>${meeting}</b>${pct(meeting, sent)}</div><div><span class="small mute">受注</span><b>${won}</b>${pct(won, sent)}</div><div><span class="small mute">受注金額合計</span><b>${Number(amount).toLocaleString('ja-JP')}円</b></div></div>
<h2>業種別</h2><table><tr><th>業種</th><th>送信</th><th>返信</th><th>返信率</th></tr>${byInd.map((r) => html`<tr><td>${r.industry || '未設定'}</td><td>${r.sent}</td><td>${r.rep}</td><td>${pct(r.rep, r.sent)}</td></tr>`)}</table>`;
    return c.html(page('営業成果分析', 'analytics', s, body));
  });

  // ---- API 利用・制作コスト ----
  app.get('/admin/costs', (c) => {
    const s = c.get('session');
    const usage = all(db, 'SELECT service, operation, cost_status, COUNT(*) n, SUM(cost_jpy) jpy FROM usage_log GROUP BY service, operation, cost_status ORDER BY service');
    const recent = all(db, 'SELECT * FROM usage_log ORDER BY id DESC LIMIT 50');
    const body = html`<h1>API 利用・制作コスト</h1>
<div class="card"><p class="small">金額を取得できない処理は「未計測」と表示し、0円とは断定しません。既存の ChatGPT 契約の利用枠は無制限ではありません。有料サービスへの自動切替は行いません。</p></div>
<h2>使用サービス・ライブラリ一覧</h2><table><tr><th>名称</th><th>用途</th><th>状態</th><th>認証</th><th>無料枠・既存契約で使える範囲</th><th>追加料金が発生する条件</th><th>公式参照</th><th>確認日</th></tr>
${SERVICES.map((x) => html`<tr><td>${x.name}</td><td>${x.purpose}</td><td><span class="badge ${x.status === '使用中' ? 'ok' : 'mute'}">${x.status}</span></td><td class="small">${x.auth}</td><td class="small">${x.freeScope}</td><td class="small">${x.paidWhen}</td><td class="small">${x.officialUrl.startsWith('http') ? html`<a href="${safeHref(x.officialUrl)}" target="_blank" rel="noreferrer noopener">公式</a>` : '—'}</td><td class="small">${x.checkedAt}</td></tr>`)}</table>
<h2>処理別の利用集計</h2><table><tr><th>サービス</th><th>処理</th><th>回数</th><th>費用</th></tr>${usage.map((u) => html`<tr><td>${u.service}</td><td>${u.operation}</td><td>${u.n}</td><td>${u.cost_status === 'measured' ? `${u.jpy}円` : COST_STATUS_LABELS[u.cost_status]}</td></tr>`)}</table>
<h2>直近の利用履歴</h2><table><tr><th>日時</th><th>サービス</th><th>処理</th><th>企業</th><th>費用区分</th><th>詳細</th></tr>${recent.map((u) => html`<tr><td class="small">${fmt(u.created_at)}</td><td>${u.service}</td><td>${u.operation}</td><td>${u.company_id ?? ''}</td><td class="small">${COST_STATUS_LABELS[u.cost_status]}</td><td class="small">${u.detail}</td></tr>`)}</table>`;
    return c.html(page('API利用・コスト', 'costs', s, body));
  });

  // ---- ジョブ ----
  app.get('/admin/jobs', (c) => {
    const s = c.get('session');
    const st = c.req.query('status') || '';
    const rows = listJobs(db, st || undefined);
    const active = rows.some((j) => j.status === 'queued' || j.status === 'running');
    const body = html`<h1>ジョブ・エラー・再実行</h1>
<p class="mute">各処理は永続化されたジョブとして管理され、アプリ再起動後も状態を復元します。並列数 ${cfg.workerConcurrency}・1ジョブのタイムアウト 120 秒・最大 3 回試行。429/503 は Retry-After に従って待機します。再実行しても成果物は入力内容が同じなら再利用され、送信はジョブ化していないため重複送信は起きません。</p>
<div class="row" style="margin-bottom:8px">${['', 'queued', 'running', 'failed', 'succeeded', 'paused'].map((k) => html`<a class="btn ${st === k ? '' : 'sec'}" href="/admin/jobs${k ? `?status=${k}` : ''}">${k ? JOB_STATUS_LABELS[k] : 'すべて'}</a>`)}</div>
<table><thead><tr><th>#</th><th>処理</th><th>企業</th><th>状態</th><th>試行</th><th>次回実行</th><th>結果・失敗理由</th><th>再実行条件・操作</th></tr></thead><tbody>
${rows.map((j) => html`<tr><td>${j.id}</td><td>${JOB_LABELS[j.type] ?? j.type}</td><td>${j.company_id ? html`<a href="/admin/companies/${j.company_id}">#${j.company_id}</a>` : ''}</td>
<td><span class="badge ${j.status === 'failed' ? 'ng' : j.status === 'succeeded' ? 'ok' : 'warn'}">${JOB_STATUS_LABELS[j.status] ?? j.status}</span></td><td>${j.attempts}/${j.max_attempts}</td><td class="small">${j.status === 'queued' ? fmt(j.run_after) : ''}</td>
<td class="small">${j.last_error || j.result || ''}</td>
<td class="small">${j.status === 'failed' ? html`${j.retryable ? '一時的な失敗の可能性。原因解消後に再実行可' : '恒久的な理由（URL・禁止表示・公式性など）。企業情報を修正してから再実行'}<br>${postButton(s, `/admin/jobs/${j.id}/retry`, '再実行', 'sec')}` : ''}
${j.status === 'queued' ? html`${postButton(s, `/admin/jobs/${j.id}/pause`, '一時停止', 'sec')} ${postButton(s, `/admin/jobs/${j.id}/cancel`, '取消', 'sec')}` : ''}
${j.status === 'paused' ? postButton(s, `/admin/jobs/${j.id}/resume`, '再開', 'sec') : ''}</td></tr>`)}</tbody></table>`;
    return c.html(page('ジョブ', 'jobs', s, body, flashOf(c), { refresh: active ? 3 : undefined }));
  });
  for (const [act, fn] of Object.entries({
    retry: (id: number, a: string) => retryJob(db, id, a),
    pause: (id: number, a: string) => setJobPaused(db, id, true, a),
    resume: (id: number, a: string) => setJobPaused(db, id, false, a),
    cancel: (id: number, a: string) => cancelJob(db, id, a),
  })) {
    app.post(`/admin/jobs/:id/${act}`, async (c) => {
      try {
        fn(idParam(c), `admin:${c.get('session').adminId}`);
      } catch (e) {
        return redirectFlash(c, '/admin/jobs', { err: (e as Error).message });
      }
      return redirectFlash(c, '/admin/jobs', { ok: '操作しました' });
    });
  }

  // ---- 配信停止管理 ----
  app.get('/admin/suppressions', (c) => {
    const s = c.get('session');
    const rows = listSuppressions(db);
    const body = html`<h1>配信停止管理</h1>
<form method="post" action="/admin/suppressions" class="card row">${csrfField(s)}<select name="kind"><option value="email">メールアドレス</option><option value="domain">ドメイン</option></select>
<input name="value" required placeholder="例）info@example.co.jp または example.co.jp"><input name="reason" placeholder="理由" required><button type="submit">追加</button></form>
<p class="small mute">追加すると該当企業は即時に配信停止となり、承認済みの送信も無効化されます。送信直前にも再確認します。</p>
<table><tr><th>種別</th><th>値</th><th>理由</th><th>登録日時</th></tr>${rows.map((r) => html`<tr><td>${{ email: 'メール', domain: 'ドメイン', company: '企業' }[r.kind as string]}</td><td>${r.kind === 'company' ? html`<a href="/admin/companies/${r.value}">企業 #${r.value}</a>` : r.value}</td><td>${r.reason}</td><td class="small">${fmt(r.created_at)}</td></tr>`)}</table>`;
    return c.html(page('配信停止管理', 'suppressions', s, body, flashOf(c)));
  });
  app.post('/admin/suppressions', async (c) => {
    const f = await form(c);
    const kind = str(f, 'kind') === 'domain' ? 'domain' : 'email';
    try {
      addSuppression(db, kind, str(f, 'value', 200), str(f, 'reason', 200), `admin:${c.get('session').adminId}`);
    } catch (e) {
      return redirectFlash(c, '/admin/suppressions', { err: (e as Error).message });
    }
    return redirectFlash(c, '/admin/suppressions', { ok: '配信停止リストに追加しました' });
  });

  // ---- 実装状況 ----
  app.get('/admin/status', (c) => {
    const s = c.get('session');
    const cls: Record<string, string> = { 実装済み: 'ok', 一部実装: 'warn', 未実装: 'ng', 外部条件待ち: 'mute', 'ダミー（デモ）': 'mute' };
    const body = html`<h1>実装状況</h1><p class="mute">「ルールによる分析」「テンプレート生成」「実際の AI 処理」を区別して表示しています。</p>
<table><tr><th>機能</th><th>状態</th><th>処理の種類</th><th>備考</th></tr>${IMPLEMENTATION_STATUS.map((r) => html`<tr><td>${r.feature}</td><td><span class="badge ${cls[r.state] ?? ''}">${r.state}</span></td><td>${r.kind}</td><td class="small">${r.note}</td></tr>`)}</table>`;
    return c.html(page('実装状況', 'status', s, body));
  });
}
