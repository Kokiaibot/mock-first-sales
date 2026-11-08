// 秘密情報の保存（data/secrets.json）。ソースコード・ログ・画面に値を出さない。
// data/ は .gitignore 済み。Windows では利用者プロファイル配下のため他ユーザーからは読めない想定。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

type Secrets = Record<string, string>;

function file(dataDir: string) {
  return path.join(dataDir, 'secrets.json');
}

function load(dataDir: string): Secrets {
  try {
    return JSON.parse(fs.readFileSync(file(dataDir), 'utf8'));
  } catch {
    return {};
  }
}

export function getSecret(dataDir: string, key: string): string {
  return process.env[`MFS_${key.toUpperCase()}`] || load(dataDir)[key] || '';
}

export function setSecret(dataDir: string, key: string, value: string): void {
  const s = load(dataDir);
  if (value) s[key] = value;
  else delete s[key];
  fs.writeFileSync(file(dataDir), JSON.stringify(s, null, 2), { mode: 0o600 });
}

/** アプリ固有の署名鍵（セッション・プレビュー Cookie 用） */
export function appSecret(dataDir: string): string {
  const p = path.join(dataDir, 'app.key');
  if (!fs.existsSync(p)) fs.writeFileSync(p, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  return fs.readFileSync(p, 'utf8').trim();
}

/** ログ出力用のマスク */
export function redact(s: string): string {
  return s.replace(/(token|key|password|secret)(["'=:\s]+)([^\s"'&]+)/gi, '$1$2***');
}
