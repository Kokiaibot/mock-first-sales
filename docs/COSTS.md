# サービス・API・想定コスト一覧

（管理画面「API利用・コスト」と同じ内容。src/domain/usage.ts から生成）

- 取得できない費用は「未計測」とし、0円と断定しません。
- 既存の ChatGPT 契約の Codex 利用枠は無制限ではありません。
- 有料サービス・API キー・クレジット購入への自動切替は行いません。
- 現在の既定構成（AI 無効・模擬送信・架空/CSV データ）で発生する追加料金はありません。

| 名称 | 用途 | 状態 | 認証 | 無料枠・既存契約で使える範囲 | 追加料金が発生する条件 | 公式参照 | 確認日 |
|---|---|---|---|---|---|---|---|
| Node.js（node:sqlite 含む） | 実行環境・ローカルDB | 使用中 | 不要 | 無料（OSS） | なし | https://nodejs.org/ | 2026-11-08 |
| Hono / @hono/node-server | Webサーバー | 使用中 | 不要 | 無料（MIT） | なし | https://hono.dev/ | 2026-11-08 |
| node-html-parser | HTML解析 | 使用中 | 不要 | 無料（MIT） | なし | https://github.com/taoqf/node-html-parser | 2026-11-08 |
| playwright-core + Microsoft Edge / Chrome | スクリーンショット・表示計測 | 使用中 | 不要 | 無料（Apache-2.0）。ブラウザは PC にインストール済みのものを使用 | なし | https://playwright.dev/ | 2026-11-08 |
| Claude Code（Claude Pro / Max プランでログイン） | 営業文の推敲（任意・承認制）— 既定の AI | 未使用（外部条件待ち） | Claude アカウントでログイン（claude を起動してサインイン） | Claude の Pro / Max プランに含まれる利用枠（Claude と Claude Code で共通の 5 時間枠・週枠）。無制限ではない | 利用上限後に「追加の利用クレジット」を有効にした場合、または API キー（Claude Console）で使った場合。本アプリは ANTHROPIC_API_KEY を子プロセスに渡さず、自動で切り替えない | https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan | 2026-11-08 |
| Codex CLI（ChatGPT ログイン） | 営業文の推敲（任意・承認制）— 代替の AI（ChatGPT 契約がある場合） | 未使用（外部条件待ち） | ChatGPT アカウントでログイン（codex login） | ChatGPT ログイン時は契約プランに含まれる利用枠を消費（時間枠・週枠などの上限あり。無制限ではない） | 利用枠超過後に ChatGPT クレジットを購入した場合、または API キーでログインした場合（トークン従量課金）。本アプリはクレジット購入・API キー利用へ自動で切り替えない | https://developers.openai.com/codex/pricing | 2026-11-08 |
| gBizINFO REST API | 法人情報の検索（企業発見） | 未使用（外部条件待ち） | API トークン（無料の利用申請） | 無料 | なし（利用規約・出典表示に従う） | https://info.gbiz.go.jp/api/index.html | 2026-11-08 |
| 法人番号システム Web-API（国税庁） | 法人番号・商号・所在地の確認 | 未使用（外部条件待ち） | アプリケーション ID（無料の届出） | 無料 | なし（利用規約に従う） | https://www.houjin-bangou.nta.go.jp/webapi/ | 2026-11-08 |
| Google Places API | （不採用） | 未使用（外部条件待ち） | API キー・課金アカウント | — | 従量課金。保存・再利用に制限があり営業リストへの保存用途に適さないため不採用 | https://developers.google.com/maps/documentation/places/web-service/policies | 2026-11-08 |
| SMTP / メール送信サービス | 実送信（未実装） | 未使用（外部条件待ち） | 要（利用者の送信サーバー） | 契約による | 契約による | — | 2026-11-08 |
| 公開ホスティング（Vercel 等） | 外部閲覧可能なプレビュー（未実装・承認後） | 未使用（外部条件待ち） | 要 | 各社の無料枠 | 各社の料金体系による | https://vercel.com/pricing | 2026-11-08 |
| Claude Code（開発作業） | 本アプリの開発作業。完成アプリは AI なしでも全フローが動作 | 開発時のみ | — | — | — | https://claude.com/claude-code | 2026-11-08 |
