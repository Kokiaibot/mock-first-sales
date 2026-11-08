// 候補企業一覧・企業詳細・分析結果・CSV
import fs from 'node:fs';
import path from 'node:path';
import type { Hono } from 'hono';
import type { Env, Ctx } from './app.js';
import { all, get, audit } from '../db.js';
import { html, raw, safeHref, type SafeHtml } from '../util/html.js';
import { page, statusBadge, csrfField, postButton, fmt } from './layout.js';
import { form, str, strs, idParam, redirectFlash, flashOf } from './helpers.js';
import {
  listCompanies, getCompany, upsertCompany, updateCompanyFields, mergeCompanies, confirmOfficialSite, setStatus,
  STATUS_LABELS, SITE_STATUS_LABELS,
} from '../domain/companies.js';
import { reviewEligibility, addSuppression, ELIGIBILITY_LABELS, ELIGIBILITY_BASES } from '../domain/eligibility.js';
import { enqueue, JOB_LABELS, JOB_STATUS_LABELS } from '../jobs/engine.js';
import { latestAnalysis, findingsOf } from '../analysis/analyze.js';
import { CATEGORIES } from '../analysis/rules.js';
import { listMocks, previewState } from '../mock/service.js';
import { importCsv, exportCsv, CSV_COLUMNS } from '../domain/csvio.js';
import { PREFECTURES } from '../util/normalize.js';
import { LIMITS } from '../config.js';
import { formFillPlan } from '../outreach/draft.js';

export function nextAction(c: any, ctx: Ctx): string {
  if (c.merged_into) return `企業 #${c.merged_into} に統合済みです。`;
  if (c.opt_out) return '配信停止済みです。送信は行いません。';
  if (c.site_status === 'no_site') return '公式サイトURLがないため除外中です。公式サイトを確認できた場合のみURLを登録してください。';
  if (c.status === 'excluded') return '送信対象外です（営業禁止表示や手動除外）。判断根拠を確認してください。';
  if (c.site_status === 'ok_unverified_official') return 'HTTP応答はありますが公式サイトか未確認です。サイトを確認し「公式サイトとして確定」してください。';
  if (c.site_status === 'unreachable' || c.site_status === 'blocked') return 'サイトを取得できませんでした。URLを確認して再分析するか、ジョブ画面で原因を確認してください。';
  const draft = get(ctx.db, 'SELECT id FROM drafts WHERE company_id = ? AND archived = 0 ORDER BY id DESC LIMIT 1', c.id);
  if (c.status === 'new') return '「分析→モック→営業文を作成」を実行してください。';
  if (c.status === 'analyzed') return 'モックを生成してください。';
  if (c.status === 'mocked' && !draft) return '営業文を作成してください。';
  if (c.eligibility !== 'ok') return '営業可否が未確定です。下の「営業可否の確認」で根拠を確認・記録してください（自動では送信可になりません）。';
  if (c.status === 'awaiting_approval' && draft) return `営業文 #${draft.id} を確認し、送信承認キューで承認してください。`;
  if (c.status === 'sent') return '送信済みです。返信があれば「返信・商談・受注」で記録してください。';
  return '—';
}

function companyRow(c: any): SafeHtml {
  return html`<tr><td><input type="checkbox" name="ids" value="${c.id}" aria-label="選択"></td>
<td><a href="/admin/companies/${c.id}">${c.name}</a>${c.is_fictional ? html` <span class="badge mute">架空</span>` : ''}<div class="small mute">${c.public_id}</div></td>
<td>${c.prefecture}${c.city}</td><td>${c.industry}</td>
<td class="small">${c.website_url ? html`<a href="${safeHref(c.website_url)}" rel="noreferrer noopener" target="_blank">${c.website_domain}</a>` : '—'}<div class="mute">${SITE_STATUS_LABELS[c.site_status] ?? c.site_status}</div></td>
<td>${statusBadge(c.status)}${c.opt_out ? html` <span class="badge ng">配信停止</span>` : ''}</td>
<td><span class="badge ${c.eligibility === 'ok' ? 'ok' : c.eligibility === 'ng' ? 'ng' : 'warn'}">${ELIGIBILITY_LABELS[c.eligibility]}</span></td>
<td class="small">${fmt(c.updated_at)}</td></tr>`;
}

