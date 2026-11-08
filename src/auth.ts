// 管理者認証（初期設定で作成）。セッションは DB にハッシュで保存。
import { type DB, get, run, nowIso, audit } from './db.js';
import { hashPassword, verifyPassword, randomToken, sha256 } from './util/crypto.js';
import { LIMITS } from './config.js';

const SESSION_HOURS = 12;

export function needsSetup(db: DB): boolean {
  return !get(db, 'SELECT id FROM admin LIMIT 1');
}

export function validatePassword(pw: string): string | null {
  if (pw.length < 12) return 'パスワードは12文字以上にしてください';
  if (pw.length > 200) return 'パスワードが長すぎます';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'パスワードには英字と数字を含めてください';
  return null;
}

export function createAdmin(db: DB, username: string, password: string): number {
  if (!needsSetup(db)) throw new Error('管理者は既に作成されています');
  const u = username.trim();
  if (!/^[A-Za-z0-9_.-]{3,40}$/.test(u)) throw new Error('ユーザー名は半角英数字3〜40文字で入力してください');
  const err = validatePassword(password);
  if (err) throw new Error(err);
  const r = run(db, 'INSERT INTO admin (username, pw_hash, created_at) VALUES (?,?,?)', u, hashPassword(password), nowIso());
  audit(db, 'setup', 'admin.create', u);
  return Number(r.lastInsertRowid);
}

export type LoginResult = { ok: true; token: string } | { ok: false; message: string };

export function login(db: DB, username: string, password: string): LoginResult {
  const a = get(db, 'SELECT * FROM admin WHERE username = ?', username.trim());
  const generic = 'ユーザー名またはパスワードが正しくありません';
  if (!a) {
    verifyPassword(password, 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='); // タイミング差を減らす
    return { ok: false, message: generic };
  }
  if (a.locked_until && new Date(a.locked_until).getTime() > Date.now()) {
    return { ok: false, message: `ログイン失敗が続いたため一時的にロックしています（${LIMITS.loginLockMinutes}分後に再試行してください）` };
  }
  if (!verifyPassword(password, a.pw_hash)) {
    const n = a.failed_count + 1;
    const lock = n >= LIMITS.loginMaxFailures ? new Date(Date.now() + LIMITS.loginLockMinutes * 60_000).toISOString() : null;
    run(db, 'UPDATE admin SET failed_count = ?, locked_until = ? WHERE id = ?', lock ? 0 : n, lock, a.id);
    audit(db, 'anon', 'login.fail', a.username);
    return { ok: false, message: generic };
  }
  run(db, 'UPDATE admin SET failed_count = 0, locked_until = NULL WHERE id = ?', a.id);
  const token = randomToken(32);
  run(db, 'INSERT INTO sessions (id_hash, admin_id, csrf, expires_at, created_at) VALUES (?,?,?,?,?)', sha256(token), a.id, randomToken(24),
    new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString(), nowIso());
  run(db, 'DELETE FROM sessions WHERE expires_at < ?', nowIso());
  audit(db, `admin:${a.id}`, 'login.ok', a.username);
  return { ok: true, token };
}

export interface Session {
  adminId: number;
  username: string;
  csrf: string;
}

export function getSession(db: DB, token: string | undefined): Session | null {
  if (!token) return null;
  const s = get(db, 'SELECT s.*, a.username FROM sessions s JOIN admin a ON a.id = s.admin_id WHERE s.id_hash = ?', sha256(token));
  if (!s || new Date(s.expires_at).getTime() < Date.now()) return null;
  return { adminId: s.admin_id, username: s.username, csrf: s.csrf };
}

export function logout(db: DB, token: string | undefined): void {
  if (token) run(db, 'DELETE FROM sessions WHERE id_hash = ?', sha256(token));
}

export function changePassword(db: DB, adminId: number, current: string, next: string): void {
  const a = get(db, 'SELECT * FROM admin WHERE id = ?', adminId);
  if (!a || !verifyPassword(current, a.pw_hash)) throw new Error('現在のパスワードが正しくありません');
  const err = validatePassword(next);
  if (err) throw new Error(err);
  run(db, 'UPDATE admin SET pw_hash = ? WHERE id = ?', hashPassword(next), adminId);
  run(db, 'DELETE FROM sessions WHERE admin_id = ?', adminId);
  audit(db, `admin:${adminId}`, 'password.change');
}
