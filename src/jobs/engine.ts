// 永続ジョブエンジン（SQLite）。中断・再開・リトライ・Retry-After・再起動後の復元に対応。
// 送信はジョブ化しない（利用者の承認操作でのみ実行）。
import { type DB, get, all, run, tx, nowIso, audit, type Row } from '../db.js';
import { LIMITS, type AppConfig } from '../config.js';
import { RetryAfterError } from '../net/fetcher.js';
import { PermanentError, analyzeCompany } from '../analysis/analyze.js';
import { generateMock } from '../mock/service.js';
import { generateDraft } from '../outreach/draft.js';
import { getCompany } from '../domain/companies.js';
import { captureMockShots } from '../mock/shots.js';

export type JobType = 'analyze' | 'mock' | 'draft' | 'mock_shots';

export const JOB_LABELS: Record<string, string> = { analyze: 'サイト分析', mock: 'モック生成', draft: '営業文作成', mock_shots: 'モック撮影' };
export const JOB_STATUS_LABELS: Record<string, string> = { queued: '待機中', running: '処理中', succeeded: '完了', failed: '失敗', paused: '一時停止', cancelled: '取消' };

export function enqueue(db: DB, type: JobType, companyId: number | null, opts: { payload?: object; chain?: boolean; dedupeSuffix?: string } = {}): { id: number; created: boolean } {
  const dedupe = `${type}:${companyId ?? '-'}:${opts.dedupeSuffix ?? ''}`;
  const active = get(db, "SELECT id FROM jobs WHERE dedupe_key = ? AND status IN ('queued','running','paused')", dedupe);
  if (active) return { id: active.id, created: false };
  const payload = JSON.stringify({ chain: opts.chain ?? false, ...(opts.payload ?? {}) });
  const r = run(db, 'INSERT INTO jobs (type, company_id, dedupe_key, payload, status, max_attempts, run_after, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    type, companyId, dedupe, payload, 'queued', LIMITS.jobMaxAttempts, nowIso(), nowIso(), nowIso());
  return { id: Number(r.lastInsertRowid), created: true };
}

/** 再起動時: リース切れの処理中ジョブを待機中に戻す */
export function recoverJobs(db: DB): number {
  const r = run(db, "UPDATE jobs SET status = 'queued', lease_until = NULL, last_error = COALESCE(last_error, '') || ' [再起動により再開]', updated_at = ? WHERE status = 'running'", nowIso());
  return Number(r.changes);
}

function claim(db: DB): Row | undefined {
  return tx(db, () => {
    const j = get(db, "SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY id LIMIT 1", nowIso());
    if (!j) return undefined;
    const lease = new Date(Date.now() + LIMITS.jobTimeoutMs + 30_000).toISOString();
    run(db, "UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_until = ?, updated_at = ? WHERE id = ? AND status = 'queued'", lease, nowIso(), j.id);
    return { ...j, attempts: j.attempts + 1 };
  });
}

async function execute(db: DB, cfg: AppConfig, job: Row): Promise<{ summary: string; next?: JobType }> {
  const cid = job.company_id as number;
  const c = getCompany(db, cid);
  if (!c) throw new PermanentError('企業が見つかりません');
  if (c.opt_out) throw new PermanentError('処理中に配信停止されたため中止しました');
  if (c.merged_into) throw new PermanentError('企業が統合済みのため中止しました');
  switch (job.type as JobType) {
    case 'analyze': {
      const r = await analyzeCompany(db, cfg, cid, job.id);
      const after = getCompany(db, cid)!;
      if (after.site_status !== 'ok') return { summary: `${r.message}。公式サイト未確認のため後続処理を停止（企業詳細で確認してください）` };
      if (after.status === 'excluded') return { summary: `${r.message}。営業禁止表示などにより送信対象外` };
      return { summary: r.message, next: 'mock' };
    }
    case 'mock': {
      const r = generateMock(db, cid, job.id);
      return { summary: r.reused ? `既存モック #${r.mockId} を再利用` : `モック #${r.mockId} を生成`, next: 'draft' };
    }
    case 'draft': {
      const r = generateDraft(db, cfg, cid, job.id);
      return { summary: r.reused ? `既存の下書き #${r.draftId} を再利用` : `下書き #${r.draftId} を作成（承認待ち）`, next: 'mock_shots' };
    }
    case 'mock_shots': {
      const n = await captureMockShots(db, cfg, cid);
      return { summary: n ? `モックのPC/スマートフォン画面を ${n} 枚撮影` : 'ブラウザ未接続のため撮影を省略' };
    }
  }
  throw new PermanentError(`未知のジョブ種別: ${job.type}`);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`タイムアウト（${ms / 1000}秒）`)), ms);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

