// gBizINFO REST API（v2）からの企業候補発見。トークン未設定時は使用しない（外部条件待ち）。
// - 公式サイト URL が含まれない場合は「URL 未登録」として除外し、推測 URL を確定しない
// - 出典（gBizINFO）と利用条件をレコードに記録する
// ※ 実 API での動作は未検証（トークン未取得のため）。レスポンス項目は防御的に扱う。
import { type DB } from '../db.js';
import { upsertCompany } from '../domain/companies.js';
import { PREFECTURES } from '../util/normalize.js';
import { getSecret } from '../secrets.js';
import { logUsage } from '../domain/usage.js';
import type { SearchCriteria } from '../domain/search.js';

export const GBIZ_BASE = 'https://api.info.gbiz.go.jp/hojin';
export const GBIZ_LICENSE = 'gBizINFO 利用規約に基づく公開情報（出典: gBizINFO（経済産業省）を表示すること）';

export function prefectureCode(name: string): string {
  const i = PREFECTURES.indexOf(name);
  return i >= 0 ? String(i + 1).padStart(2, '0') : '';
}

export function hasGbizToken(dataDir: string): boolean {
  return !!getSecret(dataDir, 'gbizinfoToken');
}

export interface DiscoverResult {
  fetched: number;
  created: number;
  merged: number;
  excludedNoSite: number;
  errors: string[];
}

export async function discoverFromGbiz(db: DB, dataDir: string, c: SearchCriteria, fetchImpl: typeof fetch = fetch): Promise<DiscoverResult> {
  const token = getSecret(dataDir, 'gbizinfoToken');
  if (!token) throw new Error('gBizINFO の API トークンが未設定です（送信者情報・連携設定で登録）');
  const params = new URLSearchParams();
  if (c.keyword) params.set('name', c.keyword);
  const pc = prefectureCode(c.prefecture);
  if (pc) params.set('prefecture', pc);
  if (c.city) params.set('city', c.city);
  if (c.industry) params.set('business_item', c.industry);
  params.set('limit', String(Math.min(c.maxCandidates, 100)));
  const res = await fetchImpl(`${GBIZ_BASE}/v2/hojin?${params}`, { headers: { 'X-hojinInfo-api-token': token, accept: 'application/json' } });
  logUsage(db, { service: 'gBizINFO', operation: 'search', units: '1 request', costStatus: 'free', detail: `HTTP ${res.status}` });
  if (res.status === 429) throw new Error('gBizINFO: アクセス過多（429）。時間をおいて再実行してください');
  if (!res.ok) throw new Error(`gBizINFO: HTTP ${res.status}`);
  const json: any = await res.json();
  const list: any[] = json?.['hojin-infos'] ?? json?.hojin_infos ?? json?.items ?? [];
  const out: DiscoverResult = { fetched: list.length, created: 0, merged: 0, excludedNoSite: 0, errors: [] };
  for (const h of list.slice(0, c.maxCandidates)) {
    const url = typeof h.company_url === 'string' ? h.company_url : '';
    const r = upsertCompany(db, {
      name: String(h.name ?? ''),
      prefecture: c.prefecture,
      city: String(h.location ?? '').replace(c.prefecture, '').match(/^(.+?[市区町村])/)?.[1] ?? c.city,
      industry: c.industry,
      website_url: url,
      source_name: 'gBizINFO',
      source_url: h.corporate_number ? `https://info.gbiz.go.jp/hojin/ichiran?hojinBango=${encodeURIComponent(h.corporate_number)}` : GBIZ_BASE,
      source_license: GBIZ_LICENSE,
      memo: url ? 'URL は情報源記載（公式性は分析時に確認）' : '情報源に公式サイトURLの記載なし。公式サイトを確認できた場合のみ手動で登録してください',
    }, 'gbizinfo');
    if (r.action === 'created') out.created++;
    else if (r.action === 'merged') out.merged++;
    else if (r.action === 'excluded_no_site') out.excludedNoSite++;
    else if (r.reason) out.errors.push(r.reason);
  }
  return out;
}
