// モック画面の撮影（PC / スマートフォン）— 既存サイトとの比較表示用
import { type DB, run, nowIso, get } from '../db.js';
import type { AppConfig } from '../config.js';
import path from 'node:path';
import { captureHtml } from '../analysis/browser.js';
import { currentMock, mockSpec } from './service.js';
import { renderMock } from './render.js';
import { randomToken } from '../util/crypto.js';

export async function captureMockShots(db: DB, cfg: AppConfig, companyId: number): Promise<number> {
  const m = currentMock(db, companyId);
  if (!m) return 0;
  const exists = get(db, "SELECT COUNT(*) n FROM screenshots WHERE company_id = ? AND kind IN ('mock_pc','mock_sp') AND source_url = ?", companyId, `mock:${m.id}`);
  if (exists && exists.n >= 2) return 0;
  const spec = mockSpec(m);
  const htmlStr = renderMock(spec, 'index', { base: '#', audience: 'admin' });
  let n = 0;
  for (const kind of ['pc', 'sp'] as const) {
    const file = `${randomToken(12)}.png`;
    const ok = await captureHtml(htmlStr, kind, path.join(cfg.dataDir, 'screenshots'), file);
    if (!ok) return n;
    run(db, 'INSERT INTO screenshots (company_id, kind, file_name, source_url, width, created_at) VALUES (?,?,?,?,?,?)', companyId, `mock_${kind}`, file, `mock:${m.id}`, kind === 'pc' ? 1366 : 390, nowIso());
    n++;
  }
  return n;
}
