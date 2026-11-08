// 検索条件（保存・再表示）
import { type DB, all, get, run, nowIso, type Row } from '../db.js';
import { clampInt, PREFECTURES } from '../util/normalize.js';
import { LIMITS } from '../config.js';

export interface SearchCriteria {
  prefecture: string;
  city: string;
  industry: string;
  keyword: string;
  maxCandidates: number;
  requireContact: 'any' | 'email' | 'form' | 'either';
  improvementRoom: 'any' | 'some' | 'many';
  excludeContacted: boolean;
}

export const DEFAULT_CRITERIA: SearchCriteria = {
  prefecture: '', city: '', industry: '', keyword: '', maxCandidates: 50, requireContact: 'either', improvementRoom: 'any', excludeContacted: true,
};

export function parseCriteria(form: Record<string, string>): SearchCriteria {
  const pref = PREFECTURES.includes(form.prefecture) ? form.prefecture : '';
  const pick = <T extends string>(v: string, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
  return {
    prefecture: pref,
    city: (form.city || '').trim().slice(0, 50),
    industry: (form.industry || '').trim().slice(0, 50),
    keyword: (form.keyword || '').trim().slice(0, 100),
    maxCandidates: clampInt(form.maxCandidates, 1, LIMITS.maxCandidatesPerSearch, 50),
    requireContact: pick(form.requireContact, ['any', 'email', 'form', 'either'] as const, 'either'),
    improvementRoom: pick(form.improvementRoom, ['any', 'some', 'many'] as const, 'any'),
    excludeContacted: form.excludeContacted === 'on' || form.excludeContacted === '1',
  };
}

export function saveProfile(db: DB, id: number | null, name: string, c: SearchCriteria): number {
  const n = name.trim().slice(0, 80) || '無題の条件';
  if (id) {
    run(db, 'UPDATE search_profiles SET name = ?, criteria = ?, updated_at = ? WHERE id = ?', n, JSON.stringify(c), nowIso(), id);
    return id;
  }
  return Number(run(db, 'INSERT INTO search_profiles (name, criteria, created_at, updated_at) VALUES (?,?,?,?)', n, JSON.stringify(c), nowIso(), nowIso()).lastInsertRowid);
}

export function listProfiles(db: DB): (Row & { c: SearchCriteria })[] {
  return all(db, 'SELECT * FROM search_profiles ORDER BY id DESC').map((r) => ({ ...r, c: { ...DEFAULT_CRITERIA, ...JSON.parse(r.criteria) } }));
}

export function getProfile(db: DB, id: number): (Row & { c: SearchCriteria }) | undefined {
  const r = get(db, 'SELECT * FROM search_profiles WHERE id = ?', id);
  return r ? { ...r, c: { ...DEFAULT_CRITERIA, ...JSON.parse(r.criteria) } } : undefined;
}

/** 登録済み候補に検索条件を適用（ローカル絞り込み） */
export function applyCriteria(db: DB, c: SearchCriteria): Row[] {
  const where = ["merged_into IS NULL", "site_status != 'no_site'"];
  const p: any[] = [];
  if (c.prefecture) (where.push('prefecture = ?'), p.push(c.prefecture));
  if (c.city) (where.push('city LIKE ?'), p.push(`%${c.city}%`));
  if (c.industry) (where.push('industry LIKE ?'), p.push(`%${c.industry}%`));
  if (c.keyword) (where.push('(name LIKE ? OR memo LIKE ?)'), p.push(`%${c.keyword}%`, `%${c.keyword}%`));
  if (c.requireContact === 'email') where.push("email != ''");
  if (c.requireContact === 'form') where.push("contact_url != ''");
  if (c.requireContact === 'either') where.push("(email != '' OR contact_url != '' OR status = 'new')");
  if (c.excludeContacted) where.push("id NOT IN (SELECT company_id FROM sends WHERE status IN ('sent','unknown','sending'))");
  let rows = all(db, `SELECT * FROM companies WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`, ...p, c.maxCandidates);
  if (c.improvementRoom !== 'any') {
    const min = c.improvementRoom === 'many' ? 4 : 2;
    rows = rows.filter((r) => {
      const a = get(db, "SELECT COUNT(*) n FROM findings f JOIN analyses a ON a.id = f.analysis_id WHERE a.company_id = ? AND f.status = 'issue' AND a.id = (SELECT MAX(id) FROM analyses WHERE company_id = ?)", r.id, r.id);
      return r.status === 'new' || (a?.n ?? 0) >= min;
    });
  }
  return rows;
}
