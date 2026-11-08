// Derived from sales-claw-ts (MIT, Copyright (c) 2025-2026 Sales Claw contributors)
// src/locale-pack/ja/sendability-exclusions.ts / src/sendability-gate.ts の語彙を正規表現化・拡張。

const S = '[\\s　]*';

/** 営業・勧誘の禁止表示 */
export const PROHIBITION_PATTERNS: RegExp[] = [
  new RegExp(`営業${S}(・|、|や|及び|および)?${S}(勧誘|セールス)?${S}(目的)?${S}の?${S}(お問い?合わせ|ご連絡|ご案内|メール|電話)?${S}(は|を)?${S}(お断り|ご遠慮|固くお断り|一切お断り)`),
  new RegExp(`(勧誘|セールス)${S}(目的)?${S}の?${S}(お問い?合わせ|ご連絡|メール)?${S}(は|を)?${S}(お断り|ご遠慮)`),
  /営業お断り/,
  /広告(メール|宣伝)?(の送信)?(は|を)?(お断り|ご遠慮|拒否)/,
  /未承諾広告/,
  /(採用|IR|報道|メディア|記者|既存顧客)専用/,
];

/** 営業・業者向け窓口の案内（この窓口が明示されていればフォーム禁止でもメール窓口は検討可） */
export const SALES_DESK_PATTERNS: RegExp[] = [
  new RegExp(`営業${S}(・|、)?${S}業者${S}の方${S}(から|より)?${S}の?${S}ご連絡${S}は${S}[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+`),
  new RegExp(`(営業|業者|取引)${S}(の方|担当|窓口)${S}[^。]{0,30}?[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+${S}(まで|へ)`),
];
