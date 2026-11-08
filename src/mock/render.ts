// モックの HTML 生成。外部リソースを一切読み込まない自己完結 HTML。
import { esc, safeColor } from '../util/html.js';
import type { MockSpec } from './spec.js';

export type MockPage = 'index' | 'services' | 'contact' | 'thanks';
export const MOCK_PAGES: MockPage[] = ['index', 'services', 'contact'];

export interface RenderOpts {
  /** ページ間リンクの基点（例: /p/<token>/ や /admin/mocks/1/view/） */
  base: string;
  /** 管理者プレビューか顧客プレビューか */
  audience: 'admin' | 'client';
  expiresAt?: string;
}

const ICONS = [
  '<path d="M12 3 3 10v10h6v-6h6v6h6V10z"/>',
  '<path d="M4 20h16M6 16l8-8 4 4-8 8H6z"/>',
  '<circle cx="12" cy="12" r="8"/><path d="M8 12l3 3 5-6"/>',
  '<path d="M4 6h16v12H4z"/><path d="M4 8l8 5 8-5"/>',
  '<path d="M12 3v18M3 12h18"/>',
  '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9z"/>',
];

function icon(i: number): string {
  return `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">${ICONS[i % ICONS.length]}</svg>`;
}

function heroArt(spec: MockSpec): string {
  const p = safeColor(spec.palette.primary), a = safeColor(spec.palette.accent), t = safeColor(spec.palette.tint);
  // 業種ごとに異なる独自図形（写真の代替）
  const shapes: Record<string, string> = {
    construction: `<polygon points="60,250 200,120 340,250" fill="${p}" opacity=".9"/><rect x="95" y="250" width="210" height="120" fill="${p}" opacity=".75"/><rect x="175" y="290" width="50" height="80" fill="${t}"/><rect x="115" y="270" width="40" height="34" fill="${t}"/><rect x="245" y="270" width="40" height="34" fill="${t}"/><circle cx="330" cy="100" r="36" fill="${a}" opacity=".7"/>`,
    dental: `<circle cx="200" cy="210" r="150" fill="${t}"/><path d="M140 140c20-25 50-20 60-5 10-15 40-20 60 5 22 28 5 75-5 110-6 22-10 60-25 60-12 0-14-45-30-45s-18 45-30 45c-15 0-19-38-25-60-10-35-27-82-5-110z" fill="#fff" stroke="${p}" stroke-width="6"/><circle cx="315" cy="95" r="22" fill="${a}" opacity=".6"/>`,
    professional: `<rect x="70" y="90" width="260" height="250" rx="14" fill="${t}"/><rect x="100" y="130" width="200" height="18" rx="9" fill="${p}"/><rect x="100" y="170" width="150" height="12" rx="6" fill="${p}" opacity=".5"/><rect x="100" y="200" width="170" height="12" rx="6" fill="${p}" opacity=".5"/><rect x="100" y="250" width="40" height="60" fill="${a}"/><rect x="150" y="225" width="40" height="85" fill="${p}"/><rect x="200" y="200" width="40" height="110" fill="${a}" opacity=".7"/>`,
    manufacturing: `<circle cx="200" cy="210" r="110" fill="none" stroke="${p}" stroke-width="26" stroke-dasharray="40 18"/><circle cx="200" cy="210" r="48" fill="${a}" opacity=".8"/><circle cx="320" cy="110" r="40" fill="none" stroke="${p}" stroke-width="12" stroke-dasharray="16 10"/>`,
    general: `<circle cx="200" cy="200" r="140" fill="${t}"/><rect x="120" y="140" width="160" height="120" rx="20" fill="${p}"/><circle cx="300" cy="110" r="30" fill="${a}"/>`,
  };
  return `<svg class="art" viewBox="0 0 400 400" role="img" aria-label="装飾図形（写真差し替え予定枠）">${shapes[spec.industry] ?? shapes.general}</svg>`;
}

