// RFC 5322 / MIME 形式の EML 生成（ヘッダインジェクション対策付き）
import crypto from 'node:crypto';

const enc = (s: string) => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

export function buildEml(m: { from: string; fromName: string; to: string; subject: string; body: string; messageIdDomain: string }): string {
  for (const addr of [m.from, m.to]) {
    if (/[\r\n<>,;]/.test(addr) || !/^[^@\s]+@[^@\s]+$/.test(addr)) throw new Error(`メールアドレスが不正です: ${addr}`);
  }
  const body64 = Buffer.from(m.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return [
    `From: ${enc(clean(m.fromName))} <${m.from}>`,
    `To: ${m.to}`,
    `Subject: ${enc(clean(m.subject))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${clean(m.messageIdDomain)}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    'X-Mock-First-Sales: simulated',
    '',
    body64,
    '',
  ].join('\r\n');
}
