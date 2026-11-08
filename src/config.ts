// 実行時設定。秘密情報はここに書かない（data/secrets.json または環境変数）。
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  allowRemote: boolean;
  /** 外部から閲覧可能なベースURL（未設定ならローカルURLのみ） */
  publicBaseUrl: string;
  /** 送信モード。初期は simulated 固定。real は未実装（外部条件待ち） */
  workerConcurrency: number;
  fixturesDir: string;
  /** テスト時にワーカーを自動起動しない */
  startWorker: boolean;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function projectRoot(): string {
  return ROOT;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  // .env があれば読み込む（既存の環境変数は上書きしない）
  const envFile = path.join(ROOT, '.env');
  if (!process.env.VITEST && fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const env = process.env;
  const host = overrides.host ?? env.HOST ?? '127.0.0.1';
  const allowRemote = overrides.allowRemote ?? env.ALLOW_REMOTE === '1';
  if (!allowRemote && !isLoopbackHost(host)) {
    throw new Error(
      `HOST=${host} はローカル以外のアドレスです。外部公開する場合は ALLOW_REMOTE=1 を明示してください（docs/SECURITY.md 参照）。`,
    );
  }
  const cfg: AppConfig = {
    host,
    port: overrides.port ?? Number(env.PORT ?? 8787),
    dataDir: path.resolve(overrides.dataDir ?? env.DATA_DIR ?? path.join(ROOT, 'data')),
    allowRemote,
    publicBaseUrl: overrides.publicBaseUrl ?? env.PUBLIC_BASE_URL ?? '',
    workerConcurrency: overrides.workerConcurrency ?? Math.min(4, Math.max(1, Number(env.WORKER_CONCURRENCY ?? 2))),
    fixturesDir: overrides.fixturesDir ?? path.join(ROOT, 'fixtures', 'sites'),
    startWorker: overrides.startWorker ?? true,
  };
  for (const sub of ['', 'screenshots', 'outbox', 'backups', 'tmp']) {
    fs.mkdirSync(path.join(cfg.dataDir, sub), { recursive: true });
  }
  return cfg;
}

export function isLoopbackHost(h: string): boolean {
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

/** 上限値（ジョブ・取得件数・タイムアウト） */
export const LIMITS = {
  maxCandidatesPerSearch: 200,
  fetchTimeoutMs: 15_000,
  fetchMaxBytes: 3 * 1024 * 1024,
  maxRedirects: 5,
  jobTimeoutMs: 120_000,
  jobMaxAttempts: 3,
  screenshotTimeoutMs: 30_000,
  approvalTtlHours: 72,
  previewDefaultDays: 14,
  loginMaxFailures: 5,
  loginLockMinutes: 5,
  csvMaxBytes: 5 * 1024 * 1024,
} as const;
