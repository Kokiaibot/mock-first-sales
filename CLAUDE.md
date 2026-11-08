# CLAUDE.md

作業を始める前に必ず [AGENTS.md](AGENTS.md) を読み、そのルール（特に「絶対に守ること」の安全性の不変条件）に従ってください。AGENTS.md と矛盾する場合は AGENTS.md を優先します。

## 主要コマンド

```bash
npm ci              # 依存のインストール（package-lock.json 通り）
npm run typecheck   # 型チェック
npm test            # 単体・HTTP 経由の受け入れテスト（Vitest）
npm run e2e         # ブラウザ操作の検証（Chrome/Edge が必要。docs/verification/ に記録）
npm run docs        # docs/IMPLEMENTATION_STATUS.md と docs/COSTS.md を再生成
npm run doctor      # 環境チェック（Node / ブラウザ / AI CLI）
npm start           # http://127.0.0.1:8787/
```

## 要点

- テストや安全チェックを弱めてテストを通さない。
- `data/` と `.env` はコミットしない。
- 外部企業への送信・公開デプロイ・有料サービスの利用をしない。
