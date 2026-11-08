// Derived from sales-claw-ts (MIT, Copyright (c) 2025-2026 Sales Claw contributors)
// src/locale-pack/ja/compliance-rules.ts の項目構成を移植。
// 本チェックは法令適合を保証しない。最終責任は利用者にある。

export interface ComplianceCheck {
  id: string;
  label: string;
  required: boolean;
  /** 本文に含まれるべき値（送信者設定から取得）またはパターン */
  test: (body: string, sender: Record<string, string>) => boolean;
  hint: string;
}

const has = (body: string, v: string | undefined) => !!v && body.includes(v);

export const JA_COMPLIANCE: ComplianceCheck[] = [
  { id: 'sender-company', label: '送信者の会社名', required: true, test: (b, s) => has(b, s.companyName), hint: '送信者設定の会社名を本文末尾に表示してください。' },
  { id: 'sender-name', label: '送信者の氏名', required: true, test: (b, s) => has(b, s.contactName), hint: '担当者氏名を表示してください。' },
  { id: 'sender-address', label: '送信者の住所', required: true, test: (b, s) => has(b, s.address), hint: '特定電子メール法に基づき住所を表示してください。' },
  { id: 'contact-email', label: '連絡先メール', required: true, test: (b, s) => has(b, s.email), hint: '返信・苦情受付用のメールアドレスを表示してください。' },
  { id: 'opt-out', label: '受信拒否（配信停止）の方法', required: true, test: (b) => /(配信停止|送信停止|今後[\s　]*の?[\s　]*ご?連絡[\s　]*(が|は)?[\s　]*不要)/.test(b), hint: '受信拒否の通知方法を表示してください。' },
];
