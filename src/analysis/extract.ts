// HTML から客観的に観察できる事実を抽出する（ルール処理。AI は使わない）
import { parse, type HTMLElement } from 'node-html-parser';

export interface PageFacts {
  url: string;
  title: string;
  metaDescription: string;
  hasViewport: boolean;
  viewportContent: string;
  lang: string;
  h1: string[];
  h2: string[];
  navLabels: string[];
  links: { text: string; href: string }[];
  contactLinks: { text: string; href: string }[];
  telLinks: string[];
  hasForm: boolean;
  formFields: { name: string; type: string; required: boolean; label: string }[];
  emails: string[];
  imgCount: number;
  imgWithoutAlt: number;
  tableLayout: boolean;
  legacyTags: string[];
  inlineStyleCount: number;
  copyrightYear: number | null;
  latestDateYear: number | null;
  textLength: number;
  text: string;
  trustKeywords: string[];
  serviceKeywords: string[];
  colors: string[];
  htmlBytes: number;
  scriptCount: number;
  stylesheetCount: number;
}

const CONTACT_RE = /(お問い?合わ?せ|問合せ|ご相談|ご予約|予約|contact|inquiry|reserve)/i;
const TRUST_WORDS = ['実績', '事例', '施工例', '施工事例', 'お客様の声', '導入事例', '受賞', '資格', '許可', '認定', '会社概要', '代表挨拶', '院長', 'スタッフ紹介', '沿革'];
const SERVICE_WORDS = ['サービス', '事業内容', '業務内容', '診療内容', '診療案内', 'メニュー', '料金', '取扱', '製品', '商品', '対応エリア'];

export function extractFacts(url: string, htmlText: string): PageFacts {
  const root = parse(htmlText, { comment: false, blockTextElements: { script: false, style: true, noscript: false } });
  const q = (sel: string) => root.querySelectorAll(sel) as HTMLElement[];
  // ブロック要素ごとに改行した本文（見出しと本文が連結しないようにする）
  const bodyEl = root.querySelector('body') ?? root;
  const text = bodyEl.structuredText.split('\n').map(cleanText).filter(Boolean).join('\n');
  const links = q('a[href]').map((a) => ({ text: cleanText(a.text).slice(0, 80), href: absolutize(url, a.getAttribute('href') || '') }));
  const viewport = q('meta').find((m) => (m.getAttribute('name') || '').toLowerCase() === 'viewport');
  const metaDesc = q('meta').find((m) => (m.getAttribute('name') || '').toLowerCase() === 'description');
  const styleText = q('style').map((s) => s.text).join('\n') + '\n' + q('[style]').map((e) => e.getAttribute('style')).join(';');
  const colors = extractColors(styleText + '\n' + q('font[color]').map((f) => `color:${f.getAttribute('color')}`).join(';'));
  const years = [...text.matchAll(/(?:^|[^\d])((?:19|20)\d{2})[.\/年-]\s?\d{1,2}[.\/月-]/g)].map((m) => Number(m[1]));
  const cr = /(?:©|&copy;|copyright\s*(?:\(c\))?)\s*((?:19|20)\d{2})/i.exec(text) || /(?:©|copyright)[^\d]{0,20}((?:19|20)\d{2})/i.exec(text);
  const emails = [...new Set([...(htmlText.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) ?? [])].map((e) => e.toLowerCase()))].filter((e) => !/\.(png|jpg|gif|svg)$/.test(e)).slice(0, 10);
  const forms = q('form');
  const formFields = forms.flatMap((f) =>
    (f.querySelectorAll('input, textarea, select') as HTMLElement[])
      .filter((i) => !['hidden', 'submit', 'button'].includes((i.getAttribute('type') || '').toLowerCase()))
      .map((i) => ({
        name: i.getAttribute('name') || '',
        type: i.tagName.toLowerCase() === 'input' ? i.getAttribute('type') || 'text' : i.tagName.toLowerCase(),
        required: i.hasAttribute('required'),
        label: cleanText((i.parentNode as HTMLElement)?.tagName === 'LABEL' ? (i.parentNode as HTMLElement).text : '').slice(0, 40),
      })),
  );
  return {
    url,
    title: cleanText(root.querySelector('title')?.text ?? ''),
    metaDescription: metaDesc?.getAttribute('content') ?? '',
    hasViewport: !!viewport,
    viewportContent: viewport?.getAttribute('content') ?? '',
    lang: root.querySelector('html')?.getAttribute('lang') ?? '',
    h1: q('h1').map((h) => cleanText(h.text)).filter(Boolean).slice(0, 5),
    h2: q('h2, h3').map((h) => cleanText(h.text)).filter(Boolean).slice(0, 30),
    navLabels: (q('nav a').length ? q('nav a') : q('header a, .nav a, #nav a')).map((a) => cleanText(a.text)).filter(Boolean).slice(0, 20),
    links: links.slice(0, 200),
    contactLinks: links.filter((l) => CONTACT_RE.test(l.text) || CONTACT_RE.test(l.href)).slice(0, 20),
    telLinks: links.filter((l) => l.href.startsWith('tel:')).map((l) => l.href).slice(0, 5),
    hasForm: forms.length > 0,
    formFields,
    emails,
    imgCount: q('img').length,
    imgWithoutAlt: q('img').filter((i) => !(i.getAttribute('alt') || '').trim()).length,
    tableLayout: q('table').some((t) => t.getAttribute('class')?.includes('wrap') || t.getAttribute('width') !== undefined || q('table td > table, table td img').length > 0) && !q('main, section, article').length,
    legacyTags: ['font', 'center', 'marquee', 'frameset', 'blink'].filter((t) => q(t).length > 0),
    inlineStyleCount: q('[style]').length,
    copyrightYear: cr ? Number(cr[1]) : null,
    latestDateYear: years.length ? Math.max(...years) : null,
    textLength: text.length,
    text: text.slice(0, 20000),
    trustKeywords: TRUST_WORDS.filter((w) => text.includes(w)),
    serviceKeywords: SERVICE_WORDS.filter((w) => text.includes(w)),
    colors,
    htmlBytes: Buffer.byteLength(htmlText),
    scriptCount: q('script').length,
    stylesheetCount: q('link').filter((l) => (l.getAttribute('rel') || '').includes('stylesheet')).length,
  };
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function absolutize(base: string, href: string): string {
  if (/^(tel|mailto):/i.test(href)) return href;
  try {
    return new URL(href, base).toString();
  } catch {
    return '';
  }
}

