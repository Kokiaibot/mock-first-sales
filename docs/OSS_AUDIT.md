# sales-claw-ts 監査記録

- 対象: https://github.com/joseikininsight-hue/sales-claw-ts
- 確認コミット: `76b886dc96f03e172d7ad1b29ce7f99cf6fd9391`（2026-10-01、v2.2.0「Claude Code 専用化 + 問い合わせフロー改善…」）
- 確認日: 2026-11-08
- 確認した資料: README.md、AGENTS.md、CLAUDE.md（抜粋）、LICENSE、package.json / package-lock.json、src/ 配下（146 ファイル・約 4.5 万行）、scripts/*.ps1

## 結論

**上流コードはそのまま取り込まず、語彙リストと法令表示チェックの項目構成のみを `src/vendor/sales-claw/` に移植**し、それ以外は独立実装しました。

## 確認結果

| 観点 | 内容 | 判断 |
|---|---|---|
| ライセンス | MIT（Copyright (c) 2025-2026 Sales Claw contributors） | 再利用可。著作権表示を `src/vendor/sales-claw/LICENSE` と `NOTICE` に保持 |
| 実行形態 | Electron アプリ＋node-pty で Claude Code CLI を起動する構成 | Claude 依存かつ Windows でネイティブビルド（node-pty）が必要。不採用 |
| AI 依存 | AGENTS.md に「実行時は Claude Code CLI 専用」と明記。プロンプト群・MCP サーバー（フォーム操作）が Claude 前提 | Codex CLI アダプター（`src/ai/codex.ts`）を独立実装。AI なしで全フローが動く構成に変更 |
| 権限制御 | 起動モード既定が「権限スキップ（yolo / 推奨）」（`src/i18n.ts`） | **取り込まない**。Codex は `--sandbox read-only` 固定 |
| 自動送信 | `sendPolicy=safe-auto-send` で確認画面到達後に送信ボタンを自動クリックする指示（`src/dashboard-server.ts`） | **取り込まない**。送信は利用者の承認後のみ、現状は模擬送信 |
| CAPTCHA | reCAPTCHA v2 のチェックボックスを 1 回クリック試行する指示 | **取り込まない**（CAPTCHA には一切触れない） |
| SSRF | `SALES_CLAW_ALLOW_LOCAL_FORM=1` でローカル宛てを許可するテスト用バイパス | 取り込まない。独自の `src/net/ssrf.ts`（バイパスなし。架空サイトは予約 TLD `.example` の固定ファイルで提供） |
| 外部通信 | gBizINFO・法人番号・EDINET の公式 API、`bing.com/search`（公式サイト推定）、自社サイト | 公式 API は参考にして独立実装（gBizINFO）。検索エンジン結果からの URL 推定は「推測 URL を公式として確定しない」方針に反するため不採用 |
| 依存関係 | `xlsx` を npm ではなく CDN tarball から取得、`npm` 自体を依存に含む、electron-updater | 供給元・更新経路の管理が難しいため不採用。本アプリの依存は 5 パッケージ（＋開発用 3） |
| インストールスクリプト | `scripts/install-latest-win.ps1`：`-ExecutionPolicy Bypass` で UAC 昇格、"Sales Claw" プロセスを強制終了してインストーラを実行 | 不採用。本アプリは `npm ci` のみ |
| 認証情報 | API キーを settings-manager で管理、`spawn-env-sanitizer` で子プロセス環境を整理 | 考え方を参考に、Codex 子プロセスから `OPENAI_API_KEY`/`CODEX_API_KEY` を除去 |
| 保守性 | `dashboard-server.ts` が 12,000 行超の単一ファイル、CommonJS/TS 混在 | 拡張部分の分離が困難なため、上流コードの改変ではなく独立実装を選択 |

## 再利用した部分

| 上流 | 本アプリ | 方法 |
|---|---|---|
| `src/locale-pack/ja/sendability-exclusions.ts`、`src/sendability-gate.ts` の `BUILT_IN_EXCLUSION_PATTERNS` | `src/vendor/sales-claw/exclusion-phrases.ts` | 語彙を正規表現化し、表記ゆれ・広告メール拒否表示を追加 |
| `src/locale-pack/ja/compliance-rules.ts`（特定電子メール法の表示項目） | `src/vendor/sales-claw/compliance-rules.ts` | 項目構成を移植。配信停止表示を必須に変更 |

## 参考にした考え方（コードは独立実装）

- 送信前の「送信可否ゲート」→ `src/domain/eligibility.ts`（自動判定は不可/要確認まで、送信可は人だけ）
- 冪等性キー（`mcp-idempotency.ts`）→ `sends.idempotency_key` の一意制約
- 公式 API クライアントの許可ホスト制限 → `src/sources/gbizinfo.ts`
