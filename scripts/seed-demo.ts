// 架空データの投入: npm run seed:demo
// 実在しない企業（RFC 2606 の .example ドメイン）。ネットワーク通信は発生しない。
import { loadConfig } from '../src/config.js';
import { openDb, getSetting, setSetting, type DB } from '../src/db.js';
import { upsertCompany } from '../src/domain/companies.js';
import { EMPTY_SENDER } from '../src/outreach/draft.js';

const LICENSE = '架空データ（検証用）。実在の企業・個人とは関係ありません';

export const DEMO_COMPANIES = [
  { name: '株式会社みなと工務店', prefecture: '神奈川県', city: '横浜市港北区', industry: '工務店', website_url: 'https://minato-koumuten.example/' },
  { name: 'さくら台デンタルクリニック', prefecture: '神奈川県', city: '川崎市中原区', industry: '歯科医院', website_url: 'https://sakuradai-dental.example/' },
  { name: '税理士法人 青葉会計事務所', prefecture: '東京都', city: '世田谷区', industry: '税理士事務所', website_url: 'https://aoba-kaikei.example/' },
  { name: '株式会社ひかり精機', prefecture: '神奈川県', city: '相模原市', industry: '製造業（切削加工）', website_url: 'https://hikari-seiki.example/' },
  { name: '有限会社まるや商店', prefecture: '神奈川県', city: '藤沢市', industry: '小売', website_url: '' },
  // 重複（同一ドメイン・表記ゆれ）→ 統合される
  { name: '（株）みなと工務店', prefecture: '神奈川県', city: '横浜市港北区', industry: '建設', website_url: 'https://www.minato-koumuten.example/' },
];

export function seed(db: DB) {
  const results = DEMO_COMPANIES.map((c) =>
    upsertCompany(db, { ...c, source_name: '架空データ（seed-demo）', source_url: '', source_license: LICENSE, is_fictional: true }, 'seed'),
  );
  const sender = getSetting(db, 'sender', EMPTY_SENDER);
  if (!sender.companyName) {
    setSetting(db, 'sender', {
      companyName: '（架空）デモWeb制作室',
      contactName: '山田 太郎（架空）',
      address: '神奈川県横浜市中区（架空住所）',
      phone: '045-000-0000',
      email: 'sales@demo-studio.example',
      optOutEmail: 'optout@demo-studio.example',
    });
  }
  return results;
}

if (process.argv[1] && /seed-demo/.test(process.argv[1])) {
  const cfg = loadConfig({ startWorker: false });
  const db = openDb(cfg.dataDir);
  const r = seed(db);
  r.forEach((x, i) => console.log(`${DEMO_COMPANIES[i].name}: ${x.action}${x.reason ? ` (${x.reason})` : ''}`));
  console.log('架空データを投入しました。送信者情報は架空の値が入っています（管理画面で変更してください）。');
  db.close();
}
