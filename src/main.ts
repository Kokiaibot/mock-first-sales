// 起動エントリ: npm start
import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './web/app.js';
import { Worker, recoverJobs } from './jobs/engine.js';
import { recoverInterruptedSends } from './outreach/approval.js';
import { closeBrowser } from './analysis/browser.js';
import { needsSetup } from './auth.js';

const cfg = loadConfig();
const db = openDb(cfg.dataDir);
const resumed = recoverJobs(db);
const unknown = recoverInterruptedSends(db);
const app = createApp(db, cfg);
const worker = new Worker(db, cfg);
if (cfg.startWorker) worker.start();

const server = serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port }, (info) => {
  const url = `http://${cfg.host === '::1' ? '[::1]' : cfg.host}:${info.port}/`;
  console.log('──────────────────────────────────────────────');
  console.log(' モック先出し営業支援システム 起動しました');
  console.log(` 管理画面: ${url}${needsSetup(db) ? 'setup （初回は管理者を作成）' : 'admin/'}`);
  console.log(` データ保存先: ${cfg.dataDir}`);
  if (resumed) console.log(` 中断していたジョブ ${resumed} 件を再開します`);
  if (unknown) console.log(` 送信処理中に停止した ${unknown} 件を「要確認」にしました`);
  console.log(' 停止: Ctrl + C');
  console.log('──────────────────────────────────────────────');
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('停止しています…');
  await worker.stop();
  await closeBrowser();
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
