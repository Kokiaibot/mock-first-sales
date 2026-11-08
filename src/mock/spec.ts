// 企業ごとのモック仕様を、分析で確認できた事実から組み立てる（テンプレート＋ルール）。
// 架空の実績・口コミ・顧客・受賞歴は生成しない。
import type { Row } from '../db.js';
import { extractServiceNames, type PageFacts } from '../analysis/extract.js';
import { sha256 } from '../util/crypto.js';

export type IndustryKey = 'construction' | 'dental' | 'professional' | 'manufacturing' | 'general';

export interface MockSpec {
  version: 1;
  companyName: string;
  industry: IndustryKey;
  industryLabel: string;
  region: string;
  layout: 'split' | 'centered' | 'band';
  palette: { primary: string; primaryDark: string; accent: string; tint: string; source: string };
  hero: { eyebrow: string; headline: string; lead: string; leadSource: string };
  services: { name: string; desc: string; descSource: 'site' | 'template' }[];
  reasons: { title: string; body: string; source: string }[];
  trust: { facts: string[]; placeholderNote: string };
  companyInfo: { label: string; value: string }[];
  areas: string;
  sections: string[];
  stickyCta: boolean;
  ctaLabel: string;
  contactNote: string;
  medicalAdNote: boolean;
  improvements: { category: string; before: string; after: string }[];
  assets: { name: string; source: string; license: string }[];
  dummyFeatures: string[];
  workingFeatures: string[];
}

const INDUSTRY: Record<IndustryKey, { label: string; noun: string; defaultColor: string; cta: string; layouts: MockSpec['layout'][] }> = {
  construction: { label: '建設・工務店', noun: '住まいのこと', defaultColor: '#2f6f4f', cta: '無料相談・お見積り', layouts: ['split', 'band'] },
  dental: { label: '歯科・医療', noun: '歯科医院', defaultColor: '#c8557a', cta: '診療のご予約・お問い合わせ', layouts: ['centered', 'split'] },
  professional: { label: '士業・専門サービス', noun: 'ご相談', defaultColor: '#1e3a8a', cta: '初回相談のお申し込み', layouts: ['band', 'centered'] },
  manufacturing: { label: '製造業', noun: '加工のご相談', defaultColor: '#334e68', cta: '加工のご相談', layouts: ['split', 'band'] },
  general: { label: '事業者', noun: 'サービス', defaultColor: '#2b6cb0', cta: 'お問い合わせ', layouts: ['centered', 'split', 'band'] },
};

export function classifyIndustry(industry: string, text: string): IndustryKey {
  const s = industry + ' ' + text.slice(0, 2000);
  if (/(工務店|建設|建築|リフォーム|住宅|塗装|工事)/.test(industry) || (/工務店|リフォーム/.test(s) && !industry)) return 'construction';
  if (/(歯科|医院|クリニック|医療)/.test(industry) || (!industry && /歯科/.test(s))) return 'dental';
  if (/(税理士|会計|士業|法律|弁護士|司法書士|行政書士|社労士)/.test(industry) || (!industry && /税理士/.test(s))) return 'professional';
  if (/(製造|精機|加工|工業)/.test(industry)) return 'manufacturing';
  return 'general';
}

const SERVICE_DESC: [RegExp, string][] = [
  [/注文住宅|新築/, '暮らし方やご予算をうかがい、設計から施工まで一貫してご相談いただけます。'],
  [/リフォーム|改修/, '部分的な修繕から間取り変更まで、現地を確認したうえでご提案します。'],
  [/塗装|外壁|屋根/, '外壁・屋根の状態を確認し、塗り替えの時期や方法をご案内します。'],
  [/水まわり|水回り|キッチン|浴室|トイレ/, 'キッチン・浴室・トイレなど、水まわりの交換や修理に対応します。'],
  [/一般歯科|虫歯/, 'むし歯や歯周病など、お口のお悩みをご相談いただけます。'],
  [/小児/, 'お子さまの歯の診療や、ご家族への歯みがきのアドバイスを行います。'],
  [/予防|クリーニング|メンテナンス/, '定期的な検診とクリーニングで、歯の健康維持をサポートします。'],
  [/ホワイトニング|審美/, '歯の色に関するご相談を承ります（自由診療の内容・費用は院内で説明）。'],
  [/税務顧問|顧問/, '月々の記帳や税務のご相談に継続して対応します。'],
  [/確定申告/, '個人事業主の方の確定申告をサポートします。'],
  [/相続/, '相続税の申告や、事前の相続対策のご相談に対応します。'],
  [/設立|創業|融資/, '会社設立の手続きや創業時の資金計画についてご相談いただけます。'],
  [/経営計画|経営/, '事業計画・経営計画の作成を一緒に進めます。'],
  [/切削|加工|部品/, '図面や仕様をうかがい、加工方法や納期をご相談いただけます。'],
];