function css(spec: MockSpec): string {
  const p = safeColor(spec.palette.primary), pd = safeColor(spec.palette.primaryDark), a = safeColor(spec.palette.accent), t = safeColor(spec.palette.tint);
  return `
:root{--p:${p};--pd:${pd};--a:${a};--t:${t};--ink:#1f2933;--mute:#52606d;--line:#e4e7eb}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo",system-ui,sans-serif;color:var(--ink);line-height:1.8;font-size:16px;background:#fff}
a{color:var(--p)}img,svg{max-width:100%}
.demo-bar{background:#111827;color:#fde68a;font-size:12px;padding:6px 14px;text-align:center;line-height:1.5}
.demo-bar b{color:#fff}
header.site{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.96);border-bottom:1px solid var(--line);backdrop-filter:blur(6px)}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
.hd{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:64px}
.logo{font-weight:700;font-size:18px;color:var(--pd);text-decoration:none;letter-spacing:.02em}
.logo small{display:block;font-size:11px;color:var(--mute);font-weight:400}
nav.gn{display:flex;gap:22px;align-items:center}nav.gn a{color:var(--ink);text-decoration:none;font-size:15px}
nav.gn a.cta,.btn{background:var(--p);color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block;border:0;cursor:pointer;font-size:15px}
.btn.ghost{background:transparent;color:var(--p);border:2px solid var(--p)}
.hero{position:relative;overflow:hidden}
.hero .inner{display:grid;gap:32px;align-items:center;padding:56px 20px}
.layout-split .hero .inner{grid-template-columns:1.1fr .9fr}
.layout-centered .hero .inner{grid-template-columns:1fr;text-align:center;max-width:760px;margin:0 auto}
.layout-centered .hero .art{max-width:280px;margin:0 auto;order:-1}
.layout-band .hero{background:linear-gradient(135deg,var(--pd),var(--p));color:#fff}
.layout-band .hero .inner{grid-template-columns:1.2fr .8fr}.layout-band .hero .eyebrow{color:#fff;opacity:.85}.layout-band .hero .btn{background:#fff;color:var(--pd)}
.layout-band .hero .btn.ghost{background:transparent;color:#fff;border-color:#fff}
.layout-split .hero{background:var(--t)}
.eyebrow{color:var(--p);font-weight:700;font-size:13px;letter-spacing:.08em}
.hero h1{font-size:clamp(28px,4.2vw,44px);line-height:1.35;margin:8px 0 16px}
.hero p.lead{font-size:17px;margin:0 0 24px;opacity:.92}
.actions{display:flex;gap:12px;flex-wrap:wrap}.layout-centered .actions{justify-content:center}
section{padding:64px 0}section.alt{background:#f8fafc}
h2.sec{font-size:clamp(22px,3vw,30px);margin:0 0 8px;color:var(--pd)}
.sec-lead{color:var(--mute);margin:0 0 32px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:20px}
.card{border:1px solid var(--line);border-radius:14px;padding:22px;background:#fff}
.card .ic{color:var(--p);background:var(--t);width:52px;height:52px;border-radius:12px;display:grid;place-items:center;margin-bottom:10px}
.card h3{margin:0 0 6px;font-size:18px}.card p{margin:0;color:var(--mute);font-size:15px}
.reasons{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;counter-reset:r}
.reason{padding:22px;border-left:4px solid var(--a);background:#fff;border-radius:0 12px 12px 0}
.reason h3{margin:0 0 6px;font-size:17px}.reason p{margin:0;color:var(--mute)}
.src{display:inline-block;font-size:11px;color:#7b8794;background:#f1f5f9;border-radius:4px;padding:1px 6px;margin-top:8px}
.placeholder{border:2px dashed #cbd2d9;border-radius:14px;padding:28px;text-align:center;color:var(--mute);background:#fff}
.ph-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-top:16px}
.ph-grid div{aspect-ratio:4/3;border-radius:10px;background:repeating-linear-gradient(45deg,var(--t),var(--t) 10px,#fff 10px,#fff 20px);display:grid;place-items:center;font-size:13px;color:var(--mute)}
table.info{width:100%;border-collapse:collapse}table.info th,table.info td{border-bottom:1px solid var(--line);padding:12px 8px;text-align:left;vertical-align:top}
table.info th{width:9em;color:var(--mute);font-weight:600}
.quick{background:var(--pd);color:#fff;padding:22px 0}.quick .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.quick .btn{background:#fff;color:var(--pd)}
.contact-box{background:var(--t);border-radius:18px;padding:36px;text-align:center}
form.demo{max-width:640px;margin:0 auto;display:grid;gap:14px;text-align:left}
form.demo label{display:grid;gap:4px;font-weight:600;font-size:14px}
form.demo input,form.demo textarea,form.demo select{font:inherit;padding:12px;border:1px solid #cbd2d9;border-radius:10px}
.req{color:#c81e1e;font-size:12px;margin-left:6px}
footer.site{background:#0f172a;color:#cbd5e1;padding:32px 0;font-size:13px}footer.site a{color:#e2e8f0}
.sticky{position:fixed;left:0;right:0;bottom:0;display:none;gap:8px;padding:10px;background:rgba(255,255,255,.97);border-top:1px solid var(--line);z-index:20}
.sticky a{flex:1;text-align:center}
.menu-btn{display:none;background:none;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit}
@media (max-width:820px){
  nav.gn{display:none}.menu-btn{display:block}
  nav.gn.open{display:flex;flex-direction:column;position:absolute;top:64px;left:0;right:0;background:#fff;padding:16px;border-bottom:1px solid var(--line)}
  .hero .inner,.layout-split .hero .inner,.layout-band .hero .inner{grid-template-columns:1fr;padding:36px 20px}
  .hero .art{max-width:220px;margin:0 auto}
  section{padding:44px 0}
  .has-sticky .sticky{display:flex}.has-sticky footer.site{padding-bottom:90px}
}`;
}