/** CSS 中の色を出現頻度順に抽出（白・黒・灰色は除外） */
export function extractColors(css: string): string[] {
  const counts = new Map<string, number>();
  for (const m of css.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    let h = m[1].toLowerCase();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (isNeutral(h)) continue;
    counts.set('#' + h, (counts.get('#' + h) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 5);
}

function isNeutral(hex: string): boolean {
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  return sat < 0.2 || max < 40 || min > 225;
}

/** サービス名の候補を抽出（「／」「・」「、」区切りの列挙文から）。推測でなく本文の語のみ使う */
export function extractServiceNames(facts: PageFacts[]): string[] {
  const out = new Set<string>();
  // サービス紹介ページを優先
  const ordered = [...facts].sort((a, b) => Number(/(service|業務|事業|診療)/i.test(b.url + b.title)) - Number(/(service|業務|事業|診療)/i.test(a.url + a.title)));
  for (const f of ordered) {
    for (const rawLine of f.text.split(/[\n。]/)) {
      const line = rawLine.replace(/^[^：:]{1,10}[：:]/, '').replace(/(を行っています|を行っております|に対応しています|に対応しております|など.*|等.*)$/, '').trim();
      const parts = line.split(/[／/・、,]/).map((x) => x.trim()).filter(Boolean);
      if (parts.length < 3) continue;
      if (!parts.every((x) => /^[^\sはをがでにもへ○△]{2,12}$/.test(x) && !/\d{2,}/.test(x))) continue;
      // 地名の列挙（対応エリア等）は除外
      if (parts.filter((x) => /[都道府県市区町村]$/.test(x)).length >= parts.length / 2) continue;
      parts.forEach((x) => out.add(x));
      if (out.size >= 6) break;
    }
    if (out.size >= 3) break;
  }
  return [...out].slice(0, 6);
}
