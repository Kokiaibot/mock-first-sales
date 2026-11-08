// 企業サイト分析の実行（サイト確認 → 複数ページ取得 → 撮影 → ルール評価 → 保存）
import path from 'node:path';
import { type DB, get, run, tx, nowIso, all, type Row } from '../db.js';
import type { AppConfig } from '../config.js';
import { safeFetch, isAllowedByRobots, RetryAfterError, AccessDeniedError, BlockedUrlError, type FetchResult } from '../net/fetcher.js';
import { extractFacts, type PageFacts } from './extract.js';
import { capturePage, browserUnavailableReason, type Capture } from './browser.js';
import { evaluate } from './rules.js';
import { assessFromPages, saveAutoAssessment } from '../domain/eligibility.js';
import { advanceStatus, getCompany } from '../domain/companies.js';
import { normalizeCompanyName, domainOf } from '../util/normalize.js';
import { hashObject, randomToken, sha256 } from '../util/crypto.js';
import { logUsage } from '../domain/usage.js';

export class PermanentError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'PermanentError';
  }
}

const MAX_PAGES = 5;

export interface AnalyzeOutcome {
  analysisId: number | null;
  reused: boolean;
  siteStatus: string;
  message: string;
}

export async function analyzeCompany(db: DB, cfg: AppConfig, companyId: number, jobId?: number): Promise<AnalyzeOutcome> {
  const c = getCompany(db, companyId);
  if (!c) throw new PermanentError('企業が見つかりません');
  if (!c.website_url) {
    run(db, "UPDATE companies SET site_status = 'no_site', status = 'excluded', updated_at = ? WHERE id = ?", nowIso(), companyId);
    return { analysisId: null, reused: false, siteStatus: 'no_site', message: '公式サイトURLがないため除外しました' };
  }
  const fopts = { fixturesDir: cfg.fixturesDir };

  // 1) サイトの存在・応答確認
  let top: FetchResult;
  try {
    if (!(await isAllowedByRobots(c.website_url, fopts))) {
      setSite(db, companyId, 'blocked', 'robots.txt でクロールが許可されていません');
      return { analysisId: null, reused: false, siteStatus: 'blocked', message: 'robots.txt により取得対象外' };
    }
    top = await safeFetch(c.website_url, fopts);
  } catch (e) {
    if (e instanceof RetryAfterError) throw e; // ジョブ側で Retry-After を尊重して再試行
    if (e instanceof BlockedUrlError) {
      setSite(db, companyId, 'blocked', e.message);
      throw new PermanentError(`取得禁止: ${e.message}`);
    }
    if (e instanceof AccessDeniedError) {
      setSite(db, companyId, 'unreachable', e.message);
      throw new PermanentError(e.message);
    }
    setSite(db, companyId, 'unreachable', `取得失敗: ${(e as Error).message}`);
    throw e; // 一時的なネットワーク障害は再試行
  }
  if (top.status >= 400) {
    setSite(db, companyId, 'unreachable', `HTTP ${top.status}`);
    throw new PermanentError(`サイトが HTTP ${top.status} を返しました`);
  }
  logUsage(db, { service: top.fixture ? 'fixture-site' : 'http-fetch', operation: 'fetch-top', companyId, jobId, units: '1 request', costStatus: 'free', detail: top.finalUrl });

  // 公式性: 最終 URL のドメインが登録ドメインと一致し、かつページに企業名が含まれる場合のみ確認済み
  const finalDomain = domainOf(top.finalUrl);
  const topFacts = extractFacts(top.finalUrl, top.text);
  const nameHit = normalizeCompanyName(topFacts.text + topFacts.title).includes(normalizeCompanyName(c.name).slice(0, 6));
  const official = finalDomain === c.website_domain && nameHit;
  if (official || c.site_evidence.startsWith('利用者が公式サイトとして確認済み')) {
    setSite(db, companyId, 'ok', official ? `HTTP ${top.status}・ドメイン一致・ページ内に企業名を確認（${top.finalUrl}）` : c.site_evidence);
  } else {
    setSite(db, companyId, 'ok_unverified_official', `HTTP ${top.status} 応答あり。${finalDomain !== c.website_domain ? `リダイレクト先ドメインが異なる（${finalDomain}）` : 'ページ内に企業名を確認できない'}。企業詳細で公式サイトか確認してください`);
  }

  // 2) 同一ドメインの関連ページ（問い合わせ・会社概要・サービス）を最大 MAX_PAGES まで取得
  const pagesRaw: { url: string; text: string }[] = [{ url: top.finalUrl, text: top.text }];
  const pages: PageFacts[] = [topFacts];
  const candidates = pickSubpages(topFacts, finalDomain);
  for (const sub of candidates) {
    if (pages.length >= MAX_PAGES) break;
    try {
      if (!(await isAllowedByRobots(sub, fopts))) continue;
      const r = await safeFetch(sub, fopts);
      if (r.status !== 200 || domainOf(r.finalUrl) !== finalDomain) continue;
      pages.push(extractFacts(r.finalUrl, r.text));
      pagesRaw.push({ url: r.finalUrl, text: r.text });
    } catch (e) {
      if (e instanceof RetryAfterError) throw e;
    }
  }

  const inputHash = hashObject({ url: c.website_url, pages: pagesRaw.map((p) => [p.url, sha256(p.text)]), v: 1 });
  const existing = get(db, 'SELECT id FROM analyses WHERE company_id = ? AND input_hash = ?', companyId, inputHash);
  if (existing) {
    advanceStatus(db, companyId, 'analyzed');
    return { analysisId: existing.id, reused: true, siteStatus: 'ok', message: '同一内容の分析結果を再利用しました' };
  }

  // 3) 撮影（PC / スマートフォン）
  const shotDir = path.join(cfg.dataDir, 'screenshots');
  let pc: Capture | null = null;
  let sp: Capture | null = null;
  let captureNote = '';
  try {
    pc = await capturePage(top.finalUrl, 'pc', shotDir, `${randomToken(12)}.png`, cfg.fixturesDir);
    sp = await capturePage(top.finalUrl, 'sp', shotDir, `${randomToken(12)}.png`, cfg.fixturesDir);
    if (!pc) captureNote = `ブラウザ未接続のため撮影未実施: ${browserUnavailableReason()}`;
  } catch (e) {
    captureNote = `撮影失敗: ${(e as Error).message.split('\n')[0]}`;
  }

  // 4) 連絡先の補完（推測しない：ページ上に実在する値のみ）
  const contactPage = pages.find((p) => p !== topFacts && /(contact|inquiry|toiawase|お問い?合)/i.test(p.url + p.title));
  const emailsOnSite = [...new Set(pages.flatMap((p) => p.emails))].filter((e) => e.endsWith('@' + finalDomain) || e.endsWith('.' + finalDomain));

  const findings = evaluate({ top: topFacts, pages, pc, sp });
  const assessment = assessFromPages(pagesRaw.map((p) => ({ url: p.url, text: extractFacts(p.url, p.text).text })), c.email || emailsOnSite[0] || '');

  const analysisId = tx(db, () => {
    const now = nowIso();
    const r = run(
      db,
      'INSERT INTO analyses (company_id, input_hash, method, fetch_status, page_facts, measurements, brand_colors, created_at) VALUES (?,?,?,?,?,?,?,?)',
      companyId,
      inputHash,
      'rule',
      top.fixture ? 'fixture' : 'live',
      JSON.stringify(pages.map(({ text, links, ...rest }) => ({ ...rest, textExcerpt: text.slice(0, 1500) }))),
      JSON.stringify({ pc: pc?.metrics ?? null, sp: sp?.metrics ?? null, captureNote, lighthouse: null }),
      JSON.stringify(topFacts.colors),
      now,
    );
    const aid = Number(r.lastInsertRowid);
    const shotIds: Record<string, number> = {};
    for (const cap of [pc, sp]) {
      if (!cap) continue;
      const s = run(db, 'INSERT INTO screenshots (company_id, kind, file_name, source_url, width, created_at) VALUES (?,?,?,?,?,?)', companyId, cap.kind, cap.file, top.finalUrl, cap.width, now);
      shotIds[cap.kind] = Number(s.lastInsertRowid);
    }
    for (const fd of findings) {
      run(
        db,
        'INSERT INTO findings (analysis_id, category, status, fact, issue_points, suggestion, suggestion_source, evidence_url, screenshot_id, policy, checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        aid, fd.category, fd.status, fd.fact, JSON.stringify(fd.issuePoints), fd.suggestion, fd.suggestionSource, fd.evidenceUrl, fd.screenshotKind ? shotIds[fd.screenshotKind] ?? null : null, fd.policy, now,
      );
    }
    const updates: string[] = [];
    const params: any[] = [];
    if (!c.contact_url && contactPage) {
      updates.push('contact_url = ?');
      params.push(contactPage.url);
    }
    if (!c.email && emailsOnSite.length) {
      // 営業窓口の案内があればそのアドレスを優先
      const desk = assessment.salesDesk?.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/)?.[0]?.toLowerCase();
      const chosen = desk && emailsOnSite.includes(desk) ? desk : emailsOnSite[0];
      const src = pagesRaw.find((p) => p.text.toLowerCase().includes(chosen));
      updates.push('email = ?', 'email_evidence_url = ?');
      params.push(chosen, src?.url ?? '');
    }
    if (updates.length) run(db, `UPDATE companies SET ${updates.join(', ')}, version = version + 1, updated_at = ? WHERE id = ?`, ...params, now, companyId);
    return aid;
  });
  saveAutoAssessment(db, companyId, assessment);
  const after = getCompany(db, companyId)!;
  if (after.status !== 'excluded') advanceStatus(db, companyId, 'analyzed');
  return { analysisId, reused: false, siteStatus: after.site_status, message: `${pages.length} ページを分析しました${captureNote ? '（' + captureNote + '）' : ''}` };
}

