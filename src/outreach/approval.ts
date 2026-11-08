// 承認と送信。承認は「利用者が確認した内容のハッシュ」に紐づく。
// 送信直前に禁止・拒否・重複・期限を再確認し、1 つでも満たさなければ送信しない。
import fs from 'node:fs';
import path from 'node:path';
import { type DB, get, all, run, tx, nowIso, audit, type Row } from '../db.js';
import { LIMITS, type AppConfig } from '../config.js';
import { hashObject, sha256 } from '../util/crypto.js';
import { normalizeEmail } from '../util/normalize.js';
import { isSuppressed } from '../domain/eligibility.js';
import { getCompany, setStatus } from '../domain/companies.js';
import { getSender, senderMissing } from './draft.js';
import { previewState, previewUrls } from '../mock/service.js';
import { buildEml } from './eml.js';
import { logUsage } from '../domain/usage.js';

/** 承認対象のスナップショット（この内容が 1 文字でも変われば承認は無効） */
export function approvalSnapshot(db: DB, draft: Row) {
  const c = getCompany(db, draft.company_id)!;
  const m = get(db, 'SELECT * FROM mocks WHERE id = ?', draft.mock_id)!;
  return {
    draftId: draft.id,
    revision: draft.revision,
    channel: draft.channel,
    recipient: draft.recipient,
    subject: draft.subject,
    body: draft.body,
    company: { id: c.id, name: c.name, email: c.email, website: c.website_url, eligibility: c.eligibility, basis: c.eligibility_basis, optOut: c.opt_out },
    mock: { id: m.id, token: m.token, expiresAt: m.expires_at, revoked: !!m.revoked_at },
  };
}

export function contentHash(db: DB, draft: Row): string {
  return hashObject(approvalSnapshot(db, draft));
}

export function activeApproval(db: DB, draftId: number): Row | undefined {
  return get(db, 'SELECT * FROM approvals WHERE draft_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1', draftId);
}

/** 承認可能かの事前チェック（理由の一覧を返す） */
export function approvalBlockers(db: DB, cfg: AppConfig, draft: Row): string[] {
  const b: string[] = [];
  const c = getCompany(db, draft.company_id);
  if (!c) return ['企業が見つかりません'];
  if (draft.archived) b.push('この下書きは古い版です');
  if (c.merged_into) b.push('企業が他レコードに統合されています');
  if (c.eligibility !== 'ok') b.push(`営業可否が「送信可」になっていません（現在: ${c.eligibility}）。企業詳細で根拠を確認・記録してください`);
  const sup = isSuppressed(db, c, draft.recipient);
  if (sup) b.push(sup);
  if (normalizeEmail(draft.recipient) !== c.email || !c.email) b.push('宛先が営業リストに登録された企業のメールアドレスと一致しません');
  const q = JSON.parse(draft.quality || '{}');
  if (q.errors?.length) b.push(...q.errors.map((e: string) => `品質チェック: ${e}`));
  const missing = senderMissing(getSender(db));
  if (missing.length) b.push(`送信者情報が未設定です: ${missing.join('、')}`);
  const m = get(db, 'SELECT * FROM mocks WHERE id = ?', draft.mock_id);
  if (!m || previewState(m) !== 'active') b.push('プレビューが失効または期限切れです');
  else if (!m.admin_reviewed_at) b.push('モックの管理者確認が完了していません（モック画面で「確認済み」にしてください）');
  const dup = get(db, "SELECT id, status FROM sends WHERE company_id = ? AND status IN ('sending','sent','unknown')", c.id);
  if (dup) b.push(`この企業には既に送信記録があります（送信 #${dup.id}・${dup.status}）`);
  void cfg;
  return b;
}

