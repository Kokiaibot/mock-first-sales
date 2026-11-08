// 営業可否・配信停止。
// 自動判定は「ブロック」か「要確認」までしか出さない。送信可能（ok）にできるのは利用者の手動確認だけ。
import { type DB, get, all, run, tx, nowIso, audit, type Row } from '../db.js';
import { normalizeEmail, emailDomain } from '../util/normalize.js';
// 文言リストは sales-claw-ts (MIT) の sendability-exclusions / sendability-gate を出典とし拡張（NOTICE 参照）
import { PROHIBITION_PATTERNS, SALES_DESK_PATTERNS } from '../vendor/sales-claw/exclusion-phrases.js';

export const ELIGIBILITY_LABELS: Record<string, string> = {
  unreviewed: '未確認（送信不可）',
  ok: '送信可（利用者確認済み）',
  ng: '送信不可',
};

/** 利用者が選ぶ送信根拠（記録必須） */
export const ELIGIBILITY_BASES: Record<string, string> = {
  published_business_email:
    '公式サイトで事業用メールアドレスが公表され、広告・営業メールの受信拒否表示がないことを確認（特定電子メール法 第3条第1項第4号の例外に該当すると判断）',
  prior_consent: '事前に送信の同意を得ている',
  business_relation: '取引関係にある',
  sales_desk: '営業・業者向けの専用窓口が公表されている',
};

export interface AutoAssessment {
  verdict: 'blocked' | 'needs_review';
  reasons: string[];
  salesDesk?: string;
}

export function findProhibition(text: string): string | null {
  for (const p of PROHIBITION_PATTERNS) {
    const m = p.exec(text);
    if (m) return m[0];
  }
  return null;
}

export function findSalesDesk(text: string): string | null {
  for (const p of SALES_DESK_PATTERNS) {
    const m = p.exec(text);
    if (m) return m[0];
  }
  return null;
}

/** 分析時の観察結果からの自動判定（ok は返さない） */
export function assessFromPages(pages: { url: string; text: string }[], email: string): AutoAssessment {
  const reasons: string[] = [];
  let verdict: AutoAssessment['verdict'] = 'needs_review';
  let salesDesk: string | undefined;
  for (const p of pages) {
    const hit = findProhibition(p.text);
    const desk = findSalesDesk(p.text);
    if (desk) {
      salesDesk = desk;
      reasons.push(`営業向け窓口の記載あり（${p.url}）:「${desk}」`);
    }
    if (hit && !desk) {
      verdict = 'blocked';
      reasons.push(`営業・勧誘禁止の表示を検出（${p.url}）:「${hit}」`);
    } else if (hit) {
      reasons.push(`フォームでの営業は禁止表示あり（${p.url}）:「${hit}」→ フォーム送信は不可、案内された窓口のみ検討`);
    }
  }
  if (!email) reasons.push('公表された事業用メールアドレスを確認できていません');
  else {
    const seen = pages.find((p) => p.text.toLowerCase().includes(email.toLowerCase()));
    reasons.push(seen ? `メールアドレスの掲載を確認: ${seen.url}` : 'メールアドレスがサイト上で確認できません（掲載元未確認）');
  }
  reasons.push('メールアドレスの公開だけでは送信可と判断しません。利用者による根拠の確認が必要です。');
  return { verdict, reasons, salesDesk };
}

export function saveAutoAssessment(db: DB, companyId: number, a: AutoAssessment): void {
  const c = get(db, 'SELECT eligibility FROM companies WHERE id = ?', companyId);
  const text = `${a.verdict === 'blocked' ? '【自動判定: 送信不可】' : '【自動判定: 要確認】'}\n${a.reasons.join('\n')}`;
  // 自動判定がブロックなら ok を取り消す。自動処理が ok にすることはない。
  if (a.verdict === 'blocked' && c?.eligibility !== 'ng') {
    run(db, "UPDATE companies SET eligibility = 'ng', eligibility_auto = ?, status = CASE WHEN status IN ('replied','meeting','won','lost') THEN status ELSE 'excluded' END, updated_at = ? WHERE id = ?", text, nowIso(), companyId);
  } else {
    run(db, 'UPDATE companies SET eligibility_auto = ?, updated_at = ? WHERE id = ?', text, nowIso(), companyId);
  }
}

