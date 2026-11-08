// 管理画面の共通レイアウト（日本語）
import { html, raw, type SafeHtml, esc } from '../util/html.js';
import type { Session } from '../auth.js';
import { STATUS_LABELS } from '../domain/companies.js';

const NAV: [string, string, string][] = [
  ['/admin', 'ダッシュボード', 'home'],
  ['/admin/search', '検索条件設定', 'search'],
  ['/admin/companies', '候補企業一覧', 'companies'],
  ['/admin/import', 'CSV 取込・出力', 'import'],
  ['/admin/approvals', '送信承認キュー', 'approvals'],
  ['/admin/sends', '送信履歴', 'sends'],
  ['/admin/deals', '返信・商談・受注', 'deals'],
  ['/admin/analytics', '営業成果分析', 'analytics'],
  ['/admin/jobs', 'ジョブ・エラー', 'jobs'],
  ['/admin/costs', 'API利用・コスト', 'costs'],
  ['/admin/suppressions', '配信停止管理', 'suppressions'],
  ['/admin/settings', '送信者情報・連携設定', 'settings'],
  ['/admin/status', '実装状況', 'status'],
];

export const CSS = `
:root{--bg:#f5f6f8;--fg:#1f2933;--mute:#616e7c;--line:#e1e4e8;--p:#2563eb;--ok:#047857;--ng:#b91c1c;--warn:#b45309}
*{box-sizing:border-box}body{margin:0;font-family:"Yu Gothic UI","Hiragino Sans","Meiryo",system-ui,sans-serif;background:var(--bg);color:var(--fg);font-size:14px;line-height:1.6}
a{color:var(--p)}.shell{display:grid;grid-template-columns:220px 1fr;min-height:100vh}
aside{background:#111827;color:#d1d5db;padding:16px 0}aside .brand{padding:0 18px 14px;font-weight:700;color:#fff;font-size:15px;border-bottom:1px solid #1f2937;margin-bottom:8px}
aside .brand small{display:block;font-weight:400;color:#9ca3af;font-size:11px}
aside a{display:block;padding:8px 18px;color:#d1d5db;text-decoration:none}aside a.on,aside a:hover{background:#1f2937;color:#fff}
main{padding:22px 28px;max-width:1400px}h1{font-size:21px;margin:0 0 14px}h2{font-size:16px;margin:22px 0 10px}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;color:var(--mute);font-size:12px}
.card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;background:#fff}th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:#f9fafb;font-weight:600;font-size:12px;color:#374151;white-space:nowrap}
.btn,button{display:inline-block;white-space:nowrap;background:var(--p);color:#fff;border:0;border-radius:6px;padding:7px 14px;font:inherit;cursor:pointer;text-decoration:none}
.btn.sec,button.sec{background:#fff;color:var(--fg);border:1px solid #cbd2d9}.btn.ng,button.ng{background:var(--ng)}.btn.ok,button.ok{background:var(--ok)}
button:disabled{background:#9ca3af;cursor:not-allowed}
input,select,textarea{font:inherit;padding:7px 9px;border:1px solid #cbd2d9;border-radius:6px;background:#fff;max-width:100%}
textarea{width:100%}label{display:block;margin:8px 0 3px;font-weight:600;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.flash{padding:10px 14px;border-radius:8px;margin-bottom:14px}.flash.ok{background:#ecfdf5;color:var(--ok);border:1px solid #a7f3d0}.flash.err{background:#fef2f2;color:var(--ng);border:1px solid #fecaca}
.badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;background:#eef2ff;color:#3730a3;white-space:nowrap}
.badge.ok{background:#ecfdf5;color:var(--ok)}.badge.ng{background:#fef2f2;color:var(--ng)}.badge.warn{background:#fffbeb;color:var(--warn)}.badge.mute{background:#f3f4f6;color:#4b5563}
.src-rule{background:#e0f2fe;color:#075985}.src-template{background:#f3e8ff;color:#6b21a8}.src-ai{background:#fff7ed;color:#9a3412}
.mute{color:var(--mute)}.small{font-size:12px}pre{white-space:pre-wrap;background:#f9fafb;border:1px solid var(--line);border-radius:8px;padding:12px;font-family:inherit;margin:0}
.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}.kpi div{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px}
.kpi b{display:block;font-size:22px}.shots{display:grid;grid-template-columns:2fr 1fr;gap:12px}.shots img{width:100%;border:1px solid var(--line);border-radius:6px}
.cmp{display:grid;grid-template-columns:1fr 1fr;gap:14px}.cmp iframe{width:100%;height:640px;border:1px solid var(--line);border-radius:8px;background:#fff}
.frame-sp{width:390px!important;height:720px!important}
.next{border-left:4px solid var(--p);background:#eff6ff;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:14px}
.inline{display:inline}.right{text-align:right}
@media (max-width:900px){.shell{grid-template-columns:1fr}aside{display:none}.cmp,.shots{grid-template-columns:1fr}}
`;

export function page(title: string, active: string, s: Session | null, content: SafeHtml, flash?: { ok?: string; err?: string }, opts: { refresh?: number } = {}): string {
  const nav = NAV.map(([href, label, key]) => html`<a href="${href}" class="${key === active ? 'on' : ''}">${label}</a>`);
  return html`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">${opts.refresh ? raw(`<meta http-equiv="refresh" content="${Number(opts.refresh)}">`) : ''}
<title>${title}｜モック先出し営業</title><link rel="stylesheet" href="/static/admin.css"></head><body>
<div class="shell"><aside><div class="brand">モック先出し営業<small>ローカル管理画面</small></div>${nav}
${s ? html`<form method="post" action="/logout" style="padding:12px 18px"><input type="hidden" name="_csrf" value="${s.csrf}"><button class="sec" type="submit">ログアウト（${s.username}）</button></form>` : ''}</aside>
<main>${flash?.ok ? html`<div class="flash ok" role="status">${flash.ok}</div>` : ''}${flash?.err ? html`<div class="flash err" role="alert">${flash.err}</div>` : ''}
${content}</main></div></body></html>`.value;
}

export function bare(title: string, content: SafeHtml, err?: string): string {
  return html`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${title}</title><link rel="stylesheet" href="/static/admin.css"></head><body><main style="max-width:520px;margin:60px auto">
<h1>${title}</h1>${err ? html`<div class="flash err" role="alert">${err}</div>` : ''}${content}</main></body></html>`.value;
}

export function statusBadge(st: string): SafeHtml {
  const cls = st === 'excluded' || st === 'lost' ? 'ng' : st === 'won' || st === 'sent' ? 'ok' : st === 'awaiting_approval' ? 'warn' : '';
  return html`<span class="badge ${cls}">${STATUS_LABELS[st] ?? st}</span>`;
}

export function csrfField(s: Session): SafeHtml {
  return html`<input type="hidden" name="_csrf" value="${s.csrf}">`;
}

export function postButton(s: Session, action: string, label: string, cls = '', extra: Record<string, string | number> = {}): SafeHtml {
  return html`<form method="post" action="${action}" class="inline">${csrfField(s)}${Object.entries(extra).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}<button class="${cls}" type="submit">${label}</button></form>`;
}

export function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