export function approve(db: DB, cfg: AppConfig, draftId: number, shownHash: string, adminId: number): void {
  const d = get(db, 'SELECT * FROM drafts WHERE id = ?', draftId);
  if (!d) throw new Error('下書きが見つかりません');
  const hash = contentHash(db, d);
  // 画面に表示した内容と現在の内容が一致しない場合は承認しない
  if (!shownHash || shownHash !== hash) throw new Error('確認画面の表示後に内容が変更されています。もう一度内容を確認してください');
  const blockers = approvalBlockers(db, cfg, d);
  if (blockers.length) throw new Error(`承認できません: ${blockers.join(' / ')}`);
  tx(db, () => {
    run(db, "UPDATE approvals SET revoked_at = ?, revoke_reason = '再承認により置換' WHERE draft_id = ? AND revoked_at IS NULL", nowIso(), draftId);
    const exp = new Date(Date.now() + LIMITS.approvalTtlHours * 3600_000).toISOString();
    run(db, 'INSERT INTO approvals (draft_id, content_hash, snapshot, approved_by, approved_at, expires_at) VALUES (?,?,?,?,?,?)',
      draftId, hash, JSON.stringify(approvalSnapshot(db, d)), adminId, nowIso(), exp);
    audit(db, `admin:${adminId}`, 'approval.grant', `draft:${draftId}`, hash.slice(0, 12));
  });
}

export function revokeApproval(db: DB, draftId: number, reason: string, actor: string): void {
  run(db, 'UPDATE approvals SET revoked_at = ?, revoke_reason = ? WHERE draft_id = ? AND revoked_at IS NULL', nowIso(), reason.slice(0, 200), draftId);
  audit(db, actor, 'approval.revoke', `draft:${draftId}`, reason);
}

export type ApprovalState = { state: 'none' | 'valid' | 'invalidated' | 'expired'; reason?: string; approval?: Row };

/** 承認の有効性を評価（内容変更・期限切れを検出したら記録して無効化） */
export function evaluateApproval(db: DB, draft: Row, now = new Date()): ApprovalState {
  const a = activeApproval(db, draft.id);
  if (!a) {
    const last = get(db, 'SELECT * FROM approvals WHERE draft_id = ? ORDER BY id DESC LIMIT 1', draft.id);
    return last ? { state: 'invalidated', reason: last.revoke_reason ?? '解除済み', approval: last } : { state: 'none' };
  }
  const exp = new Date(a.expires_at);
  if (Number.isNaN(exp.getTime()) || exp.getTime() <= now.getTime()) return { state: 'expired', reason: '承認の有効期限切れ', approval: a };
  if (a.content_hash !== contentHash(db, draft)) {
    revokeApproval(db, draft.id, '承認後に内容または関連情報が変更された', 'system');
    return { state: 'invalidated', reason: '承認後に内容または関連情報が変更された', approval: a };
  }
  return { state: 'valid', approval: a };
}

export interface SendOutcome {
  sendId: number | null;
  status: 'sent' | 'blocked' | 'unknown' | 'failed';
  message: string;
}

/**
 * 承認済み下書きの送信。現在は「模擬送信」と「EML 出力」のみ。実送信は未実装（設定で有効化不可）。
 * 失敗が不明な場合は「要確認（unknown）」として記録し、自動再送しない。
 */
