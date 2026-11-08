// 企業の登録・重複統合・状態遷移
import { type DB, all, get, run, tx, nowIso, audit, type Row } from '../db.js';
import { normalizeCompanyName, normalizeUrl, domainOf, normalizeEmail } from '../util/normalize.js';
import { randomToken } from '../util/crypto.js';

export const STATUS_LABELS: Record<string, string> = {
  new: '未分析',
  analyzed: '分析済み',
  mocked: 'モック生成済み',
  awaiting_approval: '承認待ち',
  sent: '送信済み',
  replied: '返信あり',
  meeting: '商談',
  won: '受注',
  lost: '失注',
  excluded: '送信対象外',
};

export const SITE_STATUS_LABELS: Record<string, string> = {
  unchecked: '未確認',
  ok: '公式サイト確認済み（HTTP応答あり）',
  ok_unverified_official: 'HTTP応答あり・公式性未確認',
  unreachable: '取得不能',
  no_site: '公式サイトURLなし（除外・URLを補完すると再開）',
  blocked: '取得禁止（SSRF/robots）',
};

export interface CompanyInput {
  name: string;
  prefecture?: string;
  city?: string;
  industry?: string;
  website_url?: string;
  contact_url?: string;
  email?: string;
  source_name?: string;
  source_url?: string;
  source_license?: string;
  is_fictional?: boolean;
  memo?: string;
  official_confirmed?: boolean;
}

export interface UpsertResult {
  id: number | null;
  action: 'created' | 'merged' | 'excluded_no_site' | 'invalid';
  reason?: string;
  mergedWith?: number;
}

/**
 * 企業を登録する。公式サイト URL が無い企業は「サイトなし」として送信対象外で記録する。
 * 同一ドメイン・同一正規化名は既存レコードへ統合し、配信停止・承認・履歴を保持する。
 */
