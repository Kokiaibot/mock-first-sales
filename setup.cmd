@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [1/3] Node.js の確認
where node >nul 2>nul || (echo Node.js が見つかりません。https://nodejs.org/ から LTS 版をインストールしてください。& pause & exit /b 1)
echo [2/3] 依存パッケージのインストール（ロックファイル通り）
call npm ci || (echo インストールに失敗しました。& pause & exit /b 1)
echo [3/3] 環境チェック
call npm run doctor
echo.
echo セットアップ完了。start.cmd で起動します。架空データを入れる場合は npm run seed:demo
pause
