// バックアップ: npm run backup [-- --include-secrets]
// data/backups/backup-YYYYMMDD-HHMMSS/ に DB（整合性のあるスナップショット）・スクリーンショット・送信EMLを複製する。
// 既定では秘密情報（secrets.json / app.key）は含めない。
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../src/config.js';

export function backup(dataDir: string, includeSecrets = false): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  let dest = path.join(dataDir, 'backups', `backup-${stamp}`);
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dataDir, 'backups', `backup-${stamp}-${i}`);
  fs.mkdirSync(dest, { recursive: true });
  const src = path.join(dataDir, 'app.sqlite');
  if (fs.existsSync(src)) {
    const db = new DatabaseSync(src);
    db.exec(`VACUUM INTO '${path.join(dest, 'app.sqlite').replace(/'/g, "''")}'`);
    db.close();
  }
  for (const sub of ['screenshots', 'outbox']) {
    const from = path.join(dataDir, sub);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dest, sub), { recursive: true });
  }
  if (includeSecrets) {
    for (const f of ['secrets.json', 'app.key']) if (fs.existsSync(path.join(dataDir, f))) fs.copyFileSync(path.join(dataDir, f), path.join(dest, f));
  }
  fs.writeFileSync(path.join(dest, 'BACKUP_INFO.json'), JSON.stringify({ createdAt: new Date().toISOString(), includeSecrets, app: 'mock-first-sales' }, null, 2));
  return dest;
}

if (process.argv[1] && /backup\.ts$/.test(process.argv[1])) {
  const cfg = loadConfig({ startWorker: false });
  const dest = backup(cfg.dataDir, process.argv.includes('--include-secrets'));
  console.log(`バックアップを作成しました: ${dest}`);
  console.log('※ 顧客データを含みます。外部に共有しないでください。');
}
