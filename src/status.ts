// 実装状況一覧（管理画面と docs/IMPLEMENTATION_STATUS.md の元データ）
export interface StatusRow {
  feature: string;
  state: '実装済み' | '一部実装' | '未実装' | '外部条件待ち' | 'ダミー（デモ）';
  kind: 'ルール' | 'テンプレート' | 'AI（任意・承認制）' | '手動' | '—' | 'ルール＋手動';
  note: string;
}

export const IMPLEMENTATION_STATUS: StatusRow[] = [
  { feature: '初期設定（管理者作成）・ログイン・CSRF', state: '実装済み', kind: '—', note: 'scrypt ハッシュ、ログイン失敗ロック、ローカル接続のみ（既定）' },
  { feature: '検索条件の保存・再表示・ローカル絞り込み', state: '実装済み', kind: 'ルール', note: '都道府県・市区町村・業種・キーワード・最大件数・問い合わせ手段・改善余地・営業済み除外' },
  { feature: 'CSV 取込・出力（数式インジェクション対策）', state: '実装済み', kind: '—', note: '取込時は数式様の値を拒否、出力時は先頭に \' を付与。利用許諾の確認必須' },
  { feature: '重複企業の検出・統合', state: '実装済み', kind: 'ルール', note: '同一ドメイン・正規化企業名。配信停止・営業可否・履歴を保持' },
  { feature: '公式サイト確認（HTTP応答・公式性・取得不能の区別）', state: '実装済み', kind: 'ルール＋手動', note: 'ドメイン一致＋企業名一致で自動確認、それ以外は手動確定' },
  { feature: 'gBizINFO からの企業発見', state: '外部条件待ち', kind: '—', note: 'アダプター実装済み・トークン未取得のため実 API 未検証' },
  { feature: '法人番号 Web-API', state: '未実装', kind: '—', note: 'アプリケーション ID が必要。公式サイトURLを含まないため補助用途' },
  { feature: 'Google Places API', state: '未実装', kind: '—', note: '保存・再利用条件が営業リスト用途に適さないため不採用' },
  { feature: 'サイト分析 7 項目（事実と提案の分離・未確認表示）', state: '実装済み', kind: 'ルール', note: 'HTML 解析＋Playwright 表示計測' },
  { feature: 'PC・スマートフォンのスクリーンショット', state: '実装済み', kind: '—', note: 'PC にインストール済みの Edge/Chrome を使用。未接続時は「未確認」' },
  { feature: 'Lighthouse 実測', state: '未実装', kind: '—', note: '「未計測」と表示。独自スコアは付けない' },
  { feature: 'SSRF 対策（リダイレクト・ブラウザ追加通信含む）', state: '実装済み', kind: '—', note: '名前解決結果の固定、内部 IP 拒否、全リクエストの検査' },
  { feature: '企業別リニューアルモック（3ページ・レスポンシブ）', state: '実装済み', kind: 'テンプレート', note: '業種テンプレート×ブランド色×観察事実×レイアウト変化。架空の実績は生成しない' },
  { feature: 'モックの文章生成', state: '実装済み', kind: 'テンプレート', note: 'サイト記載の事実を再構成。AI は未使用' },
  { feature: 'プレビュー（推測困難URL・閲覧コード・期限・失効・再発行・noindex）', state: '実装済み', kind: '—', note: '管理画面とは別系統の認可' },
  { feature: '既存サイトと改善案の比較', state: '実装済み', kind: '—', note: 'PC/SP 切替' },
  { feature: '外部閲覧可能なプレビュー（公開デプロイ）', state: '外部条件待ち', kind: '—', note: '承認後に実施。PUBLIC_BASE_URL で URL 表示のみ対応' },
  { feature: '営業可否の自動判定（禁止表示の検出）', state: '実装済み', kind: 'ルール', note: '自動判定は「送信不可」または「要確認」のみ' },
  { feature: '営業可否の確定（根拠の記録）', state: '実装済み', kind: '手動', note: '利用者のみ「送信可」にできる' },
  { feature: '個別営業文の作成・品質チェック', state: '実装済み', kind: 'テンプレート', note: '特定電子メール法の表示項目チェック、効果保証表現の禁止' },
  { feature: '営業文の AI 推敲（Codex CLI）', state: '一部実装', kind: 'AI（任意・承認制）', note: '送信内容を表示し同意後に実行。本環境では Codex 未導入のため実行未検証' },
  { feature: '承認（内容ハッシュに紐づけ・変更で自動解除・期限 72 時間）', state: '実装済み', kind: '手動', note: '自動処理・AI は承認しない' },
  { feature: '送信直前の再確認（禁止・拒否・重複・期限）', state: '実装済み', kind: 'ルール', note: '' },
  { feature: 'EML 出力', state: '実装済み', kind: '—', note: '' },
  { feature: '模擬送信', state: '実装済み', kind: '—', note: '外部には送信しない。outbox に EML を保存' },
  { feature: 'フォーム入力計画', state: '実装済み', kind: 'ルール', note: '入力予定値の一覧表示のみ' },
  { feature: 'フォーム自動入力', state: '未実装', kind: '—', note: 'CAPTCHA 回避・自動送信は実装しない方針' },
  { feature: '実送信（SMTP 等）', state: '未実装', kind: '—', note: '設定・接続先・送信内容の承認後に有効化する段階' },
  { feature: '送信結果不明時の「要確認」・自動再送停止', state: '実装済み', kind: '—', note: '' },
  { feature: '配信停止（受信者ページ・手動・リスト）', state: '実装済み', kind: '—', note: '受信者ページは公開URL設定時のみ本文に記載' },
  { feature: '返信・商談・受注管理', state: '実装済み', kind: '手動', note: '自動検知は未実装' },
  { feature: '営業成果分析', state: '実装済み', kind: '—', note: '' },
  { feature: 'API 利用・コスト一覧と利用履歴', state: '実装済み', kind: '—', note: '取得できない費用は「未計測」' },
  { feature: '永続ジョブ（中断・再開・リトライ・Retry-After・再起動復元）', state: '実装済み', kind: '—', note: '' },
  { feature: 'バックアップ・復元', state: '実装済み', kind: '—', note: 'npm run backup / npm run restore' },
  { feature: 'モックのデモ問い合わせフォーム', state: 'ダミー（デモ）', kind: '—', note: '送信・保存しない' },
];
