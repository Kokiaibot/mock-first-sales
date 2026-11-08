// 企業名・URL・メールの正規化（重複検出用）

const CORP_FORMS = [
  '株式会社', '有限会社', '合同会社', '合資会社', '合名会社', '一般社団法人', '一般財団法人',
  '公益社団法人', '公益財団法人', '医療法人社団', '医療法人財団', '医療法人', '社会福祉法人',
  '税理士法人', '弁護士法人', '司法書士法人', '行政書士法人', '特定非営利活動法人', 'NPO法人',
  '(株)', '（株）', '㈱', '(有)', '（有）', '㈲',
];

export function normalizeCompanyName(name: string): string {
  let s = (name || '').normalize('NFKC').trim();
  for (const f of CORP_FORMS) s = s.split(f.normalize('NFKC')).join('');
  return s.replace(/[\s・･\-‐ー－.,，、。'"「」]/g, '').toLowerCase();
}

/** URL を正規化。不正なら null。http(s) のみ許可。 */
export function normalizeUrl(input: string): string | null {
  const s = (input || '').trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!u.hostname.includes('.')) return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  return u.toString();
}

/** 重複判定用の登録ドメイン（www. を除去） */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
export function normalizeEmail(e: string): string | null {
  const s = (e || '').normalize('NFKC').trim().toLowerCase();
  if (!s) return null;
  return EMAIL_RE.test(s) && !/[\r\n]/.test(s) ? s : null;
}

export function emailDomain(e: string): string {
  return (e.split('@')[1] || '').toLowerCase();
}

/** 厳格な日時パース（ISO 8601 のみ、不正なら null） */
export function parseStrictDate(s: string): Date | null {
  if (typeof s !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(s.trim())) return null;
  const d = new Date(s.trim());
  if (Number.isNaN(d.getTime())) return null;
  // 2026-02-31 のような繰り上がりを拒否
  const [y, m, day] = s.slice(0, 10).split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, day));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== day) return null;
  if (y < 2000 || y > 2100) return null;
  return d;
}

export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県',
  '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県',
  '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];
