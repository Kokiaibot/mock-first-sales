# vendor/sales-claw

以下は sales-claw-ts（MIT License）から取り込んだ／参考にした部分です。

- 取得元: https://github.com/joseikininsight-hue/sales-claw-ts
- 確認コミット: 76b886dc96f03e172d7ad1b29ce7f99cf6fd9391（2026-10-01, v2.2.0）
- 取り込み内容:
  - `exclusion-phrases.ts`: `src/locale-pack/ja/sendability-exclusions.ts` と
    `src/sendability-gate.ts` の BUILT_IN_EXCLUSION_PATTERNS の語彙を正規表現化し拡張。
  - `compliance-rules.ts`: `src/locale-pack/ja/compliance-rules.ts` の特定電子メール法表示チェック項目の構成を移植。
- 上流コード本体（Electron / node-pty / Claude Code CLI 前提部分）は取り込んでいません。理由は docs/OSS_AUDIT.md。

著作権表示は同ディレクトリの LICENSE を参照してください。
