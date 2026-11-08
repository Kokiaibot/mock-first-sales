// Claude Code CLI アダプター（任意機能）。
// - Claude の Pro / Max プランでログイン済みの `claude` を、非対話モード（claude -p）で 1 回だけ呼ぶ
// - ツールは使わせない（ファイル操作・コマンド実行・Web 取得を禁止）。権限スキップ系オプションは使わない
// - ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN を子プロセスへ渡さない＝API 従量課金へ自動で切り替えない
// - プロンプトは標準入力で渡し、出力は信頼できない入力として検証してから採用する
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ClaudeStatus {
  installed: boolean;
  version: string;
  apiKeyInEnv: boolean;
  detail: string;
}

const isWin = process.platform === 'win32';
const bin = () => process.env.CLAUDE_BIN || 'claude';

/** 使わせないツール（推敲に不要なものをすべて禁止） */
export const DISALLOWED_TOOLS = ['Bash', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite'];

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDE_CODE_USE_BEDROCK;
  delete env.CLAUDE_CODE_USE_VERTEX;
  return env;
}

export function claudeStatus(): ClaudeStatus {
  const apiKeyInEnv = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  try {
    const v = spawnSync(bin(), ['--version'], { encoding: 'utf8', timeout: 15_000, shell: isWin, env: childEnv() });
    if (v.status !== 0) return { installed: false, version: '', apiKeyInEnv, detail: 'claude コマンドが見つかりません（Claude Code をインストールし、claude を起動して Pro/Max プランでログイン）' };
    return {
      installed: true,
      version: (v.stdout || '').trim(),
      apiKeyInEnv,
      detail: apiKeyInEnv
        ? 'PC に ANTHROPIC_API_KEY が設定されています。本アプリは子プロセスに渡さないため、プランの利用枠で実行されます'
        : 'ログイン状態は実行時に確認されます（未ログインならエラーになります）',
    };
  } catch (e) {
    return { installed: false, version: '', apiKeyInEnv, detail: String((e as Error).message) };
  }
}

export interface ClaudeResult {
  text: string;
  /** Claude Code が出力する API 換算の推定額（サブスク利用時は請求額ではない） */
  estimatedUsd: number | null;
}

export async function runClaude(prompt: string, timeoutMs = 180_000): Promise<ClaudeResult> {
  // 空の一時ディレクトリで実行（プロジェクトのファイル・設定を読ませない）
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfs-claude-'));
  try {
    const args = ['-p', '--output-format', 'json', '--max-turns', '1', '--strict-mcp-config', '--disallowedTools', ...DISALLOWED_TOOLS];
    const out = await new Promise<string>((resolve, reject) => {
      const p = spawn(bin(), args, { shell: isWin, env: childEnv(), cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      p.stdout.on('data', (d) => (stdout += d));
      p.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
      const t = setTimeout(() => {
        p.kill();
        reject(new Error('Claude Code の応答がタイムアウトしました'));
      }, timeoutMs);
      p.on('error', (e) => (clearTimeout(t), reject(e)));
      p.on('close', (code) => {
        clearTimeout(t);
        if (code === 0) resolve(stdout);
        else reject(new Error(`claude -p が終了コード ${code} で失敗: ${(stderr || stdout).split('\n').slice(-3).join(' ')}`));
      });
      p.stdin.end(prompt);
    });
    let parsed: any;
    try {
      parsed = JSON.parse(out.trim().split('\n').filter(Boolean).at(-1) ?? '');
    } catch {
      throw new Error('Claude Code の出力（JSON）を解析できませんでした');
    }
    if (parsed.is_error || parsed.subtype?.startsWith?.('error')) {
      const msg = String(parsed.result ?? parsed.subtype ?? '');
      throw new Error(/limit|usage/i.test(msg) ? `プランの利用上限に達した可能性があります: ${msg}` : `Claude Code がエラーを返しました: ${msg}`);
    }
    return { text: String(parsed.result ?? ''), estimatedUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : null };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
