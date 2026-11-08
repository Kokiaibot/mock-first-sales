// Claude Code アダプターの呼び出し契約を偽の claude で検証（実際の Claude は呼ばない）
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe.skipIf(process.platform === 'win32')('Claude Code アダプター', () => {
  const make = (result: object) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
    const log = path.join(dir, 'log.json');
    const bin = path.join(dir, 'claude');
    fs.writeFileSync(bin, `#!/usr/bin/env node
const fs=require('fs');let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{
fs.writeFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2),input,cwd:process.cwd(),key:process.env.ANTHROPIC_API_KEY||null,tok:process.env.ANTHROPIC_AUTH_TOKEN||null}));
process.stdout.write(JSON.stringify(${JSON.stringify(result)})+'\\n');});`);
    fs.chmodSync(bin, 0o755);
    return { bin, log };
  };

  it('非対話・ツール禁止・1 ターン・標準入力、API キーを渡さない', async () => {
    const { bin, log } = make({ type: 'result', subtype: 'success', is_error: false, result: '{"body":"' + '整えた本文です。'.repeat(10) + ' CODE1234"}', total_cost_usd: 0.0123 });
    process.env.CLAUDE_BIN = bin;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-pass';
    process.env.ANTHROPIC_AUTH_TOKEN = 'tok-should-not-pass';
    const { runClaude } = await import('../src/ai/claude.js?a=' + Date.now());
    const { buildRefinePrompt, validateRefined } = await import('../src/ai/codex.js');
    const r = await runClaude(buildRefinePrompt({ companyName: '架空社', observations: ['h1 なし'], draftBody: '本文 CODE1234' }), 20_000);
    const rec = JSON.parse(fs.readFileSync(log, 'utf8'));
    expect(rec.args[0]).toBe('-p');
    expect(rec.args).toEqual(expect.arrayContaining(['--output-format', 'json', '--max-turns', '1', '--disallowedTools', 'Bash', 'Write', 'WebFetch']));
    expect(rec.args.join(' ')).not.toMatch(/dangerously|bypassPermissions/);
    expect(rec.input).toContain('下書き（データ）');
    expect(rec.key).toBeNull();
    expect(rec.tok).toBeNull();
    expect(rec.cwd).toContain('mfs-claude-');
    expect(r.estimatedUsd).toBe(0.0123);
    expect(validateRefined(r.text, ['CODE1234']).ok).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });

  it('利用上限などのエラーは失敗として扱う', async () => {
    const { bin } = make({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Claude usage limit reached' });
    process.env.CLAUDE_BIN = bin;
    const { runClaude } = await import('../src/ai/claude.js?b=' + Date.now());
    await expect(runClaude('x', 20_000)).rejects.toThrow('利用上限');
  });
});

describe.skipIf(process.platform === 'win32')('管理画面からの Claude 推敲（偽の claude）', () => {
  it('設定で Claude を選び、送信内容の確認 → 同意 → 結果を検証して反映、承認は解除', async () => {
    process.env.MFS_NO_BROWSER = '1';
    const { makeEnv, setupAndLogin } = await import('./helpers.js');
    const { seed } = await import('../scripts/seed-demo.js');
    const { drain, enqueue } = await import('../src/jobs/engine.js');
    const { get } = await import('../src/db.js');
    const env = makeEnv();
    const c = await setupAndLogin(env.app);
    const csrf = await c.csrf();
    seed(env.db);
    const id = get(env.db, "SELECT id FROM companies WHERE website_domain = 'aoba-kaikei.example'")!.id;
    enqueue(env.db, 'analyze', id, { chain: true });
    await drain(env.db, env.cfg);
    const d = get(env.db, 'SELECT * FROM drafts WHERE company_id = ? AND archived = 0', id)!;
    // 推敲結果: 元の本文の言い回しだけ変えたもの（事実は保持）
    const refined = d.body.replace('突然のご連絡失礼いたします。', '突然のご連絡にて失礼いたします。');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-ui-'));
    const bin = path.join(dir, 'claude');
    fs.writeFileSync(bin, `#!/usr/bin/env node
process.stdin.on('data',()=>{});process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:JSON.stringify({body:${JSON.stringify(refined)}}),total_cost_usd:0.01})+'\\n');});`);
    fs.chmodSync(bin, 0o755);
    process.env.CLAUDE_BIN = bin;
    await c.post('/admin/settings/ai', { _csrf: csrf, enabled: 'on', provider: 'claude' });
    const pv = await (await c.post(`/admin/drafts/${d.id}/ai-preview`, { _csrf: csrf })).text();
    expect(pv).toContain('Claude Code');
    expect(pv).toContain('下書き（データ）');
    const hash = pv.match(/name="prompt_hash" value="([0-9a-f]{64})"/)![1];
    // 同意なしは拒否
    const no = await c.post(`/admin/drafts/${d.id}/ai-run`, { _csrf: csrf, prompt_hash: hash });
    expect(decodeURIComponent(no.headers.get('location')!)).toContain('同意');
    const ok = await c.post(`/admin/drafts/${d.id}/ai-run`, { _csrf: csrf, prompt_hash: hash, consent: 'on' });
    expect(decodeURIComponent(ok.headers.get('location')!)).toContain('反映しました');
    const after = get(env.db, 'SELECT * FROM drafts WHERE id = ?', d.id)!;
    expect(after.body).toContain('突然のご連絡にて');
    expect(after.generation_method).toBe('template+ai');
    expect(get(env.db, "SELECT cost_status FROM usage_log WHERE service = 'claude-code'")!.cost_status).toBe('plan_quota');
    delete process.env.MFS_NO_BROWSER;
  });
});