function setSite(db: DB, id: number, status: string, evidence: string) {
  run(db, 'UPDATE companies SET site_status = ?, site_evidence = ?, site_checked_at = ?, updated_at = ? WHERE id = ?', status, evidence.slice(0, 500), nowIso(), nowIso(), id);
}

function pickSubpages(top: PageFacts, domain: string): string[] {
  const score = (href: string, text: string) => {
    const s = href + ' ' + text;
    if (/(contact|inquiry|お問い?合|予約)/i.test(s)) return 3;
    if (/(company|about|会社概要|医院案内|事務所案内|アクセス)/i.test(s)) return 2;
    if (/(service|business|業務|事業|診療|works|施工|実績)/i.test(s)) return 1;
    return 0;
  };
  const seen = new Set<string>([top.url.replace(/#.*$/, '')]);
  return top.links
    .filter((l) => /^https?:/.test(l.href) && domainOf(l.href) === domain)
    .map((l) => ({ href: l.href.replace(/#.*$/, ''), s: score(l.href, l.text) }))
    .filter((l) => l.s > 0 && !seen.has(l.href) && (seen.add(l.href), true))
    .sort((a, b) => b.s - a.s)
    .map((l) => l.href)
    .slice(0, MAX_PAGES * 2);
}

export function latestAnalysis(db: DB, companyId: number): Row | undefined {
  return get(db, 'SELECT * FROM analyses WHERE company_id = ? ORDER BY id DESC LIMIT 1', companyId);
}
export function findingsOf(db: DB, analysisId: number): Row[] {
  return all(db, 'SELECT * FROM findings WHERE analysis_id = ? ORDER BY category', analysisId);
}
