// XSS 対策: すべての動的値はこのタグ付きテンプレートで自動エスケープする。
export class SafeHtml {
  constructor(public readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(v: unknown): string {
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += render(values[i]);
  });
  return new SafeHtml(out);
}

/** 信頼できる静的文字列のみに使用する */
export function raw(s: string): SafeHtml {
  return new SafeHtml(s);
}

/** URL 属性に入れてよいのは http(s) と相対パスのみ */
export function safeHref(u: string): string {
  const s = String(u || '').trim();
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^mailto:/i.test(s)) return s;
  return '#';
}

/** CSS 色として安全な値だけを通す */
export function safeColor(c: string, fallback = '#2b6cb0'): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : fallback;
}