export function sendApproved(db: DB, cfg: AppConfig, draftId: number, confirmHash: string, adminId: number, mode: 'simulated' | 'real' = 'simulated'): SendOutcome {
  const blocked = (msg: string): SendOutcome => {
    audit(db, `admin:${adminId}`, 'send.blocked', `draft:${draftId}`, msg);
    return { sendId: null, status: 'blocked', message: msg };
  };
  if (mode === 'real') return blocked('実送信は未実装です（送信先・送信サーバー設定・送信内容の承認が整った後に実装・有効化する段階です）');
  const pre = tx(db, () => {
    const d = get(db, 'SELECT * FROM drafts WHERE id = ?', draftId);
    if (!d) return { err: '下書きが見つかりません' };
    const st = evaluateApproval(db, d);
    if (st.state !== 'valid') return { err: `承認が有効ではありません（${st.reason ?? '未承認'}）` };
    if (!confirmHash || confirmHash !== st.approval!.content_hash) return { err: '承認した内容と送信しようとしている内容が一致しません' };
    // 送信直前の再確認（承認後に状況が変わっている可能性）
    const blockers = approvalBlockers(db, cfg, d);
    if (blockers.length) return { err: blockers.join(' / ') };
    const recip = normalizeEmail(d.recipient)!;
    const other = get(db, "SELECT id FROM sends WHERE recipient_norm = ? AND status IN ('sending','sent','unknown')", recip);
    if (other) return { err: `同じ宛先への送信記録があります（送信 #${other.id}）` };
    const key = sha256(`${draftId}:${st.approval!.content_hash}`);
    try {
      const r = run(db, 'INSERT INTO sends (draft_id, company_id, approval_id, channel, mode, recipient_norm, idempotency_key, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        draftId, d.company_id, st.approval!.id, d.channel, mode, recip, key, 'sending', nowIso(), nowIso());
      return { sendId: Number(r.lastInsertRowid), draft: d };
    } catch {
      return { err: '同じ承認内容での送信が既に実行されています（重複防止）' };
    }
  });
  if ('err' in pre) return blocked(pre.err!);
  const { sendId, draft } = pre as { sendId: number; draft: Row };
  try {
    const sender = getSender(db);
    const eml = buildEml({ from: sender.email, fromName: sender.companyName, to: draft.recipient, subject: draft.subject, body: draft.body, messageIdDomain: sender.email.split('@')[1] || 'localhost' });
    const fileName = `send-${sendId}.eml`;
    fs.writeFileSync(path.join(cfg.dataDir, 'outbox', fileName), eml);
    const simulate = process.env.SIMULATE_SEND_RESULT;
    if (simulate === 'unknown') throw new Error('模擬: 送信結果が不明（タイムアウト）');
    tx(db, () => {
      run(db, "UPDATE sends SET status = 'sent', eml_file = ?, detail = ?, updated_at = ? WHERE id = ?", fileName, '模擬送信（外部には送信していません）。EML を outbox に出力', nowIso(), sendId);
      run(db, "UPDATE approvals SET revoked_at = ?, revoke_reason = '送信に使用済み' WHERE id = (SELECT approval_id FROM sends WHERE id = ?)", nowIso(), sendId);
      setStatus(db, draft.company_id, 'sent', `admin:${adminId}`);
      audit(db, `admin:${adminId}`, 'send.simulated', `send:${sendId}`, draft.recipient);
    });
    logUsage(db, { service: 'simulated-send', operation: 'send', companyId: draft.company_id, units: '1 message', costStatus: 'free' });
    return { sendId, status: 'sent', message: '模擬送信しました（外部への送信は行っていません）' };
  } catch (e) {
    run(db, "UPDATE sends SET status = 'unknown', detail = ?, updated_at = ? WHERE id = ?", `要確認: ${(e as Error).message}。自動再送は行いません`, nowIso(), sendId);
    audit(db, `admin:${adminId}`, 'send.unknown', `send:${sendId}`, (e as Error).message);
    return { sendId, status: 'unknown', message: '送信結果が不明なため「要確認」にしました。自動再送はしません' };
  }
}

/** 起動時: 送信処理中のまま停止したものは結果不明として要確認に */
export function recoverInterruptedSends(db: DB): number {
  const r = run(db, "UPDATE sends SET status = 'unknown', detail = '処理中に停止したため結果不明（要確認）', updated_at = ? WHERE status = 'sending'", nowIso());
  return Number(r.changes);
}

/** 要確認の送信を利用者が確認して確定する */
export function resolveUnknownSend(db: DB, sendId: number, result: 'sent' | 'failed', note: string, actor: string): void {
  const s = get(db, 'SELECT * FROM sends WHERE id = ?', sendId);
  if (!s || s.status !== 'unknown') throw new Error('要確認の送信ではありません');
  tx(db, () => {
    run(db, 'UPDATE sends SET status = ?, detail = detail || ?, updated_at = ? WHERE id = ?', result, `\n[確認 ${nowIso().slice(0, 16)}] ${note}`, nowIso(), sendId);
    if (result === 'sent') setStatus(db, s.company_id, 'sent', actor);
    audit(db, actor, 'send.resolve', `send:${sendId}`, result);
  });
}

export function approvalQueue(db: DB): Row[] {
  return all(db, `SELECT d.*, c.name AS company_name, c.eligibility, c.opt_out, c.status AS company_status
    FROM drafts d JOIN companies c ON c.id = d.company_id
    WHERE d.archived = 0 AND c.merged_into IS NULL AND c.status IN ('awaiting_approval','mocked','analyzed')
      AND NOT EXISTS (SELECT 1 FROM sends s WHERE s.company_id = d.company_id AND s.status IN ('sending','sent','unknown'))
    ORDER BY d.updated_at DESC`);
}

export { previewUrls };
