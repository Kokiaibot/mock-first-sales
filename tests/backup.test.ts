import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeEnv } from './helpers.js';
import { seed } from '../scripts/seed-demo.js';
import { backup } from '../scripts/backup.js';
import { restore } from '../scripts/restore.js';
import { openDb, get, run } from '../src/db.js';

describe('バックアップ・復元', () => {
  it('バックアップから復元でき、復元前データは退避される・秘密情報は既定で含めない', () => {
    const env = makeEnv();
    seed(env.db);
    fs.writeFileSync(path.join(env.dataDir, 'secrets.json'), '{"gbizinfoToken":"secret-value"}');
    const dest = backup(env.dataDir);
    expect(fs.existsSync(path.join(dest, 'app.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'secrets.json'))).toBe(false);
    run(env.db, 'DELETE FROM search_profiles');
    run(env.db, "UPDATE companies SET memo = '変更後'");
    env.db.close();
    const safety = restore(env.dataDir, dest);
    expect(fs.existsSync(path.join(safety, 'app.sqlite'))).toBe(true);
    const db2 = openDb(env.dataDir);
    expect(get(db2, "SELECT COUNT(*) n FROM companies WHERE memo = '変更後'")!.n).toBe(0);
    expect(get(db2, 'SELECT COUNT(*) n FROM companies')!.n).toBe(5);
    db2.close();
  });
  it('バックアップでないフォルダからは復元しない', () => {
    const env = makeEnv();
    expect(() => restore(env.dataDir, env.dataDir + '/screenshots')).toThrow();
  });
});