function shell(spec: MockSpec, opts: RenderOpts, title: string, body: string): string {
  const b = esc(opts.base);
  const nav = `<a href="${b}">トップ</a><a href="${b}services">サービス</a><a href="${b}#company">会社情報</a><a class="cta" href="${b}contact">${esc(spec.ctaLabel)}</a>`;
  const expiry = opts.expiresAt ? `・閲覧期限 ${esc(opts.expiresAt.slice(0, 10))}` : '';
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive"><title>${esc(title)}｜${esc(spec.companyName)}（リニューアル試作）</title>
<style>${css(spec)}</style></head>
<body class="layout-${esc(spec.layout)}${spec.stickyCta ? ' has-sticky' : ''}">
<div class="demo-bar"><b>リニューアル提案の試作デモ</b>です。正式な制作物ではありません。掲載内容は確認・ヒアリング後に確定します${expiry}</div>
<header class="site"><div class="wrap hd"><a class="logo" href="${b}">${esc(spec.companyName)}<small>${esc(spec.hero.eyebrow)}</small></a>
<button class="menu-btn" type="button" onclick="document.getElementById('gn').classList.toggle('open')" aria-label="メニュー">メニュー</button>
<nav class="gn" id="gn">${nav}</nav></div></header>
${body}
<footer class="site"><div class="wrap"><p><b>${esc(spec.companyName)}</b>　${esc(spec.region)}</p>
<p>この画面は提案用の試作です。ダミー機能：${esc(spec.dummyFeatures.join('／'))}。</p>
<p>素材：${esc(spec.assets.map((a) => `${a.name}＝${a.source}`).join('／'))}</p></div></footer>
${spec.stickyCta ? `<div class="sticky"><a class="btn ghost" href="${b}contact" onclick="return true">電話する（デモ）</a><a class="btn" href="${b}contact">${esc(spec.ctaLabel)}</a></div>` : ''}
</body></html>`;
}

function servicesCards(spec: MockSpec, detailed: boolean): string {
  return `<div class="cards">${spec.services
    .map(
      (s, i) => `<div class="card"><div class="ic">${icon(i)}</div><h3>${esc(s.name)}</h3><p>${esc(s.desc)}</p>${detailed ? `<span class="src">説明文: ${s.descSource === 'site' ? 'サイト記載' : 'テンプレート案（要確認）'}</span>` : ''}</div>`,
    )
    .join('')}</div>`;
}

export function renderMock(spec: MockSpec, page: MockPage, opts: RenderOpts): string {
  const b = esc(opts.base);
  if (page === 'services') {
    return shell(spec, opts, 'サービス', `<section><div class="wrap"><p class="eyebrow">SERVICE</p><h2 class="sec">サービス紹介</h2>
<p class="sec-lead">既存サイトに記載されている事業内容をもとに整理しています。説明文はテンプレート案のため、ヒアリング後に確定します。</p>
${servicesCards(spec, true)}
<div class="placeholder" style="margin-top:28px">料金・期間の目安（掲載予定）<br><small>確認できた情報のみ掲載します</small></div>
<p style="text-align:center;margin-top:32px"><a class="btn" href="${b}contact">${esc(spec.ctaLabel)}</a></p></div></section>`);
  }
  if (page === 'contact' || page === 'thanks') {
    const thanks = page === 'thanks';
    return shell(spec, opts, thanks ? '送信完了（デモ）' : 'お問い合わせ', `<section><div class="wrap">
<p class="eyebrow">CONTACT</p><h2 class="sec">${esc(spec.ctaLabel)}</h2>
${thanks ? `<div class="contact-box"><h3>送信完了画面のデモです</h3><p>実際には送信されていません。本番ではこの画面で受付内容と返信の目安をご案内します。</p><a class="btn" href="${b}">トップへ戻る</a></div>` : `
<p class="sec-lead">${esc(spec.contactNote)}<br><b>このフォームはデモのため、入力内容は送信・保存されません。</b></p>
<form class="demo" method="get" action="${b}thanks" onsubmit="return true">
<label>お名前<span class="req">必須</span><input name="n" autocomplete="off" placeholder="例）山田 太郎"></label>
<label>メールアドレス<span class="req">必須</span><input name="m" type="email" autocomplete="off" placeholder="例）taro@example.com"></label>
<label>ご相談の種類<select name="k">${spec.services.map((s) => `<option>${esc(s.name)}</option>`).join('')}<option>その他</option></select></label>
<label>ご相談内容<textarea name="b" rows="5" placeholder="ご自由にご記入ください"></textarea></label>
<button class="btn" type="submit">確認画面へ（デモ）</button></form>`}
</div></section>`);
  }
  // index
  const sec: Record<string, string> = {
    hero: `<div class="hero"><div class="wrap inner"><div><p class="eyebrow">${esc(spec.hero.eyebrow)}</p><h1>${esc(spec.hero.headline)}</h1>
<p class="lead">${esc(spec.hero.lead)}</p><div class="actions"><a class="btn" href="${b}contact">${esc(spec.ctaLabel)}</a><a class="btn ghost" href="${b}services">サービスを見る</a></div></div>${heroArt(spec)}</div></div>`,
    'quick-contact': `<div class="quick"><div class="wrap"><span>${esc(spec.contactNote)}</span><a class="btn" href="${b}contact">${esc(spec.ctaLabel)}</a></div></div>`,
    services: `<section id="services"><div class="wrap"><p class="eyebrow">SERVICE</p><h2 class="sec">サービス紹介</h2><p class="sec-lead">${esc(spec.companyName)}の主な事業内容です。</p>${servicesCards(spec, false)}
<p style="margin-top:24px"><a href="${b}services">サービスの詳細へ →</a></p></div></section>`,
    reasons: `<section class="alt"><div class="wrap"><p class="eyebrow">REASON</p><h2 class="sec">選ばれる理由</h2><p class="sec-lead">既存サイトで確認できた事実をもとに構成しています。</p>
<div class="reasons">${spec.reasons.map((r) => `<div class="reason"><h3>${esc(r.title)}</h3><p>${esc(r.body)}</p><span class="src">根拠: ${esc(r.source)}</span></div>`).join('')}</div></div></section>`,
    works: `<section><div class="wrap"><p class="eyebrow">WORKS</p><h2 class="sec">実績・事例</h2><div class="placeholder"><b>掲載予定領域</b><br>${esc(spec.trust.placeholderNote)}
<div class="ph-grid"><div>事例写真 1（差し替え枠）</div><div>事例写真 2（差し替え枠）</div><div>事例写真 3（差し替え枠）</div></div></div></div></section>`,
    policy: `<section><div class="wrap"><p class="eyebrow">POLICY</p><h2 class="sec">診療方針・院内のご案内</h2><div class="placeholder"><b>掲載予定領域</b><br>${esc(spec.trust.placeholderNote)}</div></div></section>`,
    company: `<section class="alt" id="company"><div class="wrap"><p class="eyebrow">COMPANY</p><h2 class="sec">会社情報</h2><table class="info">${spec.companyInfo.map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`).join('')}</table>
${spec.trust.facts.length ? `<p class="src">確認できた信頼情報: ${esc(spec.trust.facts.join('／'))}</p>` : ''}</div></section>`,
    contact: `<section><div class="wrap"><div class="contact-box"><h2 class="sec">${esc(spec.ctaLabel)}</h2><p>${esc(spec.contactNote)}</p><a class="btn" href="${b}contact">フォームへ進む</a></div></div></section>`,
  };
  return shell(spec, opts, 'トップ', spec.sections.map((s) => sec[s] ?? '').join('\n'));
}
