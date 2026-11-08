// 復元: アプリを停止してから npm run restore -- <バックアップフォルダ>
// 復元前に現在のデータを自動でバックアップする。
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../src/config.js';
import { backup } from './backup.js';

export function restore(dataDir: string, from: string): string {
  const src = path.resolve(from);
  const info = path.join(src, 'BACKUP_INFO.json');
  if (!fs.existsSync(info) || !fs.existsSync(path.join(src, 'app.sqlite'))) throw new Error('指定したフォルダはバックアップではありません（BACKUP_INFO.json / app.sqlite が必要）');
  const check = new DatabaseSync(path.join(src, 'app.sqlite'));
  const ok = (check.prepare('PRAGMA integrity_check').get() as any).integrity_check;
  check.close();
  if (ok !== 'ok') throw new Error(`バックアップの DB が破損しています: ${ok}`);
  const safety = backup(dataDir, true);
  for (const f of ['app.sqlite-wal', 'app.sqlite-shm']) fs.rmSync(path.join(dataDir, f), { force: true });
  fs.copyFileSync(path.join(src, 'app.sqlite'), path.join(dataDir, 'app.sqlite'));
  for (const sub of ['screenshots', 'outbox']) {
    const s = path.join(src, sub);
    if (fs.existsSync(s)) {
      fs.rmSync(path.join(dataDir, sub), { recursive: true, force: true });
      fs.cpSync(s, path.join(dataDir, sub), { recursive: true });
    }
  }
  for (const f of ['secrets.json', 'app.key']) if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(dataDir, f));
  return safety;
}

async function portInUse(port: number, host: string): Promise<boolean> {
  return new Promise((r) => {
    const s = net.connect(port, host);
    s.on('connect', () => (s.destroy(), r(true)));
    s.on('error', () => r(false));
  });
}

if (process.argv[1] && /restore\.ts$/.test(process.argv[1])) {
  const cfg = loadConfig({ startWorker: false });
  const from = process.argv[2];
  if (!from) {
    console.error('使い方: npm run restore -- <バックアップフォルダ>');
    process.exit(1);
  }
  if (await portInUse(cfg.port, cfg.host)) {
    console.error('アプリが起動中です。停止（Ctrl + C）してから復元してください。');
    process.exit(1);
  }
  try {
    const safety = restore(cfg.dataDir, from);
    console.log(`復元しました。復元前のデータは ${safety} に退避しています。`);
  } catch (e) {
    console.error(`復元できませんでした: ${(e as Error).message}`);
    process.exit(1);
  }
}
