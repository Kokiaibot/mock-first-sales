// 個別営業文の生成（テンプレート＋分析で観察できた事実）と品質ゲート
import { type DB, get, run, tx, nowIso, audit, getSetting, type Row } from '../db.js';
import type { AppConfig } from '../config.js';
import { getCompany, advanceStatus } from '../domain/companies.js';
import { latestAnalysis, findingsOf, PermanentError } from '../analysis/analyze.js';
import { currentMock, mockSpec, previewUrls } from '../mock/service.js';
import { CATEGORIES } from '../analysis/rules.js';
import { JA_COMPLIANCE } from '../vendor/sales-claw/compliance-rules.js';
import { logUsage } from '../domain/usage.js';

export interface SenderProfile {
  companyName: string;
  contactName: string;
  address: string;
  phone: string;
  email: string;
  optOutEmail: string;
}

export const EMPTY_SENDER: SenderProfile = { companyName: '', contactName: '', address: '', phone: '', email: '', optOutEmail: '' };

export function getSender(db: DB): SenderProfile {
  return getSetting<SenderProfile>(db, 'sender', EMPTY_SENDER);
}

export function senderMissing(s: SenderProfile): string[] {
  const m: string[] = [];
  if (!s.companyName) m.push('会社名');
  if (!s.contactName) m.push('担当者氏名');
  if (!s.address) m.push('住所');
  if (!s.email) m.push('連絡先メール');
  return m;
}

/** 根拠のない効果保証・断定表現 */
const PROHIBITED_CLAIMS: RegExp[] = [
  /(売上|売り上げ|集客|問い?合わ?せ|反響|成約|来院|予約)[^。\n]{0,10}(向上|アップ|増加|倍増|[0-9０-９]+倍|伸び)(します|させます|いたします|が見込め|を保証|確実)/,
  /(必ず|確実に|間違いなく|絶対に)[^。\n]{0,20}(増え|上が|改善|成果)/,
  /(効果|成果|結果)を?保証/,
  /(No\.?1|ナンバーワン|業界初|日本一)/i,
];

export interface QualityResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function checkQuality(body: string, subject: string, sender: SenderProfile, ctx: { previewUrl: string; viewCode: string; observationCount: number }): QualityResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const s = sender as unknown as Record<string, string>;
  for (const rule of JA_COMPLIANCE) if (!rule.test(body, s)) (rule.required ? errors : warnings).push(`${rule.label}がありません: ${rule.hint}`);
  for (const re of PROHIBITED_CLAIMS) {
    const m = re.exec(body + '\n' + subject);
    if (m) errors.push(`根拠のない効果保証・断定表現: 「${m[0]}」`);
  }
  if (!body.includes(ctx.previewUrl)) errors.push('本文に現在の試作プレビューURLが含まれていません');
  if (!body.includes(ctx.viewCode)) errors.push('本文に現在の閲覧コードが含まれていません');
  if (!/(試作|デモ)/.test(body) || !/正式な制作物ではありません/.test(body)) errors.push('デモであり正式な制作物ではない旨がありません');
  if (ctx.observationCount < 1) errors.push('企業ごとの観察に基づく改善点が含まれていません');
  if (/\{\{|\}\}|＿＿/.test(body)) errors.push('未置換のプレースホルダが残っています');
  if (/[\r\n]/.test(subject)) errors.push('件名に改行を含めることはできません');
  if (subject.length > 120) warnings.push('件名が長すぎます');
  if (body.length > 4000) warnings.push('本文が長すぎます（4000文字超）');
  return { ok: errors.length === 0, errors, warnings };
}

