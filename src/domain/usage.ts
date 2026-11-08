// 処理ごとの利用履歴と、使用サービスの費用一覧
import { type DB, run, nowIso } from '../db.js';

export function logUsage(
  db: DB,
  u: { service: string; operation: string; companyId?: number; jobId?: number; units?: string; costStatus: 'free' | 'unmeasured' | 'measured' | 'plan_quota'; costJpy?: number; detail?: string },
): void {
  run(
    db,
    'INSERT INTO usage_log (service, operation, company_id, job_id, units, cost_status, cost_jpy, detail, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    u.service, u.operation, u.companyId ?? null, u.jobId ?? null, u.units ?? '', u.costStatus, u.costJpy ?? null, (u.detail ?? '').slice(0, 500), nowIso(),
  );
}

export const COST_STATUS_LABELS: Record<string, string> = {
  free: '無料（追加料金なし）',
  unmeasured: '未計測（0円とは限らない）',
  measured: '実測',
  plan_quota: '既存契約の利用枠を消費（金額未計測・無制限ではない）',
};

export interface ServiceEntry {
  name: string;
  purpose: string;
  auth: string;
  freeScope: string;
  paidWhen: string;
  officialUrl: string;
  checkedAt: string;
  status: '使用中' | '未使用（外部条件待ち）' | '開発時のみ';
}

const CHECKED = '2026-11-08';

export const SERVICES: ServiceEntry[] = [
  { name: 'Node.js（node:sqlite 含む）', purpose: '実行環境・ローカルDB', auth: '不要', freeScope: '無料（OSS）', paidWhen: 'なし', officialUrl: 'https://nodejs.org/', checkedAt: CHECKED, status: '使用中' },
  { name: 'Hono / @hono/node-server', purpose: 'Webサーバー', auth: '不要', freeScope: '無料（MIT）', paidWhen: 'なし', officialUrl: 'https://hono.dev/', checkedAt: CHECKED, status: '使用中' },
  { name: 'node-html-parser', purpose: 'HTML解析', auth: '不要', freeScope: '無料（MIT）', paidWhen: 'なし', officialUrl: 'https://github.com/taoqf/node-html-parser', checkedAt: CHECKED, status: '使用中' },
  { name: 'playwright-core + Microsoft Edge / Chrome', purpose: 'スクリーンショット・表示計測', auth: '不要', freeScope: '無料（Apache-2.0）。ブラウザは PC にインストール済みのものを使用', paidWhen: 'なし', officialUrl: 'https://playwright.dev/', checkedAt: CHECKED, status: '使用中' },
  { name: 'Codex CLI（ChatGPT ログイン）', purpose: '営業文の推敲（任意・承認制）', auth: 'ChatGPT アカウントでログイン（codex login）', freeScope: 'ChatGPT の対象プランに含まれる利用枠内。枠には上限があり無制限ではない', paidWhen: 'API キー認証で使う場合は OpenAI API の従量課金。本アプリは API キー利用に自動切替しない', officialUrl: 'https://developers.openai.com/codex/pricing', checkedAt: CHECKED, status: '未使用（外部条件待ち）' },
  { name: 'gBizINFO REST API', purpose: '法人情報の検索（企業発見）', auth: 'API トークン（無料の利用申請）', freeScope: '無料', paidWhen: 'なし（利用規約・出典表示に従う）', officialUrl: 'https://info.gbiz.go.jp/api/index.html', checkedAt: CHECKED, status: '未使用（外部条件待ち）' },
  { name: '法人番号システム Web-API（国税庁）', purpose: '法人番号・商号・所在地の確認', auth: 'アプリケーション ID（無料の届出）', freeScope: '無料', paidWhen: 'なし（利用規約に従う）', officialUrl: 'https://www.houjin-bangou.nta.go.jp/webapi/', checkedAt: CHECKED, status: '未使用（外部条件待ち）' },
  { name: 'Google Places API', purpose: '（不採用）', auth: 'API キー・課金アカウント', freeScope: '—', paidWhen: '従量課金。保存・再利用に制限があり営業リストへの保存用途に適さないため不採用', officialUrl: 'https://developers.google.com/maps/documentation/places/web-service/policies', checkedAt: CHECKED, status: '未使用（外部条件待ち）' },
  { name: 'SMTP / メール送信サービス', purpose: '実送信（未実装）', auth: '要（利用者の送信サーバー）', freeScope: '契約による', paidWhen: '契約による', officialUrl: '—', checkedAt: CHECKED, status: '未使用（外部条件待ち）' },
  { name: '公開ホスティング（Vercel 等）', purpose: '外部閲覧可能なプレビュー（未実装・承認後）', auth: '要', freeScope: '各社の無料枠', paidWhen: '各社の料金体系による', officialUrl: 'https://vercel.com/pricing', checkedAt: CHECKED, status: '未使用（外部条件待ち）' },
  { name: 'Claude Code', purpose: '本アプリの開発作業のみ（完成アプリは依存しない）', auth: '—', freeScope: '—', paidWhen: '—', officialUrl: 'https://claude.com/claude-code', checkedAt: CHECKED, status: '開発時のみ' },
];
