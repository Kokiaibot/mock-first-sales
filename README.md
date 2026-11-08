# モック先出し営業支援システム（mock-first-sales）

地域・業種で絞った「公式Webサイトを持つ企業」について、既存サイトを分析し、その企業向けのリニューアル試作（モック）と個別の営業文を用意して、**利用者が確認・承認するまで送信しない**ローカル Web アプリです。

```
候補登録 → 分析（7項目・証拠付き） → 営業可否の自動判定 → 個別モック生成 → 個別営業文 → 承認待ち
   → 利用者が根拠を確認して承認 → 模擬送信（EML 出力） → 送信履歴 → 返信・商談・受注を記録
```

- 管理画面は日本語。データはすべてこの PC 内（`data/`）に保存します。
- 既定ではローカル接続（127.0.0.1）のみ受け付けます。
- AI なしで全フローが動きます（分析＝ルール、モック・営業文＝テンプレート）。AI は営業文の推敲だけに任意・承認制で使えます。既定は **Claude Code（Claude の Pro / Max プラン）**、ChatGPT 契約がある場合は Codex CLI にも切り替えられます。
- 送信は現在 **模擬送信のみ**（外部には一切送信しません）。実送信は未実装です。

## Windows でのセットアップと起動

前提: **Node.js 22.13 以上（LTS 推奨）**、Microsoft Edge（Windows 11 に標準搭載。スクリーンショットに使用）。Docker・WSL は不要です。

1. Node.js をインストール（https://nodejs.org/ の LTS 版）。
2. このフォルダを任意の場所に展開（例: `C:\Users\<you>\mock-first-sales`）。
3. `setup.cmd` をダブルクリック（`npm ci` と環境チェック `npm run doctor` を実行）。
4. `start.cmd` をダブルクリック → ブラウザで **http://127.0.0.1:8787/** が開きます。
5. 初回は「初期設定」画面で管理者アカウントを作成し、ログインします。

PowerShell で操作する場合:

```powershell
cd C:\Users\<you>\mock-first-sales
npm ci
npm run doctor        # Node / ブラウザ / Claude Code の確認
npm run seed:demo     # 架空企業 6 件（うち除外 2・重複 1）と架空の送信者情報を投入（任意）
npm start             # http://127.0.0.1:8787/
```

> **Windows 実機での動作は未検証です。** 開発・検証は Linux（Node 22.23 / Google Chrome）で行いました。Windows で最初に確認していただきたい手順は [docs/SETUP_WINDOWS.md](docs/SETUP_WINDOWS.md) にあります。

## 最初の操作（架空企業 3 社で完走）

1. `npm run seed:demo` を実行（または「CSV 取込・出力」画面で CSV を取り込む）。
2. 「送信者情報・連携設定」で会社名・氏名・住所・メールを正しい値に変更。
3. 「候補企業一覧」で企業を選択 →「分析→モック→営業文まで処理」。
4. 「ジョブ・エラー」で完了を確認（自動更新）。
5. 各企業の詳細で「分析結果・証拠」「プレビュー・比較」「営業文」を確認。
6. 「送信承認キュー」に 3 社が「承認待ち」で並べば最初の到達目標です。
7. 送信する場合は、企業詳細で**営業可否を根拠付きで確認・記録** → モックを「確認済み」→ 承認 → 模擬送信。

## 主なコマンド

| コマンド | 内容 |
|---|---|
| `npm start` | アプリ起動（http://127.0.0.1:8787/） |
| `npm run seed:demo` | 架空データ投入 |
| `npm test` | 自動テスト（Vitest） |
| `npm run e2e` | ブラウザ操作による受け入れ検証（docs/verification/ に記録） |
| `npm run backup` | バックアップ（`-- --include-secrets` で秘密情報も含める） |
| `npm run restore -- <フォルダ>` | 復元（アプリ停止中に実行。復元前データは自動退避） |
| `npm run doctor` | 環境チェック |
| `npm run typecheck` | 型チェック |

## AI（Claude プラン）を使う場合

1. Claude Code をインストールし、PowerShell で `claude` を一度起動して **Pro / Max プランのアカウント**でログイン（Claude Console のアカウントは選ばない）。
2. 管理画面「送信者情報・連携設定」→ AI 連携を有効化、「Claude Code」を選択。
3. 営業文の画面で「送信内容を確認する」→ 送信される全文を確認して同意 → 推敲結果は事実（URL・閲覧コード・署名・配信停止）が保たれている場合だけ反映。

- 利用枠は Claude（チャット）と Claude Code で共通です。上限に達した場合はエラーとして表示し、追加クレジットや API キーには切り替えません。
- PC に `ANTHROPIC_API_KEY` が設定されていても、本アプリは子プロセスに渡しません（API 従量課金を避けるため）。

## 設定

`.env.example` を `.env` にコピーして編集できます（ポート、データ保存先、公開URL、並列数、ブラウザのパス）。API キーやトークンは `.env` やチャットに書かず、管理画面の「送信者情報・連携設定」から入力してください（`data/secrets.json` に保存され、画面・ログには表示されません）。

## ドキュメント

| 文書 | 内容 |
|---|---|
| [docs/SETUP_WINDOWS.md](docs/SETUP_WINDOWS.md) | Windows セットアップ・起動・確認手順、トラブル時の対処 |
| [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) | 実装済み・未実装・外部条件待ち |
| [docs/COSTS.md](docs/COSTS.md) | サービス・API・想定コスト |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 技術選定と重要な判断 |
| [docs/OSS_AUDIT.md](docs/OSS_AUDIT.md) | sales-claw-ts の監査記録・再利用範囲 |
| [docs/SECURITY.md](docs/SECURITY.md) | 認証・データ保護・送信制御 |
| [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) | データソースの採否・利用条件 |
| [docs/BACKUP.md](docs/BACKUP.md) | バックアップ・復元 |
| [docs/PRODUCTION.md](docs/PRODUCTION.md) | 受注後の本制作への引き継ぎ |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 外部閲覧プレビュー（承認後の作業） |
| [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md) | 自動テスト・ブラウザ検証の結果 |
| [AGENTS.md](AGENTS.md) | AI コーディングエージェント向けの作業ルール |

## 注意

- 本アプリの法令表示チェック（特定電子メール法の表示項目など）は補助機能であり、法令適合を保証しません。送信の最終判断と責任は利用者にあります。
- Google Maps の一括取得、CAPTCHA 回避、403/429 等のアクセス制限の回避、承認なしの送信は実装していません。
- `data/` には顧客データ・認証情報・画像が保存されます。Git には含めず、共有しないでください。

ライセンス表示: [NOTICE](NOTICE)