export function registerCompanies(app: Hono<Env>, ctx: Ctx) {
  const { db, cfg } = ctx;

  app.get('/admin/companies', (c) => {
    const s = c.get('session');
    const q = { status: c.req.query('status') || '', prefecture: c.req.query('prefecture') || '', industry: c.req.query('industry') || '', q: c.req.query('q') || '' };
    const rows = listCompanies(db, q);
    const body = html`<h1>候補企業一覧</h1>
<form method="get" class="card row" role="search">
<select name="status" aria-label="状態"><option value="">状態: すべて</option>${Object.entries(STATUS_LABELS).map(([k, v]) => html`<option value="${k}" ${q.status === k ? raw('selected') : ''}>${v}</option>`)}</select>
<select name="prefecture" aria-label="都道府県"><option value="">都道府県: すべて</option>${PREFECTURES.map((p) => html`<option ${q.prefecture === p ? raw('selected') : ''}>${p}</option>`)}</select>
<input name="industry" placeholder="業種" value="${q.industry}" aria-label="業種"><input name="q" placeholder="企業名・地域・ドメイン・メモ" value="${q.q}" aria-label="キーワード">
<button type="submit">絞り込み</button><a class="btn sec" href="/admin/companies">クリア</a><a class="btn sec" href="/admin/companies/new">＋ 手動登録</a></form>
<form method="post" action="/admin/companies/bulk">${csrfField(s)}
<div class="row" style="margin-bottom:8px"><span class="mute">${rows.length} 件</span>
<button name="action" value="pipeline" type="submit">選択企業を「分析→モック→営業文」まで処理</button>
<button name="action" value="exclude" class="sec" type="submit">選択企業を送信対象外にする</button></div>
<table><thead><tr><th></th><th>企業名</th><th>地域</th><th>業種</th><th>公式サイト</th><th>状態</th><th>営業可否</th><th>更新</th></tr></thead>
<tbody>${rows.length ? rows.map(companyRow) : html`<tr><td colspan="8" class="mute">該当する企業はありません。CSV取込または手動登録で追加してください。</td></tr>`}</tbody></table></form>`;
    return c.html(page('候補企業一覧', 'companies', s, body, flashOf(c)));
  });

  app.post('/admin/companies/bulk', async (c) => {
    const s = c.get('session');
    const f = await form(c);
    const ids = strs(f, 'ids').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, LIMITS.maxCandidatesPerSearch);
    if (!ids.length) return redirectFlash(c, '/admin/companies', { err: '企業を選択してください' });
    if (str(f, 'action') === 'exclude') {
      ids.forEach((id) => setStatus(db, id, 'excluded', `admin:${s.adminId}`));
      return redirectFlash(c, '/admin/companies', { ok: `${ids.length} 社を送信対象外にしました` });
    }
    let n = 0;
    for (const id of ids) {
      const co = getCompany(db, id);
      if (!co || co.status === 'excluded' || co.opt_out || co.site_status === 'no_site') continue;
      if (enqueue(db, 'analyze', id, { chain: true }).created) n++;
    }
    return redirectFlash(c, '/admin/jobs', { ok: `${n} 社の処理をジョブに登録しました（重複は自動で除外）。進行状況はこの画面で確認できます` });
  });

  app.get('/admin/companies/new', (c) => {
    const s = c.get('session');
    return c.html(page('企業の手動登録', 'companies', s, html`<h1>企業の手動登録</h1>
<form method="post" action="/admin/companies/new" class="card">${csrfField(s)}
<div class="grid"><div><label>企業名 *</label><input name="name" required maxlength="200"></div>
<div><label>都道府県</label><select name="prefecture"><option value="">—</option>${PREFECTURES.map((p) => html`<option>${p}</option>`)}</select></div>
<div><label>市区町村</label><input name="city"></div><div><label>業種</label><input name="industry" placeholder="例）工務店、歯科、税理士"></div>
<div><label>公式サイトURL *</label><input name="website_url" type="url" required placeholder="https://"></div>
<div><label>事業用メールアドレス（公開されているもの）</label><input name="email" type="email"></div>
<div><label>情報源名 *</label><input name="source_name" required placeholder="例）自社調査、名刺交換"></div><div><label>情報源URL</label><input name="source_url"></div></div>
<label>利用許諾・再利用条件 *</label><input name="source_license" required style="width:100%" placeholder="例）自社で取得した情報。営業目的での利用可">
<label><input type="checkbox" name="is_fictional"> 架空データ（検証用）</label>
<label>担当メモ</label><textarea name="memo" rows="2"></textarea><p><button type="submit">登録</button></p></form>`, flashOf(c)));
  });

  app.post('/admin/companies/new', async (c) => {
    const s = c.get('session');
    const f = await form(c);
    const r = upsertCompany(db, {
      name: str(f, 'name'), prefecture: str(f, 'prefecture'), city: str(f, 'city'), industry: str(f, 'industry'), website_url: str(f, 'website_url'),
      email: str(f, 'email'), source_name: str(f, 'source_name'), source_url: str(f, 'source_url'), source_license: str(f, 'source_license'),
      is_fictional: str(f, 'is_fictional') === 'on', memo: str(f, 'memo'),
    }, `admin:${s.adminId}`);
    if (!r.id) return redirectFlash(c, '/admin/companies/new', { err: r.reason ?? '登録できませんでした' });
    return redirectFlash(c, `/admin/companies/${r.id}`, { ok: r.action === 'merged' ? '既存の企業と重複していたため統合しました' : '登録しました' });
  });

  app.get('/admin/companies/:id', (c) => {
    const s = c.get('session');
    const id = idParam(c);
    const co = getCompany(db, id);
    if (!co) return c.notFound();
    const a = latestAnalysis(db, id);
    const mocks = listMocks(db, id);
    const drafts = all(db, 'SELECT * FROM drafts WHERE company_id = ? ORDER BY id DESC LIMIT 10', id);
    const sends = all(db, 'SELECT * FROM sends WHERE company_id = ? ORDER BY id DESC', id);
    const outcomes = all(db, 'SELECT * FROM outcomes WHERE company_id = ? ORDER BY occurred_at DESC', id);
    const jobs = all(db, 'SELECT * FROM jobs WHERE company_id = ? ORDER BY id DESC LIMIT 10', id);
    const plan = formFillPlan(db, id);
    const running = jobs.some((j) => j.status === 'queued' || j.status === 'running');
    const body = html`<h1>${co.name} ${statusBadge(co.status)} ${co.is_fictional ? html`<span class="badge mute">架空データ</span>` : ''}</h1>
<div class="next"><b>次に必要な操作：</b>${nextAction(co, ctx)}</div>
<div class="row" style="margin-bottom:14px">
${postButton(s, `/admin/companies/${id}/pipeline`, '分析→モック→営業文を作成')}
${postButton(s, `/admin/companies/${id}/job`, '分析のみ再実行', 'sec', { type: 'analyze' })}
${postButton(s, `/admin/companies/${id}/job`, 'モック生成', 'sec', { type: 'mock' })}
${postButton(s, `/admin/companies/${id}/job`, '営業文作成', 'sec', { type: 'draft' })}
${a ? html`<a class="btn sec" href="/admin/companies/${id}/analysis">分析結果・証拠</a>` : ''}
${running ? html`<span class="badge warn">処理中のジョブがあります（<a href="/admin/companies/${id}">再読込</a>）</span>` : ''}</div>

<div class="grid">
<div class="card"><h2 style="margin-top:0">基本情報</h2><table>
<tr><th>企業ID</th><td>${co.public_id}（内部 #${co.id}）</td></tr><tr><th>地域</th><td>${co.prefecture}${co.city}</td></tr><tr><th>業種</th><td>${co.industry}</td></tr>
<tr><th>公式サイト</th><td>${co.website_url ? html`<a href="${safeHref(co.website_url)}" target="_blank" rel="noreferrer noopener">${co.website_url}</a>` : '—'}</td></tr>
<tr><th>確認状態</th><td><b>${SITE_STATUS_LABELS[co.site_status] ?? co.site_status}</b><div class="small mute">${co.site_evidence} ${co.site_checked_at ? `（${fmt(co.site_checked_at)}）` : ''}</div></td></tr>
<tr><th>問い合わせURL</th><td>${co.contact_url ? html`<a href="${safeHref(co.contact_url)}" target="_blank" rel="noreferrer noopener">${co.contact_url}</a>` : '—'}</td></tr>
<tr><th>事業用メール</th><td>${co.email || '—'}<div class="small mute">${co.email_evidence_url ? `掲載確認: ${co.email_evidence_url}` : ''}</div></td></tr>
<tr><th>情報源</th><td>${co.source_name} ${co.source_url ? html`<a href="${safeHref(co.source_url)}" target="_blank" rel="noreferrer noopener">${co.source_url}</a>` : ''}</td></tr>
<tr><th>利用許諾・条件</th><td class="small">${co.source_license}</td></tr><tr><th>取得日時</th><td>${fmt(co.fetched_at)}</td></tr>
<tr><th>配信停止</th><td>${co.opt_out ? html`<span class="badge ng">停止（${fmt(co.opt_out_at)}）</span>` : 'なし'}</td></tr></table>
${co.site_status === 'ok_unverified_official' ? html`<form method="post" action="/admin/companies/${id}/confirm-official" class="card" style="margin-top:10px">${csrfField(s)}
<label>公式サイトとして確定する根拠（必須）</label><input name="note" required style="width:100%" placeholder="例）会社概要の所在地・電話番号が情報源と一致"><p><button type="submit">公式サイトとして確定</button></p></form>` : ''}
</div>

<div class="card"><h2 style="margin-top:0">営業可否の確認</h2>
<p>現在：<span class="badge ${co.eligibility === 'ok' ? 'ok' : co.eligibility === 'ng' ? 'ng' : 'warn'}">${ELIGIBILITY_LABELS[co.eligibility]}</span>
${co.eligibility_basis ? html`<div class="small">根拠: ${ELIGIBILITY_BASES[co.eligibility_basis] ?? co.eligibility_basis}</div>` : ''}
${co.eligibility_note ? html`<pre class="small">${co.eligibility_note}</pre>` : ''}</p>
${co.eligibility_auto ? html`<pre class="small">${co.eligibility_auto}</pre>` : html`<p class="mute small">分析後に自動判定（禁止表示の検出など）が表示されます。</p>`}
<form method="post" action="/admin/companies/${id}/eligibility">${csrfField(s)}
<label>判断</label><select name="decision"><option value="ok">送信可</option><option value="ng">送信不可</option></select>
<label>送信可とする根拠（送信可の場合は必須）</label><select name="basis" style="width:100%"><option value="">—</option>${Object.entries(ELIGIBILITY_BASES).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select>
<label>確認した内容（ページ・日時・禁止表示の有無など）</label><textarea name="note" rows="3" required></textarea>
<p class="small mute">メールアドレスが公開されていることだけでは送信可と判断しません。自動処理・AI がこの判断を代行することはありません。</p>
<p><button type="submit">判断を記録</button></p></form>
${co.opt_out ? '' : html`<hr>${postButton(s, `/admin/companies/${id}/optout`, 'この企業を配信停止にする', 'ng')}`}</div>
</div>

<div class="card"><h2 style="margin-top:0">モック</h2>${mocks.length ? html`<table><tr><th>#</th><th>作成</th><th>状態</th><th>期限</th><th>管理者確認</th><th></th></tr>
${mocks.map((m) => html`<tr><td>${m.id}</td><td>${fmt(m.created_at)}</td><td>${m.superseded ? '旧版' : ({ active: '公開中', expired: '期限切れ', revoked: '失効' } as any)[previewState(m)]}</td><td>${fmt(m.expires_at)}</td><td>${m.admin_reviewed_at ? '確認済み' : '未確認'}</td><td><a href="/admin/mocks/${m.id}">プレビュー・比較</a></td></tr>`)}</table>` : html`<p class="mute">未生成</p>`}</div>

<div class="card"><h2 style="margin-top:0">営業文（下書き）</h2>${drafts.length ? html`<table><tr><th>#</th><th>件名</th><th>宛先</th><th>生成方法</th><th>更新</th><th></th></tr>
${drafts.map((d) => html`<tr><td>${d.id}</td><td>${d.subject}${d.archived ? html` <span class="badge mute">旧版</span>` : ''}</td><td>${d.recipient || '—'}</td><td>${d.generation_method}</td><td>${fmt(d.updated_at)}</td><td><a href="/admin/drafts/${d.id}">確認・編集</a></td></tr>`)}</table>` : html`<p class="mute">未作成</p>`}
${plan ? html`<h2>フォーム入力計画（入力・送信は行いません）</h2>${plan.blocked ? html`<p class="flash err">${plan.blocked}</p>` : ''}<p class="small">フォーム: ${plan.url}</p>
<table><tr><th>項目</th><th>種類</th><th>必須</th><th>入力予定値</th></tr>${plan.rows.map((r) => html`<tr><td>${r.field}</td><td>${r.type}</td><td>${r.required ? '必須' : ''}</td><td>${r.value || '（未定）'}</td></tr>`)}</table>` : ''}</div>

<div class="grid">
<div class="card"><h2 style="margin-top:0">送信履歴</h2>${sends.length ? html`<table>${sends.map((x) => html`<tr><td>#${x.id}</td><td>${x.mode === 'simulated' ? '模擬送信' : x.mode}</td><td>${x.status}</td><td>${fmt(x.created_at)}</td></tr>`)}</table>` : html`<p class="mute">なし</p>`}</div>
<div class="card"><h2 style="margin-top:0">返信・商談・受注</h2>${outcomes.length ? html`<table>${outcomes.map((o) => html`<tr><td>${STATUS_LABELS[o.kind] ?? o.kind}</td><td>${fmt(o.occurred_at)}</td><td>${o.note}</td></tr>`)}</table>` : html`<p class="mute">なし（<a href="/admin/deals">手動登録</a>）</p>`}</div>
<div class="card"><h2 style="margin-top:0">ジョブ</h2>${jobs.length ? html`<table>${jobs.map((j) => html`<tr><td>#${j.id}</td><td>${JOB_LABELS[j.type] ?? j.type}</td><td>${JOB_STATUS_LABELS[j.status] ?? j.status}</td><td class="small">${j.last_error || j.result || ''}</td></tr>`)}</table>` : html`<p class="mute">なし</p>`}</div>
</div>

<div class="card"><h2 style="margin-top:0">企業情報の編集</h2><form method="post" action="/admin/companies/${id}/update">${csrfField(s)}<div class="grid">
<div><label>公式サイトURL</label><input name="website_url" value="${co.website_url}" style="width:100%"></div>
<div><label>問い合わせURL</label><input name="contact_url" value="${co.contact_url}" style="width:100%"></div>
<div><label>事業用メール</label><input name="email" value="${co.email}" style="width:100%"></div>
<div><label>市区町村</label><input name="city" value="${co.city}"></div><div><label>業種</label><input name="industry" value="${co.industry}"></div></div>
<label>担当メモ</label><textarea name="memo" rows="3">${co.memo}</textarea>
<p class="small mute">宛先に関わる項目を変更すると、営業可否は再確認が必要になり、承認は解除されます。</p><p><button type="submit">保存</button></p></form>
<form method="post" action="/admin/companies/${id}/merge" class="row">${csrfField(s)}<label class="inline">重複企業の統合：内部 #</label><input name="drop_id" type="number" min="1" style="width:100px"><button class="sec" type="submit">をこの企業に統合</button>
<span class="small mute">配信停止・営業可否（厳しい方）・履歴は保持されます</span></form></div>`;
    return c.html(page(co.name, 'companies', s, body, flashOf(c), { refresh: running ? 4 : undefined }));
  });

  const wrap = (fn: (c: any, f: any, id: number, actor: string) => any) => async (c: any) => {
    const s = c.get('session');
    const id = idParam(c);
    const f = await form(c);
    try {
      return await fn(c, f, id, `admin:${s.adminId}`);
    } catch (e) {
      return redirectFlash(c, `/admin/companies/${id}`, { err: (e as Error).message });
    }
  };

  app.post('/admin/companies/:id/pipeline', wrap((c, _f, id) => {
    const co = getCompany(db, id);
    if (!co || co.opt_out || co.status === 'excluded') throw new Error('この企業は処理対象外です');
    const r = enqueue(db, 'analyze', id, { chain: true });
    return redirectFlash(c, `/admin/companies/${id}`, { ok: r.created ? 'ジョブを登録しました。完了まで自動で画面が更新されます' : '同じ処理が既に待機中です' });
  }));
  app.post('/admin/companies/:id/job', wrap((c, f, id) => {
    const type = str(f, 'type');
    if (!['analyze', 'mock', 'draft'].includes(type)) throw new Error('不正な処理種別');
    const r = enqueue(db, type as any, id, { chain: false });
    return redirectFlash(c, `/admin/companies/${id}`, { ok: r.created ? `${JOB_LABELS[type]}をジョブに登録しました` : '同じ処理が既に待機中です' });
  }));
  app.post('/admin/companies/:id/update', wrap((c, f, id, actor) => {
    updateCompanyFields(db, id, { website_url: str(f, 'website_url'), contact_url: str(f, 'contact_url'), email: str(f, 'email'), city: str(f, 'city'), industry: str(f, 'industry'), memo: str(f, 'memo') }, actor);
    return redirectFlash(c, `/admin/companies/${id}`, { ok: '保存しました' });
  }));
  app.post('/admin/companies/:id/eligibility', wrap((c, f, id, actor) => {
    const d = str(f, 'decision') === 'ok' ? 'ok' : 'ng';
    reviewEligibility(db, id, d, str(f, 'basis'), str(f, 'note'), actor);
    return redirectFlash(c, `/admin/companies/${id}`, { ok: `営業可否を「${ELIGIBILITY_LABELS[d]}」として記録しました` });
  }));
  app.post('/admin/companies/:id/confirm-official', wrap((c, f, id, actor) => {
    confirmOfficialSite(db, id, str(f, 'note'), actor);
    return redirectFlash(c, `/admin/companies/${id}`, { ok: '公式サイトとして確定しました。続けて処理を実行できます' });
  }));
  app.post('/admin/companies/:id/optout', wrap((c, _f, id, actor) => {
    addSuppression(db, 'company', String(id), '管理者が配信停止に設定', actor);
    return redirectFlash(c, `/admin/companies/${id}`, { ok: '配信停止にしました。承認済みの送信も無効化されています' });
  }));
  app.post('/admin/companies/:id/merge', wrap((c, f, id, actor) => {
    mergeCompanies(db, id, Number(str(f, 'drop_id')), actor);
    return redirectFlash(c, `/admin/companies/${id}`, { ok: '統合しました' });
  }));

  // ---- 分析結果・証拠 ----
  app.get('/admin/companies/:id/analysis', (c) => {
    const s = c.get('session');
    const id = idParam(c);
    const co = getCompany(db, id);
    const a = latestAnalysis(db, id);
    if (!co || !a) return c.notFound();
    const fs_ = findingsOf(db, a.id);
    const shots = all(db, "SELECT * FROM screenshots WHERE company_id = ? AND kind IN ('pc','sp') ORDER BY id DESC LIMIT 2", id);
    const meas = JSON.parse(a.measurements);
    const pages = JSON.parse(a.page_facts) as any[];
    const pc = shots.find((x) => x.kind === 'pc'), sp = shots.find((x) => x.kind === 'sp');
    const statusLabel = { issue: ['改善余地あり', 'warn'], good: ['大きな問題は未検出', 'ok'], unverified: ['未確認', 'mute'] } as Record<string, [string, string]>;
    const body = html`<h1>分析結果・証拠：${co.name}</h1>
<p class="mute">分析日時 ${fmt(a.created_at)}／方式 <span class="badge src-rule">ルールによる分析</span>／取得元 ${a.fetch_status === 'fixture' ? '架空企業の固定サイト（ネットワーク通信なし）' : '実サイト'}
${meas.captureNote ? html`<br><span class="badge warn">${meas.captureNote}</span>` : ''}</p>
<div class="card"><p class="small">表示の見方：<span class="badge src-rule">事実</span> は HTML・表示計測から客観的に観察できた内容、<span class="badge src-template">提案</span> はルールに基づく推測・改善方針です。判定できない項目は「未確認」とし、問題なしとは推定しません。Lighthouse は未計測です（独自スコアは付けていません）。</p></div>
${pc || sp ? html`<div class="shots">${pc ? html`<figure><img src="/admin/screenshots/${pc.id}" alt="PC表示のスクリーンショット"><figcaption class="small mute">PC（幅${pc.width}px）${fmt(pc.created_at)}</figcaption></figure>` : ''}
${sp ? html`<figure><img src="/admin/screenshots/${sp.id}" alt="スマートフォン表示のスクリーンショット"><figcaption class="small mute">スマートフォン（幅${sp.width}px）</figcaption></figure>` : ''}</div>` : html`<p class="flash err">スクリーンショットは取得できていません（表示系の項目は「未確認」扱い）。</p>`}
<table><thead><tr><th>分析項目</th><th>判定</th><th>客観的に観察できた事実</th><th>提案・推測</th><th>根拠URL</th><th>確認日時</th></tr></thead><tbody>
${fs_.map((f) => html`<tr><td><b>${CATEGORIES[f.category]}</b></td><td><span class="badge ${statusLabel[f.status][1]}">${statusLabel[f.status][0]}</span></td>
<td><span class="badge src-rule">事実</span> ${f.fact}</td><td>${f.suggestion ? html`<span class="badge src-template">提案（${f.suggestion_source === 'ai' ? 'AI' : 'ルール'}）</span> ${f.suggestion}<div class="small mute">改善方針: ${f.policy}</div>` : html`<span class="mute">—</span>`}</td>
<td class="small"><a href="${safeHref(f.evidence_url)}" target="_blank" rel="noreferrer noopener">${f.evidence_url}</a>${f.screenshot_id ? html`<br><a href="/admin/screenshots/${f.screenshot_id}">スクリーンショット</a>` : ''}</td><td class="small">${fmt(f.checked_at)}</td></tr>`)}
</tbody></table>
<h2>確認したページ</h2><table><tr><th>URL</th><th>タイトル</th><th>フォーム</th><th>メール掲載</th></tr>${pages.map((p) => html`<tr><td class="small">${p.url}</td><td>${p.title}</td><td>${p.hasForm ? 'あり' : '—'}</td><td>${(p.emails || []).join(', ')}</td></tr>`)}</table>
<p><a href="/admin/companies/${id}">← 企業詳細へ</a></p>`;
    return c.html(page('分析結果', 'companies', s, body, flashOf(c)));
  });

  // スクリーンショット配信: DB に登録されたファイル名のみ（パストラバーサル対策）
  app.get('/admin/screenshots/:id', (c) => {
    const id = idParam(c);
    const r = get(db, 'SELECT file_name FROM screenshots WHERE id = ?', id);
    if (!r || !/^[A-Za-z0-9_-]+\.png$/.test(r.file_name)) return c.notFound();
    const p = path.join(cfg.dataDir, 'screenshots', r.file_name);
    if (!fs.existsSync(p)) return c.notFound();
    return c.body(fs.readFileSync(p), 200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' });
  });

  // ---- CSV ----
  app.get('/admin/import', (c) => {
    const s = c.get('session');
    return c.html(page('CSV 取込・出力', 'import', s, html`<h1>CSV 取込・出力</h1>
<div class="card"><h2 style="margin-top:0">CSV 取込（ユーザー提供データ）</h2>
<p class="small">この機能は利用者が用意した CSV を取り込むものです。外部データから企業を発見する機能（検索条件設定 → gBizINFO）とは別です。</p>
<p class="small">列: ${CSV_COLUMNS.join(' / ')}（UTF-8。1行目はヘッダー。「企業名」は必須）</p>
<form method="post" action="/admin/import" enctype="multipart/form-data">${csrfField(s)}
<input type="file" name="file" accept=".csv,text/csv" required>
<label>利用許諾・再利用条件（CSV に列がない行に適用）</label><input name="default_license" style="width:100%" placeholder="例）自社で収集。営業目的での利用可（出典: ○○）">
<label><input type="checkbox" name="confirm" required> このデータは利用許諾・再利用条件を満たしており、営業リストへの保存が許されていることを確認しました</label>
<p><button type="submit">取り込む</button></p></form></div>
<div class="card"><h2 style="margin-top:0">CSV 出力</h2><p class="small">表計算ソフトで数式として解釈される値（= + - @ で始まる値）は先頭に ' を付けて無害化します。</p><a class="btn" href="/admin/export.csv">CSV をダウンロード</a></div>`, flashOf(c)));
  });

  app.post('/admin/import', async (c) => {
    const s = c.get('session');
    const f = await form(c);
    const file = f.file;
    if (str(f, 'confirm') !== 'on') return redirectFlash(c, '/admin/import', { err: '利用許諾の確認にチェックしてください' });
    if (!(file instanceof File)) return redirectFlash(c, '/admin/import', { err: 'ファイルを選択してください' });
    if (file.size > LIMITS.csvMaxBytes) return redirectFlash(c, '/admin/import', { err: 'ファイルが大きすぎます（5MB まで）' });
    const text = new TextDecoder('utf-8').decode(await file.arrayBuffer());
    const r = importCsv(db, text, { defaultLicense: str(f, 'default_license', 500), actor: `admin:${s.adminId}` });
    audit(db, `admin:${s.adminId}`, 'csv.import', '', JSON.stringify({ ...r, errors: r.errors.length }));
    const msg = `${r.total} 行を処理：新規 ${r.created}／重複統合 ${r.merged}／サイトなし除外 ${r.excludedNoSite}／エラー ${r.errors.length}`;
    return redirectFlash(c, '/admin/companies', r.errors.length ? { ok: msg, err: r.errors.slice(0, 5).map((e) => `${e.line}行目: ${e.message}`).join(' ／ ') } : { ok: msg });
  });

  app.get('/admin/export.csv', (c) => {
    const s = c.get('session');
    audit(db, `admin:${s.adminId}`, 'csv.export');
    return c.body(exportCsv(db), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="companies.csv"' });
  });
}
