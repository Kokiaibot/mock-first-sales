// 環境チェック: npm run doctor
import { chromium } from 'playwright-core';
import { codexStatus } from '../src/ai/codex.js';
import { claudeStatus } from '../src/ai/claude.js';

const [maj, min] = process.versions.node.split('.').map(Number);
const nodeOk = maj > 22 || (maj === 22 && min >= 13);
console.log(`Node.js ${process.version} … ${nodeOk ? 'OK' : 'NG（22.13 以上が必要。https://nodejs.org/ から LTS をインストール）'}`);

let browser = 'NG';
for (const t of [process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : null, { channel: 'msedge' }, { channel: 'chrome' }].filter(Boolean) as any[]) {
  try {
    const b = await chromium.launch(t);
    browser = `OK（${t.channel ?? t.executablePath} ${b.version()}）`;
    await b.close();
    break;
  } catch {
    /* 次を試す */
  }
}
console.log(`スクリーンショット用ブラウザ … ${browser}${browser === 'NG' ? '（Microsoft Edge か Google Chrome をインストール。無くても動作しますが表示系の分析は「未確認」になります）' : ''}`);

const cl = claudeStatus();
console.log(`Claude Code（任意・AI 推敲） … ${cl.installed ? `インストール済み ${cl.version}${cl.apiKeyInEnv ? '（ANTHROPIC_API_KEY は本アプリから子プロセスに渡しません）' : ''}` : '未インストール（AI 推敲を使わない場合は不要）'}`);
const cx = codexStatus();
console.log(`Codex CLI（任意・代替） … ${cx.installed ? `インストール済み ${cx.version}／ログイン: ${cx.loggedIn}` : '未インストール（AI 推敲を使わない場合は不要）'}`);
process.exit(nodeOk ? 0 : 1);
