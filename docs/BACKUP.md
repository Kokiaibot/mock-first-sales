# バックアップ・復元

## バックアップ
```powershell
npm run backup                         # 秘密情報（secrets.json / app.key）を除く
npm run backup -- --include-secrets    # 秘密情報も含める（保管場所に注意）
```
`data\backups\backup-YYYYMMDD-HHMMSS\` に以下を作成します。アプリ起動中でも実行できます（SQLite の `VACUUM INTO` で整合性のあるスナップショット）。

- `app.sqlite`、`screenshots\`、`outbox\`、`BACKUP_INFO.json`

バックアップには顧客データが含まれます。外付けドライブ等へ保存する場合は暗号化（BitLocker To Go 等）を推奨します。

## 復元
1. アプリを停止（`Ctrl + C`）。
2. 実行:
```powershell
npm run restore -- data\backups\backup-20261108-221500
```
- DB の整合性チェック後に復元します。
- 復元前の現在データは自動で新しいバックアップ（秘密情報込み）に退避されます。
- バックアップに `app.key` が含まれない場合、現在の鍵がそのまま使われます（既存のプレビュー Cookie・ログインは影響を受けません）。

## 別 PC への移行
アプリフォルダを展開して `npm ci` → `data\` フォルダごとコピー（またはバックアップを `--include-secrets` で作成して復元）。