export function composeDraft(company: Row, findings: Row[], sender: SenderProfile, preview: { url: string; isLocal: boolean; viewCode: string; expiresAt: string }, checkedAt: string, unsubscribeUrl: string | null) {
  const issues = findings.filter((f) => f.status === 'issue').slice(0, 3);
  const obs = issues.map((f, i) => {
    const pts: string[] = JSON.parse(f.issue_points || '[]');
    const fact = (pts.length ? pts : String(f.fact).split('。').filter(Boolean)).slice(0, 2).join('。');
    return `${i + 1}. ${CATEGORIES[f.category]}：${fact}。\n   → 試作では、${f.policy}。`;
  });
  const exp = jpDate(preview.expiresAt);
  const subject = `${company.name}様　ホームページのリニューアル試作のご案内（${sender.companyName}）`;
  const body = [
    `${company.name}　ご担当者様`,
    '',
    `突然のご連絡失礼いたします。${sender.companyName}の${sender.contactName}と申します。`,
    `${jpDate(checkedAt)}に御社の公式サイト（${company.website_url}）を拝見し、`,
    'リニューアルのご提案として、御社向けの試作ページを作成いたしました。',
    '',
    '■ 拝見して気づいた点',
    ...obs,
    '',
    '■ 試作プレビュー',
    `URL：${preview.url}`,
    `閲覧コード：${preview.viewCode}`,
    `閲覧期限：${exp}まで`,
    '※ 提案用の試作（デモ）であり、正式な制作物ではありません。掲載内容は御社への確認前のものです。',
    '※ ご覧いただくことで費用や契約が発生することはありません。',
    '',
    'ご興味をお持ちいただけましたら、本メールへのご返信でお知らせください。',
    '',
    '――――――――――――――',
    sender.companyName,
    `担当：${sender.contactName}`,
    `所在地：${sender.address}`,
    sender.phone ? `電話：${sender.phone}` : '',
    `メール：${sender.email}`,
    '――――――――――――――',
    '本メールは、御社ウェブサイトで公表されているメールアドレス宛にお送りしています。',
    `今後のご連絡が不要な場合は、本メールに「配信停止」とご返信いただくか、${sender.optOutEmail || sender.email} までお知らせください。${unsubscribeUrl ? `\n配信停止の手続きページ：${unsubscribeUrl}` : ''}`,
    '配信停止のご連絡をいただいた後は、以降のご連絡はいたしません。',
  ]
    .filter((l) => l !== '')
    .join('\n')
    .replace(/\n(■)/g, '\n\n$1')
    .replace(/\n(ご興味)/, '\n\n$1')
    .replace(/\n(――)/, '\n\n$1');
  return { subject, body, observationCount: issues.length };
}

export interface DraftOutcome {
  draftId: number;
  reused: boolean;
}

export function generateDraft(db: DB, cfg: AppConfig, companyId: number, jobId?: number): DraftOutcome {
  const c = getCompany(db, companyId);
  if (!c) throw new PermanentError('企業が見つかりません');
  const m = currentMock(db, companyId);
  if (!m || m.revoked_at) throw new PermanentError('有効なモックがありません');
  const a = latestAnalysis(db, companyId)!;
  const existing = get(db, 'SELECT id FROM drafts WHERE company_id = ? AND mock_id = ? AND archived = 0 ORDER BY id DESC LIMIT 1', companyId, m.id);
  if (existing) return { draftId: existing.id, reused: true };
  const sender = getSender(db);
  const urls = previewUrls(cfg, m);
  const previewUrl = urls.external ?? urls.local;
  const unsub = cfg.publicBaseUrl ? `${cfg.publicBaseUrl.replace(/\/$/, '')}/u/${c.unsubscribe_token}` : null;
  const findings = findingsOf(db, a.id);
  const { subject, body, observationCount } = composeDraft(c, findings, sender, { url: previewUrl, isLocal: !urls.external, viewCode: m.view_code, expiresAt: m.expires_at }, a.created_at, unsub);
  const quality = checkQuality(body, subject, sender, { previewUrl, viewCode: m.view_code, observationCount });
  if (!urls.external) quality.warnings.push('プレビューURLがローカルURLです（相手先からは閲覧できません）。実送信には外部閲覧可能なURLが必要です。');
  const id = tx(db, () => {
    run(db, 'UPDATE drafts SET archived = 1 WHERE company_id = ? AND archived = 0', companyId);
    const r = run(
      db,
      'INSERT INTO drafts (company_id, mock_id, channel, recipient, subject, body, generation_method, quality, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      companyId, m.id, 'email', c.email, subject, body, 'template', JSON.stringify(quality), nowIso(), nowIso(),
    );
    return Number(r.lastInsertRowid);
  });
  logUsage(db, { service: 'local-template', operation: 'draft-generate', companyId, jobId, units: '1 draft', costStatus: 'free' });
  advanceStatus(db, companyId, 'awaiting_approval');
  // 下書き作成は「承認待ち」状態にするだけ。承認は利用者のみが行う。
  return { draftId: id, reused: false };
}