export function upsertCompany(db: DB, input: CompanyInput, actor = 'system'): UpsertResult {
  const name = (input.name || '').trim().slice(0, 200);
  if (!name) return { id: null, action: 'invalid', reason: '企業名が空です' };
  const url = input.website_url ? normalizeUrl(input.website_url) : null;
  if (input.website_url && !url) return { id: null, action: 'invalid', reason: `URL が不正です: ${input.website_url}` };
  const domain = url ? domainOf(url) : '';
  const nameNorm = normalizeCompanyName(name);
  const email = input.email ? normalizeEmail(input.email) : null;
  const contactUrl = input.contact_url ? normalizeUrl(input.contact_url) : null;

  return tx(db, () => {
    const dup = findDuplicate(db, domain, nameNorm, input.prefecture ?? '');
    const now = nowIso();
    if (dup) {
      // 統合: 空欄だけを補完する（既存の配信停止・営業可否・状態は上書きしない）
      const fields: Record<string, string> = {};
      if (!dup.website_url && url) fields.website_url = url;
      if (!dup.website_domain && domain) fields.website_domain = domain;
      if (!dup.contact_url && contactUrl) fields.contact_url = contactUrl;
      if (!dup.email && email) fields.email = email;
      if (!dup.city && input.city) fields.city = input.city;
      if (!dup.industry && input.industry) fields.industry = input.industry;
      const extraSrc = [input.source_name, input.source_url].filter(Boolean).join(' ');
      const memo = extraSrc ? `${dup.memo}${dup.memo ? '\n' : ''}[統合 ${now.slice(0, 10)}] 追加情報源: ${extraSrc}`.slice(0, 4000) : dup.memo;
      fields.memo = memo;
      const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
      run(db, `UPDATE companies SET ${sets}, version = version + 1, updated_at = ? WHERE id = ?`, ...Object.values(fields), now, dup.id);
      audit(db, actor, 'company.merge', `company:${dup.id}`, `入力「${name}」を統合`);
      return { id: dup.id, action: 'merged', mergedWith: dup.id };
    }
    const noSite = !url;
    const r = run(
      db,
      `INSERT INTO companies (public_id, name, name_norm, prefecture, city, industry, website_url, website_domain, site_status,
        site_evidence, contact_url, email, source_name, source_url, source_license, is_fictional, fetched_at, eligibility,
        eligibility_auto, unsubscribe_token, status, memo, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      'C' + randomToken(6),
      name,
      nameNorm,
      input.prefecture ?? '',
      input.city ?? '',
      input.industry ?? '',
      url ?? '',
      domain,
      noSite ? 'no_site' : 'unchecked',
      noSite ? '情報源に公式サイトURLの記載なし' : input.official_confirmed ? '利用者が公式サイトとして確認済み' : '',
      contactUrl ?? '',
      email ?? '',
      input.source_name ?? '',
      input.source_url ?? '',
      input.source_license ?? '',
      input.is_fictional ? 1 : 0,
      now,
      noSite ? 'ng' : 'unreviewed',
      noSite ? '公式サイトなし（必須条件を満たさない）' : '',
      randomToken(18),
      noSite ? 'excluded' : 'new',
      input.memo ?? '',
      now,
      now,
    );
    const id = Number(r.lastInsertRowid);
    audit(db, actor, 'company.create', `company:${id}`, name);
    return { id, action: noSite ? 'excluded_no_site' : 'created' };
  });
}

function findDuplicate(db: DB, domain: string, nameNorm: string, prefecture: string): Row | undefined {
  if (domain) {
    const byDomain = get(db, 'SELECT * FROM companies WHERE website_domain = ? AND merged_into IS NULL', domain);
    if (byDomain) return byDomain;
  }
  if (nameNorm) {
    // 名前一致は同一都道府県（または一方が空）の場合のみ統合
    const rows = all(db, 'SELECT * FROM companies WHERE name_norm = ? AND merged_into IS NULL', nameNorm);
    const hit = rows.find((r) => !r.prefecture || !prefecture || r.prefecture === prefecture);
    if (hit && (!domain || !hit.website_domain || hit.website_domain === domain)) return hit;
  }
  return undefined;
}

/**
 * 既存の 2 レコードを統合（重複検出画面から）。
 * 配信停止はどちらかが停止なら停止、営業可否は厳しい方、履歴は付け替え。
 */
export function mergeCompanies(db: DB, keepId: number, dropId: number, actor: string): void {
  if (keepId === dropId) throw new Error('同じ企業は統合できません');
  tx(db, () => {
    const keep = getCompany(db, keepId);
    const drop = getCompany(db, dropId);
    if (!keep || !drop) throw new Error('企業が見つかりません');
    const optOut = keep.opt_out || drop.opt_out ? 1 : 0;
    const elig = keep.eligibility === 'ng' || drop.eligibility === 'ng' ? 'ng' : keep.eligibility;
    run(db, 'UPDATE companies SET opt_out = ?, opt_out_at = COALESCE(opt_out_at, ?), eligibility = ?, version = version + 1, updated_at = ? WHERE id = ?',
      optOut, drop.opt_out_at, elig, nowIso(), keepId);
    for (const t of ['drafts', 'sends', 'outcomes', 'analyses', 'mocks', 'screenshots']) {
      run(db, `UPDATE ${t} SET company_id = ? WHERE company_id = ?`, keepId, dropId);
    }
    run(db, "UPDATE companies SET merged_into = ?, status = 'excluded', updated_at = ? WHERE id = ?", keepId, nowIso(), dropId);
    // 統合で関連情報が変わったため既存承認は解除
    run(db, `UPDATE approvals SET revoked_at = ?, revoke_reason = '企業統合により関連情報が変更' WHERE revoked_at IS NULL AND draft_id IN (SELECT id FROM drafts WHERE company_id = ?)`, nowIso(), keepId);
    audit(db, actor, 'company.merge_manual', `company:${keepId}`, `company:${dropId} を統合`);
  });
}

export function getCompany(db: DB, id: number): Row | undefined {
  return get(db, 'SELECT * FROM companies WHERE id = ?', id);
}

export function setStatus(db: DB, id: number, status: keyof typeof STATUS_LABELS, actor = 'system'): void {
  run(db, 'UPDATE companies SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), id);
  audit(db, actor, 'company.status', `company:${id}`, status);
}

/** 処理進行による状態更新（営業結果系の状態は後退させない） */
export function advanceStatus(db: DB, id: number, status: 'analyzed' | 'mocked' | 'awaiting_approval' | 'sent'): void {
  const order = ['new', 'analyzed', 'mocked', 'awaiting_approval', 'sent'];
  const c = getCompany(db, id);
  if (!c) return;
  const cur = order.indexOf(c.status);
  if (cur === -1) return; // replied / won / excluded などは維持
  if (order.indexOf(status) > cur) setStatus(db, id, status);
}

export interface CompanyFilter {
  status?: string;
  prefecture?: string;
  industry?: string;
  q?: string;
  excludeContacted?: boolean;
}

export function listCompanies(db: DB, f: CompanyFilter = {}, limit = 500): Row[] {
  const where = ['merged_into IS NULL'];
  const params: any[] = [];
  if (f.status) {
    where.push('status = ?');
    params.push(f.status);
  }
  if (f.prefecture) {
    where.push('prefecture = ?');
    params.push(f.prefecture);
  }
  if (f.industry) {
    where.push('industry LIKE ?');
    params.push(`%${f.industry}%`);
  }
  if (f.q) {
    where.push('(name LIKE ? OR city LIKE ? OR website_domain LIKE ? OR memo LIKE ?)');
    params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
  }
  if (f.excludeContacted) where.push("id NOT IN (SELECT company_id FROM sends WHERE status IN ('sent','unknown'))");
  return all(db, `SELECT * FROM companies WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`, ...params, limit);
}

export function updateCompanyFields(db: DB, id: number, fields: Partial<Record<'memo' | 'contact_url' | 'email' | 'website_url' | 'city' | 'industry', string>>, actor: string): void {
  // 公式サイトとしての手動確認は confirmOfficialSite() で行う
  const c = getCompany(db, id);
  if (!c) throw new Error('企業が見つかりません');
  const next: Record<string, string> = {};
  if (fields.memo !== undefined) next.memo = fields.memo.slice(0, 4000);
  if (fields.city !== undefined) next.city = fields.city.slice(0, 100);
  if (fields.industry !== undefined) next.industry = fields.industry.slice(0, 100);
  if (fields.contact_url !== undefined) {
    const u = fields.contact_url ? normalizeUrl(fields.contact_url) : '';
    if (u === null) throw new Error('問い合わせURLが不正です');
    next.contact_url = u;
  }
  if (fields.email !== undefined) {
    const e = fields.email ? normalizeEmail(fields.email) : '';
    if (e === null) throw new Error('メールアドレスが不正です');
    next.email = e;
  }
  if (fields.website_url !== undefined) {
    const u = fields.website_url ? normalizeUrl(fields.website_url) : '';
    if (u === null) throw new Error('URLが不正です');
    next.website_url = u;
    next.website_domain = u ? domainOf(u) : '';
    if (u !== c.website_url) {
      // URL を変えたら公式性は未確認に戻す（推測した URL を公式として確定しない）
      next.site_status = u ? 'unchecked' : 'no_site';
      next.site_evidence = u ? '利用者がURLを登録（未確認）' : 'URL未登録';
      if (c.status === 'excluded' && c.site_status === 'no_site' && u) next.status = 'new';
    }
  }
  if (!Object.keys(next).length) return;
  tx(db, () => {
    const sets = Object.keys(next).map((k) => `${k} = ?`).join(', ');
    run(db, `UPDATE companies SET ${sets}, version = version + 1, updated_at = ? WHERE id = ?`, ...Object.values(next), nowIso(), id);
    // 宛先に関わる変更は営業可否の再確認と承認解除が必要
    const contactChanged = ('email' in next && next.email !== c.email) || ('contact_url' in next && next.contact_url !== c.contact_url) || ('website_url' in next && next.website_url !== c.website_url);
    if (contactChanged) {
      run(db, "UPDATE companies SET eligibility = CASE WHEN eligibility = 'ok' THEN 'unreviewed' ELSE eligibility END, eligibility_note = eligibility_note || '\n[自動] 連絡先変更により再確認が必要' WHERE id = ?", id);
      run(db, `UPDATE approvals SET revoked_at = ?, revoke_reason = '企業の連絡先情報が変更された' WHERE revoked_at IS NULL AND draft_id IN (SELECT id FROM drafts WHERE company_id = ?)`, nowIso(), id);
    }
    audit(db, actor, 'company.update', `company:${id}`, Object.keys(next).join(','));
  });
}

/** 利用者による公式サイト確認（HTTP 応答確認後に限る） */
export function confirmOfficialSite(db: DB, id: number, note: string, actor: string): void {
  const c = getCompany(db, id);
  if (!c) throw new Error('企業が見つかりません');
  if (c.site_status !== 'ok_unverified_official' && c.site_status !== 'ok') throw new Error('HTTP 応答が確認できていないため公式サイトとして確定できません。先に分析を実行してください');
  if (!note.trim()) throw new Error('確認した根拠を入力してください');
  run(db, "UPDATE companies SET site_status = 'ok', site_evidence = ?, version = version + 1, updated_at = ? WHERE id = ?", `利用者が公式サイトとして確認済み: ${note.slice(0, 300)}`, nowIso(), id);
  audit(db, actor, 'company.confirm_official', `company:${id}`, note);
}
