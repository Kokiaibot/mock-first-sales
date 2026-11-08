# Windows 11 セットアップ・起動・確認手順

> 検証状況: 本アプリは Linux（Node.js 22.23 / Google Chrome 153）で自動テスト・ブラウザ検証を行いました。**Windows 実機では未検証**です。以下の「Windows で確認していただく項目」を実施してください。

## 1. 必要なもの

| 必要なもの | 確認方法 | 入手先 |
|---|---|---|
| Node.js 22.13 以上（LTS） | PowerShell で `node -v` | https://nodejs.org/ |
| Microsoft Edge（標準搭載）または Google Chrome | `npm run doctor` | — |
| Codex CLI（任意・AI 推敲を使う場合のみ） | `codex --version` | `npm i -g @openai/codex` |

Docker・WSL・Visual Studio Build Tools は不要です（ネイティブビルドが必要な依存を使っていません。DB は Node 組み込みの `node:sqlite`、ブラウザは PC にインストール済みの Edge を使用）。

## 2. インストール

1. ZIP を展開（例: `C:\Users\<you>\mock-first-sales`）。日本語や空白を含まないパスを推奨。
2. `setup.cmd` をダブルクリック。または PowerShell で:

```powershell
cd C:\Users\<you>\mock-first-sales
npm ci
npm run doctor
```

`npm ci` は `package-lock.json` 通りに依存を入れます。Playwright のブラウザダウンロードは発生しません（`playwright-core` を使用）。

## 3. 起動

```powershell
npm start
```

- 管理画面: http://127.0.0.1:8787/ （初回は `/setup` で管理者作成）
- 停止: そのウィンドウで `Ctrl + C`
- `start.cmd` をダブルクリックしても起動し、ブラウザが自動で開きます。
- ポートを変える: `$env:PORT="8788"; npm start`

Windows Defender ファイアウォールの確認が出た場合、本アプリは 127.0.0.1 のみで待ち受けるため「許可しない」で問題ありません。

## 4. 架空データで一通り操作する

```powershell
npm run seed:demo
```

その後、README の「最初の操作」に沿って操作します。

## 5. Windows で確認していただく項目

1. `npm ci` がエラーなく完了する。
2. `npm run doctor` で Node.js OK、ブラウザ OK（msedge）と表示される。
3. `npm test` がすべて成功する（Codex アダプターのテストは Windows ではスキップ）。
4. `npm run e2e` がすべて成功し、`docs\verification\E2E_RESULT.md` が作成される。
5. `npm start` → ブラウザで管理画面を開き、初期設定・ログインできる。
6. 架空企業 3 社が「承認待ち」まで進む（企業詳細の分析結果にスクリーンショットが表示される）。
7. `npm run backup` → `data\backups\backup-...` が作成され、アプリ停止後に `npm run restore -- data\backups\backup-...` で復元できる。

## 6. うまくいかない場合

| 症状 | 対処 |
|---|---|
| `node:sqlite` が見つからない | Node.js が古い。22.13 以上に更新 |
| スクリーンショットが「未確認」になる | `npm run doctor` でブラウザを確認。Edge のパスを `.env` の `BROWSER_PATH` に指定（例: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`） |
| ポート使用中で起動しない | `.env` の `PORT` を変更 |
| 文字化け | `setup.cmd` / `start.cmd` は UTF-8（chcp 65001）。PowerShell 7 の利用を推奨 |
| `codex` が見つからない | AI 推敲を使う場合のみ `npm i -g @openai/codex` → `codex login`（ChatGPT でサインイン） |
| 社内プロキシ環境で `npm ci` が失敗 | `npm config set proxy http://...` / `https-proxy` を設定 |

## 7. データの場所

`data\`（アプリフォルダ内。`.env` の `DATA_DIR` で変更可）

| ファイル | 内容 |
|---|---|
| `app.sqlite` | 企業・分析・モック・承認・送信・ジョブなど全データ |
| `screenshots\` | 分析・モックのスクリーンショット |
| `outbox\` | 模擬送信の EML |
| `secrets.json` | gBizINFO トークンなど（画面に表示しない） |
| `app.key` | セッション・プレビューの署名鍵 |
| `backups\` | バックアップ |