/** 利用者による営業可否の確定（必ず根拠を記録） */
export function reviewEligibility(db: DB, companyId: number, decision: 'ok' | 'ng', basis: string, note: string, actor: string): void {
  const c = get(db, 'SELECT * FROM companies WHERE id = ?', companyId);
  if (!c) throw new Error('企業が見つかりません');
  if (decision === 'ok') {
    if (!ELIGIBILITY_BASES[basis]) throw new Error('送信可とする根拠を選択してください');
    if (c.eligibility_auto.startsWith('【自動判定: 送信不可】')) throw new Error('営業禁止表示が検出されているため送信可にできません');
    if (c.opt_out) throw new Error('配信停止済みの企業は送信可にできません');
    if (!c.email) throw new Error('送信先メールアドレスが未登録です');
    if (c.site_status !== 'ok') throw new Error('公式サイトの確認が完了していません');
    if (!note.trim()) throw new Error('確認した内容（確認したページ・日時など）をメモに記録してください');
  }
  tx(db, () => {
    run(db, 'UPDATE companies SET eligibility = ?, eligibility_basis = ?, eligibility_note = ?, eligibility_reviewed_at = ?, version = version + 1, updated_at = ? WHERE id = ?',
      decision, decision === 'ok' ? basis : basis || 'manual_ng', note.slice(0, 2000), nowIso(), nowIso(), companyId);
    if (decision === 'ng') {
      run(db, `UPDATE approvals SET revoked_at = ?, revoke_reason = '営業可否が送信不可に変更' WHERE revoked_at IS NULL AND draft_id IN (SELECT id FROM drafts WHERE company_id = ?)`, nowIso(), companyId);
    }
    audit(db, actor, 'eligibility.review', `company:${companyId}`, `${decision} ${basis}`);
  });
}

// ---- 配信停止 ----

export function addSuppression(db: DB, kind: 'email' | 'domain' | 'company', value: string, reason: string, actor: string): void {
  const v = kind === 'email' ? normalizeEmail(value) : kind === 'domain' ? value.trim().toLowerCase().replace(/^@/, '') : value.trim();
  if (!v) throw new Error('値が不正です');
  tx(db, () => {
    run(db, 'INSERT OR IGNORE INTO suppressions (kind, value, reason, created_at) VALUES (?,?,?,?)', kind, v, reason.slice(0, 500), nowIso());
    if (kind === 'company') {
      run(db, 'UPDATE companies SET opt_out = 1, opt_out_at = COALESCE(opt_out_at, ?), updated_at = ? WHERE id = ?', nowIso(), nowIso(), Number(v));
    } else if (kind === 'email') {
      run(db, 'UPDATE companies SET opt_out = 1, opt_out_at = COALESCE(opt_out_at, ?), updated_at = ? WHERE email = ?', nowIso(), nowIso(), v);
    } else {
      run(db, "UPDATE companies SET opt_out = 1, opt_out_at = COALESCE(opt_out_at, ?), updated_at = ? WHERE website_domain = ? OR email LIKE ?", nowIso(), nowIso(), v, `%@${v}`);
    }
    // 承認済みの下書きも即時無効化
    run(db, `UPDATE approvals SET revoked_at = ?, revoke_reason = '配信停止' WHERE revoked_at IS NULL AND draft_id IN (SELECT d.id FROM drafts d JOIN companies c ON c.id = d.company_id WHERE c.opt_out = 1)`, nowIso());
    audit(db, actor, 'suppression.add', `${kind}:${v}`, reason);
  });
}

export function isSuppressed(db: DB, company: Row, recipient: string): string | null {
  if (company.opt_out) return '企業が配信停止済み';
  const e = normalizeEmail(recipient);
  if (e && get(db, "SELECT 1 FROM suppressions WHERE kind = 'email' AND value = ?", e)) return '宛先メールアドレスが配信停止リストにあります';
  const d = e ? emailDomain(e) : '';
  if (d && get(db, "SELECT 1 FROM suppressions WHERE kind = 'domain' AND value = ?", d)) return '宛先ドメインが配信停止リストにあります';
  if (company.website_domain && get(db, "SELECT 1 FROM suppressions WHERE kind = 'domain' AND value = ?", company.website_domain)) return '企業ドメインが配信停止リストにあります';
  if (get(db, "SELECT 1 FROM suppressions WHERE kind = 'company' AND value = ?", String(company.id))) return '企業が配信停止リストにあります';
  return null;
}

export function listSuppressions(db: DB): Row[] {
  return all(db, 'SELECT * FROM suppressions ORDER BY id DESC');
}