function describeService(name: string): { desc: string; descSource: 'template' } {
  for (const [re, d] of SERVICE_DESC) if (re.test(name)) return { desc: d, descSource: 'template' };
  return { desc: `${name}についてのご相談を承ります（詳細はヒアリング後に記載）。`, descSource: 'template' };
}

const DEFAULT_SERVICES: Record<IndustryKey, string[]> = {
  construction: ['新築・注文住宅', 'リフォーム', '修繕・メンテナンス'],
  dental: ['一般歯科', '予防歯科', '小児歯科'],
  professional: ['顧問契約', '各種申告', '個別相談'],
  manufacturing: ['加工のご相談', '試作対応', '量産対応'],
  general: ['主なサービス', 'ご相談対応', 'アフターサポート'],
};

/** 色の明度を調整（-1〜1） */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const t = amt < 0 ? 0 : 255;
    return Math.round(v + (t - v) * Math.abs(amt));
  });
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function complementAccent(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = (h * 60 + 360 + 35) % 360; // 類似色寄りのアクセント
  const L = 0.5, S = Math.max(0.55, s);
  const c = (1 - Math.abs(2 * L - 1)) * S, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = L - c / 2;
  const [rr, gg, bb] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [rr, gg, bb].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

export function buildSpec(company: Row, pages: PageFacts[], findings: Row[]): MockSpec {
  const top = pages[0];
  const allText = pages.map((p) => p.text).join('\n');
  const ind = classifyIndustry(company.industry, allText);
  const meta = INDUSTRY[ind];
  const seed = parseInt(sha256(company.public_id).slice(0, 8), 16);
  const region = [company.prefecture, company.city].filter(Boolean).join('');
  const cityOnly = company.city || company.prefecture || '';

  const brand = top?.colors?.[0];
  const primary = brand ?? meta.defaultColor;
  const palette = {
    primary,
    primaryDark: shade(primary, -0.35),
    accent: complementAccent(primary),
    tint: shade(primary, 0.92),
    source: brand ? `既存サイトの使用色 ${brand} を継承` : `既存サイトから色を確認できなかったため業種標準色 ${meta.defaultColor}`,
  };

  // サイト上の事実からキャッチコピーの素材を取る
  const extracted = extractServiceNames(pages);
  const serviceNames = (extracted.length >= 2 ? extracted : DEFAULT_SERVICES[ind]).slice(0, 6);
  const usedDesc = new Set<string>();
  const services = serviceNames.map((n) => {
    let d = describeService(n);
    if (usedDesc.has(d.desc)) d = { desc: `${n}についてのご相談を承ります（詳細はヒアリング後に記載）。`, descSource: 'template' };
    usedDesc.add(d.desc);
    return { name: n, ...d };
  });

  const issues = new Set(findings.filter((f) => f.status === 'issue').map((f) => Number(f.category)));
  const areas = (allText.match(/対応エリア[\s:：]*([^。\n]{4,80})/)?.[1] ?? '').trim();
  const access = (allText.match(/([^\s。、]{2,12}駅から徒歩[\d０-９一二三四五六七八九十]+分|[^\s。、]{2,12}駅から徒歩圏内)/)?.[1] ?? '').trim();

  const heroByInd: Record<IndustryKey, string> = {
    construction: `${cityOnly}の住まいづくりを、相談から施工まで。`,
    dental: `${cityOnly}で、通いやすい歯科医院を。`,
    professional: `${cityOnly}の事業者の税務・会計を、身近な相談相手として。`,
    manufacturing: `${cityOnly}から、精密加工のご相談に応えます。`,
    general: `${cityOnly}の${meta.noun}は${company.name}へ。`,
  };
  // リード文は既存サイトの文章を転載せず、確認できた事実（サービス名・地域・アクセス）から新たに組み立てる
  const svcPhrase = serviceNames.slice(0, 3).join('・');
  const leadByInd: Record<IndustryKey, string> = {
    construction: `${svcPhrase}など、${areas || region}で住まいのご相談に対応しています。`,
    dental: `${svcPhrase}など、${access ? access + 'の' : region + 'の'}歯科医院です。`,
    professional: `${svcPhrase}など、${region}${access ? '（' + access + '）' : ''}で税務・会計のご相談に対応しています。`,
    manufacturing: `${svcPhrase}など、${region}で加工のご相談に対応しています。`,
    general: `${svcPhrase}など、${region}で${meta.noun}を提供しています。`,
  };

  const reasons: MockSpec['reasons'] = [];
  if (areas || region) reasons.push({ title: '地域に根ざした対応', body: areas ? `${areas}を中心に対応しています。` : `${region}を拠点に活動しています。`, source: areas ? 'サイト記載の対応エリア' : '登録された所在地' });
  if (access) reasons.push({ title: '通いやすい立地', body: `${access}です。`, source: 'サイト記載のアクセス情報' });
  const permit = allText.match(/([^\s。]{0,10}(許可|登録|認定)[^\s。]{0,30}第[^\s。]{1,20}号)/)?.[1];
  if (permit) reasons.push({ title: '許可・登録', body: permit, source: 'サイト記載の許可番号' });
  if (/土曜/.test(allText)) reasons.push({ title: ind === 'dental' ? '土曜日の診療' : '土曜日のご相談', body: 'サイトに土曜日の対応に関する記載があります。受付条件を確認のうえ掲載します。', source: 'サイト記載の受付時間' });
  while (reasons.length < 3) reasons.push({ title: ['ご要望のヒアリング', '分かりやすいご説明', '相談しやすい窓口'][reasons.length], body: '御社の強みをヒアリングのうえ記載する掲載予定枠です。', source: '掲載予定（要ヒアリング）' });

  const trustFacts = [permit, top?.trustKeywords?.includes('会社概要') ? '会社概要ページあり' : '', /院長/.test(allText) ? '院長あいさつ（既存サイトに掲載あり）' : ''].filter(Boolean) as string[];

  const companyInfo = [
    { label: '名称', value: company.name },
    { label: '所在地', value: region ? `${region}（詳細住所は確認後に掲載）` : '確認後に掲載' },
    ...(access ? [{ label: 'アクセス', value: access }] : []),
    ...(areas ? [{ label: '対応エリア', value: areas }] : []),
    { label: '事業内容', value: serviceNames.join('、') },
  ];

  const sections = ['hero', 'services', 'reasons'];
  if (issues.has(3)) sections.splice(1, 0, 'quick-contact');
  sections.push(ind === 'dental' ? 'policy' : 'works', 'company', 'contact');

  const findingMap = new Map(findings.map((f) => [Number(f.category), f]));
  const improvements = [...issues].sort().map((cat) => {
    const f = findingMap.get(cat)!;
    return { category: String(f.category), before: String(f.fact).slice(0, 140), after: String(f.policy) };
  });

  const layouts = meta.layouts;
  return {
    version: 1,
    companyName: company.name,
    industry: ind,
    industryLabel: meta.label,
    region,
    layout: layouts[seed % layouts.length],
    palette,
    hero: {
      eyebrow: `${region} / ${meta.label}`,
      headline: heroByInd[ind],
      lead: leadByInd[ind],
      leadSource: extracted.length >= 2 ? 'サイト記載の事実（サービス名・地域・アクセス）から新たに作成' : 'テンプレート（サービス名は業種標準）',
    },
    services,
    reasons: reasons.slice(0, 4),
    trust: {
      facts: trustFacts,
      placeholderNote: ind === 'dental' ? '医療広告ガイドラインに配慮し、患者の体験談・治療前後写真は掲載しません。診療方針・設備は確認後に掲載します。' : '実績・事例は、掲載の許諾を得た内容を確認後に掲載する予定の領域です（この試作では架空の実績を表示しません）。',
    },
    companyInfo,
    areas,
    sections,
    stickyCta: issues.has(3) || issues.has(1),
    ctaLabel: meta.cta,
    contactNote: top?.telLinks?.length || /\d{2,4}-\d{2,4}-\d{3,4}/.test(allText) ? 'お電話・フォームのどちらからでもご連絡いただける構成です。' : 'フォームからご連絡いただける構成です。',
    medicalAdNote: ind === 'dental',
    improvements,
    assets: [
      { name: '背景・装飾図形', source: '本システムで生成した SVG 図形', license: '自社生成（第三者の権利を含まない）' },
      { name: 'アイコン', source: '本システムで生成した SVG 図形', license: '自社生成（第三者の権利を含まない）' },
      { name: '写真', source: '使用していません（差し替え枠のみ）', license: '—' },
    ],
    dummyFeatures: ['問い合わせフォームの送信（デモのため送信されません）', '電話ボタン（発信しません）', '実績・事例（掲載予定の枠のみ）'],
    workingFeatures: ['ページ間の遷移', 'PC・スマートフォン表示の切替（レスポンシブ）', 'ナビゲーション'],
  };
}
