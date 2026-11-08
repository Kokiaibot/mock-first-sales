// SQLite 永続化（Node 組み込み node:sqlite を使用し、Windows でネイティブビルド不要にする）
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

export type DB = DatabaseSync;

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE admin (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    pw_hash TEXT NOT NULL,
    failed_count INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admin(id),
    csrf TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE search_profiles (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    criteria TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE companies (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    name_norm TEXT NOT NULL,
    prefecture TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    industry TEXT NOT NULL DEFAULT '',
    website_url TEXT NOT NULL DEFAULT '',
    website_domain TEXT NOT NULL DEFAULT '',
    site_status TEXT NOT NULL DEFAULT 'unchecked',
    site_evidence TEXT NOT NULL DEFAULT '',
    site_checked_at TEXT,
    contact_url TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    email_evidence_url TEXT NOT NULL DEFAULT '',
    source_name TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    source_license TEXT NOT NULL DEFAULT '',
    is_fictional INTEGER NOT NULL DEFAULT 0,
    fetched_at TEXT,
    eligibility TEXT NOT NULL DEFAULT 'unreviewed',
    eligibility_basis TEXT NOT NULL DEFAULT '',
    eligibility_note TEXT NOT NULL DEFAULT '',
    eligibility_auto TEXT NOT NULL DEFAULT '',
    eligibility_reviewed_at TEXT,
    opt_out INTEGER NOT NULL DEFAULT 0,
    opt_out_at TEXT,
    unsubscribe_token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'new',
    memo TEXT NOT NULL DEFAULT '',
    merged_into INTEGER REFERENCES companies(id),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_companies_domain ON companies(website_domain);
  CREATE INDEX idx_companies_status ON companies(status);

  CREATE TABLE analyses (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    input_hash TEXT NOT NULL,
    method TEXT NOT NULL,
    fetch_status TEXT NOT NULL,
    page_facts TEXT NOT NULL,
    measurements TEXT NOT NULL,
    brand_colors TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_analyses_input ON analyses(company_id, input_hash);

  CREATE TABLE findings (
    id INTEGER PRIMARY KEY,
    analysis_id INTEGER NOT NULL REFERENCES analyses(id),
    category INTEGER NOT NULL,
    status TEXT NOT NULL,
    fact TEXT NOT NULL,
    issue_points TEXT NOT NULL DEFAULT '[]',
    suggestion TEXT NOT NULL,
    suggestion_source TEXT NOT NULL,
    evidence_url TEXT NOT NULL,
    screenshot_id INTEGER,
    policy TEXT NOT NULL,
    checked_at TEXT NOT NULL
  );

  CREATE TABLE screenshots (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    kind TEXT NOT NULL,
    file_name TEXT NOT NULL UNIQUE,
    source_url TEXT NOT NULL,
    width INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE mocks (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    analysis_id INTEGER NOT NULL REFERENCES analyses(id),
    input_hash TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    view_code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    superseded INTEGER NOT NULL DEFAULT 0,
    admin_reviewed_at TEXT,
    spec TEXT NOT NULL,
    generation_method TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_mocks_input ON mocks(company_id, input_hash);

  CREATE TABLE drafts (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    mock_id INTEGER NOT NULL REFERENCES mocks(id),
    channel TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    generation_method TEXT NOT NULL,
    quality TEXT NOT NULL DEFAULT '{}',
    revision INTEGER NOT NULL DEFAULT 1,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE approvals (
    id INTEGER PRIMARY KEY,
    draft_id INTEGER NOT NULL REFERENCES drafts(id),
    content_hash TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    approved_by INTEGER NOT NULL REFERENCES admin(id),
    approved_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    revoke_reason TEXT
  );

  CREATE TABLE sends (
    id INTEGER PRIMARY KEY,
    draft_id INTEGER NOT NULL REFERENCES drafts(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    approval_id INTEGER REFERENCES approvals(id),
    channel TEXT NOT NULL,
    mode TEXT NOT NULL,
    recipient_norm TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    eml_file TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE suppressions (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(kind, value)
  );

  CREATE TABLE outcomes (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    kind TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    amount_jpy INTEGER,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    company_id INTEGER,
    dedupe_key TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL,
    run_after TEXT NOT NULL,
    lease_until TEXT,
    last_error TEXT,
    retryable INTEGER NOT NULL DEFAULT 1,
    result TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_jobs_dedupe_active ON jobs(dedupe_key) WHERE status IN ('queued','running','paused');
  CREATE INDEX idx_jobs_status ON jobs(status, run_after);

  CREATE TABLE usage_log (
    id INTEGER PRIMARY KEY,
    service TEXT NOT NULL,
    operation TEXT NOT NULL,
    company_id INTEGER,
    job_id INTEGER,
    units TEXT NOT NULL DEFAULT '',
    cost_status TEXT NOT NULL,
    cost_jpy REAL,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  `,
];

export function openDb(dataDir: string, fileName = 'app.sqlite'): DB {
  const db = new DatabaseSync(path.join(dataDir, fileName));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function openMemoryDb(): DB {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = db.prepare('SELECT v FROM schema_version').get() as { v: number } | undefined;
  let v = row?.v ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (v) VALUES (0)').run();
  while (v < MIGRATIONS.length) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.prepare('UPDATE schema_version SET v = ?').run(v + 1);
    });
    v++;
  }
}

/** 同期トランザクション（node:sqlite は同期 API） */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export type Row = Record<string, any>;

export function all<T = Row>(db: DB, sql: string, ...params: any[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function get<T = Row>(db: DB, sql: string, ...params: any[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function run(db: DB, sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params);
}

export function audit(db: DB, actor: string, action: string, target = '', detail = ''): void {
  run(db, 'INSERT INTO audit_log (actor, action, target, detail, created_at) VALUES (?,?,?,?,?)', actor, action, target, detail, nowIso());
}

export function getSetting<T>(db: DB, key: string, fallback: T): T {
  const r = get<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key);
  if (!r) return fallback;
  try {
    return { ...(fallback as any), ...JSON.parse(r.value) } as T;
  } catch {
    return fallback;
  }
}
export function setSetting(db: DB, key: string, value: unknown): void {
  run(
    db,
    'INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    key,
    JSON.stringify(value),
    nowIso(),
  );
}
