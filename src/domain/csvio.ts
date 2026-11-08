// CSV 取込・出力（外部データからの企業発見とは別機能）
import { type DB, all } from '../db.js';
import { parseCsv, toCsv, looksLikeFormula } from '../util/csv.js';
import { upsertCompany } from './companies.js';
import { STATUS_LABELS, SITE_STATUS_LABELS } from './companies.js';
import { ELIGIBILITY_LABELS } from './eligibility.js';

export const CSV_COLUMNS = ['企業名', '都道府県', '市区町村', '業種', '公式サイトURL', '問い合わせURL', 'メールアドレス', '情報源名', '情報源URL', '利用許諾・再利用条件', '架空データ', 'メモ'] as const;

const ALIASES: Record<string, (typeof CSV_COLUMNS)[number]> = {
  name: '企業名', company: '企業名', 会社名: '企業名',
  prefecture: '都道府県', city: '市区町村', industry: '業種',
  url: '公式サイトURL', website: '公式サイトURL', website_url: '公式サイトURL', 'URL': '公式サイトURL',
  contact_url: '問い合わせURL', email: 'メールアドレス', mail: 'メールアドレス',
  source: '情報源名', source_url: '情報源URL', license: '利用許諾・再利用条件', fictional: '架空データ', memo: 'メモ',
};

export interface ImportReport {
  total: number;
  created: number;
  merged: number;
  excludedNoSite: number;
  errors: { line: number; message: string }[];
}

export function importCsv(db: DB, text: string, opts: { defaultLicense: string; actor: string }): ImportReport {
  const rows = parseCsv(text);
  const report: ImportReport = { total: 0, created: 0, merged: 0, excludedNoSite: 0, errors: [] };
  if (!rows.length) return report;
  const header = rows[0].map((h) => {
    const t = h.trim();
    return (CSV_COLUMNS as readonly string[]).includes(t) ? t : ALIASES[t] ?? ALIASES[t.toLowerCase()] ?? t;
  });
  if (!header.includes('企業名')) {
    report.errors.push({ line: 1, message: 'ヘッダー行に「企業名」列がありません' });
    return report;
  }
  rows.slice(1, 5001).forEach((r, i) => {
    const line = i + 2;
    const rec: Record<string, string> = {};
    header.forEach((h, j) => (rec[h] = (r[j] ?? '').trim()));
    if (!Object.values(rec).some(Boolean)) return;
    report.total++;
    const risky = (['企業名', '公式サイトURL', 'メールアドレス', '問い合わせURL'] as const).find((k) => rec[k] && looksLikeFormula(rec[k]));
    if (risky) {
      report.errors.push({ line, message: `「${risky}」が数式のように見える値のため取り込みません（CSV数式インジェクション対策）` });
      return;
    }
    const license = rec['利用許諾・再利用条件'] || opts.defaultLicense;
    if (!license) {
      report.errors.push({ line, message: '利用許諾・再利用条件が未記入です' });
      return;
    }
    const res = upsertCompany(db, {
      name: rec['企業名'],
      prefecture: rec['都道府県'],
      city: rec['市区町村'],
      industry: rec['業種'],
      website_url: rec['公式サイトURL'],
      contact_url: rec['問い合わせURL'],
      email: rec['メールアドレス'],
      source_name: rec['情報源名'] || 'ユーザー提供CSV',
      source_url: rec['情報源URL'],
      source_license: license,
      is_fictional: /^(1|true|yes|はい|架空)$/i.test(rec['架空データ'] || ''),
      memo: (rec['メモ'] || '').replace(/^[=+\-@]/, "'"),
    }, opts.actor);
    if (res.action === 'created') report.created++;
    else if (res.action === 'merged') report.merged++;
    else if (res.action === 'excluded_no_site') report.excludedNoSite++;
    else report.errors.push({ line, message: res.reason ?? '取込失敗' });
  });
  return report;
}

export function exportCsv(db: DB): string {
  const rows = all(db, 'SELECT * FROM companies WHERE merged_into IS NULL ORDER BY id');
  const head = ['企業ID', ...CSV_COLUMNS, '公式サイト確認状態', '確認根拠', '営業可否', '判断根拠', '配信停止', '処理状況', '取得日時'];
  return toCsv([
    head,
    ...rows.map((c) => [
      c.public_id, c.name, c.prefecture, c.city, c.industry, c.website_url, c.contact_url, c.email, c.source_name, c.source_url, c.source_license,
      c.is_fictional ? '架空' : '', c.memo, SITE_STATUS_LABELS[c.site_status] ?? c.site_status, c.site_evidence,
      ELIGIBILITY_LABELS[c.eligibility] ?? c.eligibility, c.eligibility_basis, c.opt_out ? '停止' : '', STATUS_LABELS[c.status] ?? c.status, c.fetched_at,
    ]),
  ]);
}
