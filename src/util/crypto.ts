import crypto from 'node:crypto';

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** 閲覧コード: 紛らわしい文字を除いた 8 文字 */
export function randomViewCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = crypto.randomBytes(8);
  let s = '';
  for (const b of buf) s += alphabet[b % alphabet.length];
  return s;
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v as object).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify((v as any)[k])).join(',') + '}';
}

export function hashObject(v: unknown): string {
  return sha256(stableStringify(v));
}

// パスワード: scrypt（Node 標準、ネイティブ依存なし）
const SCRYPT_N = 16384;
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32, { N: SCRYPT_N, r: 8, p: 1 });
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, n, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const key = crypto.scryptSync(pw, Buffer.from(saltB64, 'base64'), 32, { N: Number(n), r: 8, p: 1 });
  const expected = Buffer.from(keyB64, 'base64');
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

export function hmac(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