export async function runOne(db: DB, cfg: AppConfig): Promise<boolean> {
  const job = claim(db);
  if (!job) return false;
  try {
    const r = await withTimeout(execute(db, cfg, job), LIMITS.jobTimeoutMs);
    run(db, "UPDATE jobs SET status = 'succeeded', result = ?, last_error = NULL, lease_until = NULL, updated_at = ? WHERE id = ?", r.summary, nowIso(), job.id);
    const payload = JSON.parse(job.payload || '{}');
    if (payload.chain && r.next) enqueue(db, r.next, job.company_id, { chain: true });
  } catch (e) {
    const err = e as Error;
    if (e instanceof RetryAfterError) {
      // 429 / 503: Retry-After を尊重（試行回数は消費しない）
      const after = new Date(Date.now() + e.retryAfterSec * 1000).toISOString();
      run(db, "UPDATE jobs SET status = 'queued', attempts = attempts - 1, run_after = ?, last_error = ?, lease_until = NULL, updated_at = ? WHERE id = ?", after, `${err.message}: ${e.retryAfterSec}秒後に再試行`, nowIso(), job.id);
    } else if (e instanceof PermanentError || job.attempts >= job.max_attempts) {
      run(db, "UPDATE jobs SET status = 'failed', retryable = ?, last_error = ?, lease_until = NULL, updated_at = ? WHERE id = ?", e instanceof PermanentError ? 0 : 1, err.message.slice(0, 1000), nowIso(), job.id);
    } else {
      const backoff = Math.min(300, 5 * 2 ** job.attempts);
      run(db, "UPDATE jobs SET status = 'queued', run_after = ?, last_error = ?, lease_until = NULL, updated_at = ? WHERE id = ?", new Date(Date.now() + backoff * 1000).toISOString(), `${err.message}（${backoff}秒後に再試行）`, nowIso(), job.id);
    }
  }
  return true;
}

/** 失敗ジョブの手動再実行（成果物は入力ハッシュで再利用されるため重複しない） */
export function retryJob(db: DB, jobId: number, actor: string): void {
  const j = get(db, 'SELECT * FROM jobs WHERE id = ?', jobId);
  if (!j || !['failed', 'cancelled'].includes(j.status)) throw new Error('再実行できる状態ではありません');
  const active = get(db, "SELECT id FROM jobs WHERE dedupe_key = ? AND status IN ('queued','running','paused')", j.dedupe_key);
  if (active) throw new Error(`同じ処理が既に待機中です（ジョブ #${active.id}）`);
  run(db, "UPDATE jobs SET status = 'queued', attempts = 0, run_after = ?, last_error = NULL, updated_at = ? WHERE id = ?", nowIso(), nowIso(), jobId);
  audit(db, actor, 'job.retry', `job:${jobId}`);
}

export function setJobPaused(db: DB, jobId: number, paused: boolean, actor: string): void {
  if (paused) run(db, "UPDATE jobs SET status = 'paused', updated_at = ? WHERE id = ? AND status = 'queued'", nowIso(), jobId);
  else run(db, "UPDATE jobs SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'paused'", nowIso(), jobId);
  audit(db, actor, paused ? 'job.pause' : 'job.resume', `job:${jobId}`);
}

export function cancelJob(db: DB, jobId: number, actor: string): void {
  run(db, "UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('queued','paused')", nowIso(), jobId);
  audit(db, actor, 'job.cancel', `job:${jobId}`);
}

export class Worker {
  private timer: NodeJS.Timeout | null = null;
  private inflight = 0;
  private stopped = false;
  constructor(private db: DB, private cfg: AppConfig) {}
  start(): void {
    this.stopped = false;
    this.timer = setInterval(() => this.tick(), 500);
  }
  private tick(): void {
    while (!this.stopped && this.inflight < this.cfg.workerConcurrency) {
      this.inflight++;
      runOne(this.db, this.cfg)
        .then((did) => {
          this.inflight--;
          if (did) this.tick();
        })
        .catch(() => this.inflight--);
      // runOne は同期的に claim するため、1 回の tick で並列数まで投入
      if (!get(this.db, "SELECT 1 FROM jobs WHERE status = 'queued' AND run_after <= ?", nowIso())) break;
    }
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (let i = 0; i < 100 && this.inflight > 0; i++) await new Promise((r) => setTimeout(r, 100));
  }
}

/** テスト・シード用: キューが空になるまで実行 */
export async function drain(db: DB, cfg: AppConfig, max = 200): Promise<number> {
  let n = 0;
  while (n < max && (await runOne(db, cfg))) n++;
  return n;
}

export function listJobs(db: DB, status?: string): Row[] {
  return status ? all(db, 'SELECT * FROM jobs WHERE status = ? ORDER BY id DESC LIMIT 300', status) : all(db, 'SELECT * FROM jobs ORDER BY id DESC LIMIT 300');
}
