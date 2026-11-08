// モックの生成・プレビューのアクセス制御（トークン・閲覧コード・有効期限・失効・再発行）
import { type DB, get, run, tx, nowIso, audit, all, type Row } from '../db.js';
import type { AppConfig } from '../config.js';
import { LIMITS } from '../config.js';
import { buildSpec, type MockSpec } from './spec.js';
import { latestAnalysis, findingsOf, PermanentError } from '../analysis/analyze.js';
import { advanceStatus, getCompany } from '../domain/companies.js';
import { hashObject, randomToken, randomViewCode, hmac, safeEqual } from '../util/crypto.js';
import { logUsage } from '../domain/usage.js';

export interface MockOutcome {
  mockId: number;
  reused: boolean;
}

export function generateMock(db: DB, companyId: number, jobId?: number): MockOutcome {
  const c = getCompany(db, companyId);
  if (!c) throw new PermanentError('企業が見つかりません');
  if (c.site_status !== 'ok') throw new PermanentError(`公式サイトの確認が完了していないためモックを作成できません（状態: ${c.site_status}）`);
  const a = latestAnalysis(db, companyId);
  if (!a) throw new PermanentError('分析結果がありません。先に分析を実行してください');
  const findings = findingsOf(db, a.id);
  const pages = JSON.parse(a.page_facts).map((p: any) => ({ ...p, text: p.textExcerpt ?? '', links: [] }));
  const inputHash = hashObject({ analysisId: a.id, companyName: c.name, industry: c.industry, city: c.city, specVersion: 1 });
  const existing = get(db, 'SELECT id FROM mocks WHERE company_id = ? AND input_hash = ? AND revoked_at IS NULL AND superseded = 0', companyId, inputHash);
  if (existing) return { mockId: existing.id, reused: true };
  const spec = buildSpec(c, pages, findings);
  const id = tx(db, () => {
    run(db, 'UPDATE mocks SET superseded = 1 WHERE company_id = ? AND superseded = 0', companyId);
    const r = run(
      db,
      'INSERT INTO mocks (company_id, analysis_id, input_hash, token, view_code, expires_at, spec, generation_method, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      companyId, a.id, inputHash, randomToken(24), randomViewCode(), addDays(LIMITS.previewDefaultDays), JSON.stringify(spec), 'template+rule', nowIso(),
    );
    return Number(r.lastInsertRowid);
  });
  logUsage(db, { service: 'local-template', operation: 'mock-generate', companyId, jobId, units: '1 mock', costStatus: 'free' });
  advanceStatus(db, companyId, 'mocked');
  return { mockId: id, reused: false };
}

export function addDays(days: number, from = new Date()): string {
  return new Date(from.getTime() + days * 86400_000).toISOString();
}

export function getMock(db: DB, id: number): Row | undefined {
  return get(db, 'SELECT * FROM mocks WHERE id = ?', id);
}
export function currentMock(db: DB, companyId: number): Row | undefined {
  return get(db, 'SELECT * FROM mocks WHERE company_id = ? AND superseded = 0 ORDER BY id DESC LIMIT 1', companyId);
}
export function mockSpec(m: Row): MockSpec {
  return JSON.parse(m.spec);
}

export function previewState(m: Row, now = new Date()): 'active' | 'expired' | 'revoked' {
  if (m.revoked_at) return 'revoked';
  if (new Date(m.expires_at).getTime() <= now.getTime()) return 'expired';
  return 'active';
}

/** 失効（URL・閲覧コードとも無効化）。関連する承認も解除する */
export function revokeMock(db: DB, mockId: number, actor: string): void {
  tx(db, () => {
    run(db, 'UPDATE mocks SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', nowIso(), mockId);
    run(db, "UPDATE approvals SET revoked_at = ?, revoke_reason = 'プレビューが失効された' WHERE revoked_at IS NULL AND draft_id IN (SELECT id FROM drafts WHERE mock_id = ?)", nowIso(), mockId);
    audit(db, actor, 'mock.revoke', `mock:${mockId}`);
  });
}

/** 再発行: 新しいトークン・閲覧コード・期限。旧 URL は無効になり、関連承認は解除 */
export function reissueMock(db: DB, mockId: number, days: number, actor: string): void {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('有効日数は 1〜90 日で指定してください');
  tx(db, () => {
    run(db, 'UPDATE mocks SET token = ?, view_code = ?, expires_at = ?, revoked_at = NULL WHERE id = ?', randomToken(24), randomViewCode(), addDays(days), mockId);
    run(db, "UPDATE approvals SET revoked_at = ?, revoke_reason = 'プレビューURLが再発行された' WHERE revoked_at IS NULL AND draft_id IN (SELECT id FROM drafts WHERE mock_id = ?)", nowIso(), mockId);
    audit(db, actor, 'mock.reissue', `mock:${mockId}`, `${days}日`);
  });
}

export function markReviewed(db: DB, mockId: number, actor: string): void {
  run(db, 'UPDATE mocks SET admin_reviewed_at = ? WHERE id = ?', nowIso(), mockId);
  audit(db, actor, 'mock.review', `mock:${mockId}`);
}

// ---- 顧客向けプレビューの認可（管理画面の認証とは別系統） ----
const failures = new Map<string, { n: number; until: number }>();

export function checkViewCode(m: Row, code: string): 'ok' | 'bad' | 'locked' {
  const f = failures.get(m.token);
  if (f && f.until > Date.now()) return 'locked';
  const norm = (code || '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (norm.length === m.view_code.length && safeEqual(norm, m.view_code)) {
    failures.delete(m.token);
    return 'ok';
  }
  const n = (f?.n ?? 0) + 1;
  failures.set(m.token, { n, until: n >= 10 ? Date.now() + 15 * 60_000 : 0 });
  return 'bad';
}

export function previewCookieValue(secret: string, m: Row): string {
  return hmac(secret, `${m.id}:${m.token}:${m.view_code}:${m.expires_at}`);
}

export function previewUrls(cfg: AppConfig, m: Row): { local: string; external: string | null } {
  const local = `http://${cfg.host === '::1' ? '[::1]' : cfg.host}:${cfg.port}/p/${m.token}/`;
  const external = cfg.publicBaseUrl ? `${cfg.publicBaseUrl.replace(/\/$/, '')}/p/${m.token}/` : null;
  return { local, external };
}

export function listMocks(db: DB, companyId: number): Row[] {
  return all(db, 'SELECT * FROM mocks WHERE company_id = ? ORDER BY id DESC', companyId);
}
