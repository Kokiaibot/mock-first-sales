// docs/IMPLEMENTATION_STATUS.md と docs/COSTS.md をコード上の定義から生成: npx tsx scripts/gen-docs.ts
import fs from 'node:fs';
import { IMPLEMENTATION_STATUS } from '../src/status.js';
import { SERVICES } from '../src/domain/usage.js';
const esc = (s: string) => s.replace(/\|/g, '｜');
fs.writeFileSync('docs/IMPLEMENTATION_STATUS.md', `# 実装済み・未実装・外部条件待ち一覧\n\n（管理画面「実装状況」と同じ内容。src/status.ts から生成）\n\n| 機能 | 状態 | 処理の種類 | 備考 |\n|---|---|---|---|\n${IMPLEMENTATION_STATUS.map((r) => `| ${esc(r.feature)} | ${r.state} | ${r.kind} | ${esc(r.note)} |`).join('\n')}\n`);
fs.writeFileSync('docs/COSTS.md', `# サービス・API・想定コスト一覧\n\n（管理画面「API利用・コスト」と同じ内容。src/domain/usage.ts から生成）\n\n- 取得できない費用は「未計測」とし、0円と断定しません。\n- 既存の ChatGPT 契約の Codex 利用枠は無制限ではありません。\n- 有料サービス・API キー・クレジット購入への自動切替は行いません。\n- 現在の既定構成（AI 無効・模擬送信・架空/CSV データ）で発生する追加料金はありません。\n\n| 名称 | 用途 | 状態 | 認証 | 無料枠・既存契約で使える範囲 | 追加料金が発生する条件 | 公式参照 | 確認日 |\n|---|---|---|---|---|---|---|---|\n${SERVICES.map((x) => `| ${esc(x.name)} | ${esc(x.purpose)} | ${x.status} | ${esc(x.auth)} | ${esc(x.freeScope)} | ${esc(x.paidWhen)} | ${x.officialUrl} | ${x.checkedAt} |`).join('\n')}\n`);
console.log('generated');