export function getDraft(db: DB, id: number): Row | undefined {
  return get(db, 'SELECT * FROM drafts WHERE id = ?', id);
}

/** 下書きの編集。宛先・件名・本文が変わったら承認を解除し、品質ゲートを再実行 */
export function updateDraft(db: DB, cfg: AppConfig, id: number, patch: { subject: string; body: string; recipient: string }, actor: string, method: 'manual' | 'ai' = 'manual'): void {
  const d = getDraft(db, id);
  if (!d) throw new Error('下書きが見つかりません');
  const subject = patch.subject.replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  const body = patch.body.replace(/\r\n/g, '\n').slice(0, 8000);
  const recipient = patch.recipient.trim().toLowerCase();
  if (subject === d.subject && body === d.body && recipient === d.recipient) return;
  const m = get(db, 'SELECT * FROM mocks WHERE id = ?', d.mock_id)!;
  const urls = previewUrls(cfg, m);
  const sender = getSender(db);
  const a = latestAnalysis(db, d.company_id);
  const obsCount = a ? findingsOf(db, a.id).filter((f) => f.status === 'issue').length : 0;
  const quality = checkQuality(body, subject, sender, { previewUrl: urls.external ?? urls.local, viewCode: m.view_code, observationCount: obsCount });
  tx(db, () => {
    run(db, 'UPDATE drafts SET subject = ?, body = ?, recipient = ?, quality = ?, generation_method = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
      subject, body, recipient, JSON.stringify(quality), method === 'ai' ? 'template+ai' : d.generation_method === 'template' ? 'template+manual' : d.generation_method, nowIso(), id);
    run(db, "UPDATE approvals SET revoked_at = ?, revoke_reason = '下書き（宛先・件名・本文）が変更された' WHERE draft_id = ? AND revoked_at IS NULL", nowIso(), id);
    audit(db, actor, 'draft.update', `draft:${id}`);
  });
}

/** フォーム入力計画（実際の入力・送信は行わない） */
export function formFillPlan(db: DB, companyId: number): { url: string; rows: { field: string; type: string; required: boolean; value: string }[]; blocked: string | null } | null {
  const c = getCompany(db, companyId);
  const a = latestAnalysis(db, companyId);
  if (!c || !a) return null;
  const pages = JSON.parse(a.page_facts) as any[];
  const formPage = pages.find((p) => p.hasForm);
  if (!formPage) return null;
  const sender = getSender(db);
  const d = get(db, 'SELECT * FROM drafts WHERE company_id = ? AND archived = 0 ORDER BY id DESC LIMIT 1', companyId);
  const pick = (f: any) => {
    const k = `${f.name} ${f.label} ${f.type}`.toLowerCase();
    if (/mail/.test(k)) return sender.email;
    if (/(name|名前|氏名)/.test(k)) return `${sender.companyName} ${sender.contactName}`;
    if (/(tel|phone|電話)/.test(k)) return sender.phone;
    if (/(body|message|内容|textarea)/.test(k)) return d ? '(営業文本文)' : '';
    if (/checkbox/.test(k)) return '（同意事項を人が確認してチェック）';
    return '';
  };
  const blocked = /送信不可/.test(c.eligibility_auto) || /フォーム送信は不可/.test(c.eligibility_auto) ? 'フォームでの営業が禁止されているため、フォーム送信は行いません' : null;
  return { url: formPage.url, rows: formPage.formFields.map((f: any) => ({ field: f.name || f.label, type: f.type, required: f.required, value: pick(f) })), blocked };
}

export function jpDate(iso: string): string {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}年${g('month')}月${g('day')}日`;
}
