// RFC4180 準拠の最小 CSV パーサ／ライタ。数式インジェクション対策付き。

export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      if (ch === '\r' && s[i + 1] === '\n') i++;
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/** 表計算ソフトで数式として解釈される先頭文字 */
const FORMULA_PREFIX = /^[=+\-@\t\r＝＋－＠]/;

export function neutralizeFormula(v: string): string {
  return FORMULA_PREFIX.test(v) ? `'${v}` : v;
}

/** 取込時: 先頭の数式記号を除去せず、危険値として検出する */
export function looksLikeFormula(v: string): boolean {
  return FORMULA_PREFIX.test(v);
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const lines = rows.map((r) =>
    r
      .map((cell) => {
        const v = neutralizeFormula(cell === null || cell === undefined ? '' : String(cell));
        return /[",\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v;
      })
      .join(','),
  );
  // Excel が UTF-8 と認識できるよう BOM を付与
  return '﻿' + lines.join('\r\n') + '\r\n';
}
