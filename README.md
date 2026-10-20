# きろく

単一利用者のための日付別Markdown日記。2026-10-18版の確定要件をもとに、Cloudflare Workers / D1で動作します。Android Chromeを優先し、PC Chromeにも対応します。

2026-10-18に[きろく](https://kiroku.tkymhrt.dpdns.org/)を公開しました。画面とAPIはCloudflare Accessで本人だけに制限しています。[公開記録](docs/deployment.md)に設定・確認結果・残る受入項目をまとめています。

旧workers.dev URLもAccess保護付きで維持しています。下書きはURLごとに端末へ保存されるため、旧URLで編集していた場合は「保存済み」を確認するか、コピー・Markdown保存で退避してから新URLへ移動してください。

## 起動

```powershell
mise install
mise exec -- bun install --frozen-lockfile
mise exec -- bunx void db migrate
mise exec -- bun run dev
```

表示されたローカルURL（通常 `http://127.0.0.1:5173/`）を開きます。データはローカルD1とブラウザIndexedDBへ保存します。**開発モードのloopbackだけ**認証を省略します。開発サーバーを外部公開しないでください。

Void CLIのコマンドはBunから起動し、Nodeを必要とする内部ツールもmiseの指定バージョンを使います。WindowsではVoidが内蔵するSQLiteバイナリを使い、不要な`better-sqlite3`のソースビルドを避けるため、依存スクリプトの許可対象を`package.json`に明記しています。

## 実装

- Void + React + TypeScript、ファイルベースAPI、Cloudflare Workers / D1、Drizzleスキーマ・マイグレーション。
- 日付一覧・今日・日付指定・記録済みの前後移動。日本時間の日付を固定して編集。
- CodeMirror 6、入力補助、元に戻す・やり直す、GFMプレビュー。チェック項目はソース位置で更新。HTML非実行、外部画像はリンク化。
- IndexedDB即時保存と日付別自動同期。永続化した操作ID、期待更新番号、DB復旧世代、日付の不存在トークンで再送・競合・完全削除後の古い新規作成を保護。
- 手動競合解決、ゴミ箱、復元、確認付き完全削除。最新本文コピー・Markdown保存、削除状態を含むJSON一括出力。
- Access JWTの署名・発行者・対象アプリ・有効期限・本人メールを検証。CSRF、no-store、CSP。公開設定が無い場合は拒否。

一覧に本文抜粋は表示しません。添付、検索、Keepインポート、汎用メモ、AI、自動デプロイは含みません。

2026-10-19の改善で、スマートフォン上部のナビを画面の端から端まで3等分し、各項目の全幅を押せるようにしました。日付選択の年・月の余白と曜日の色も揃え、本文のEnter1回をプレビューでも改行表示します。保存・コピー・Markdown出力のソース本文は変更しません。

## 検証

```powershell
mise exec -- bun run lint
mise exec -- bun run format:check
mise exec -- bun run check
mise exec -- bun run test:e2e
mise exec -- python scripts/backup_restore.py self-test --report test-results/local-backup-proof.json
```

`check`はOxlint、Oxfmtの整形チェック、型チェック、Vitest、公式Cloudflare Workers Vitest連携、本番ビルドを実行します。整形を適用するときは `mise exec -- bun run format` を使います。生成済みマイグレーションのメタデータ、Voidのリソースlock、バックアップの検証証跡は整形対象から除外しています。

GitHub Actionsの検証CIはPRとmainへのpushで `check` とローカル復元試験を実行します。Cloudflareの認証情報や本番リソースは使わず、自動デプロイは行いません。

E2Eは別途、インストール済みMicrosoft EdgeをChromiumエンジンとして使い、1440px / 390pxを検証します。Android実機試験とは区別します。テストの架空データは2080年/2081年の予約日付だけに作成し、その日付だけを片付けます。実データを登録した環境では実行しないでください。

2026-10-19に型チェック・単体テスト91件・Workers連携4件・ビルドと、ソース固定後のE2E40件が成功しています。2026-10-18には実D1で1,000,000バイト本文を含むSQLバックアップの復元と、一時DB2件の削除も確認しました。Android実機、別アカウントでの実ログイン拒否、実Access期限切れ、復旧後の端末整合性は未確認です。本番DBを復元試験には使いません。

## 設計・運用資料

- [確定要件と対象範囲](docs/requirements.md)
- [API・同期・競合・データ設計](docs/architecture.md)
- [公開・Access・バックアップ・復旧手順](docs/operations.md)
- [初回公開の設定と検証結果](docs/deployment.md)
- [受入表と未実証項目](docs/verification.md)
- [ローカルテスト結果](docs/local-test-results.md)
- [UI改善とレビュー記録](docs/ui-refinement.md)
- [エラー表示と復旧導線](docs/error-recovery.md)
- [1MBローカル復元の証跡](docs/local-backup-proof.json)
- [1MB実D1復元の証跡](docs/remote-backup-proof.json)

SQLバックアップは破壊的DB変更前に取得し、開発PCの暗号化ストレージで直近3世代を保持します。実D1試験用の`remote-proof`は、本人のCloudflareアカウントに接続してから、架空データの一時DBだけで実行します。トークンをチャットやGitへ貼り付けないでください。

開発用のImpeccableは各端末へ別途導入します。第三者スキル本体、ローカルの日記データ、認証設定、画面検証の画像はGit管理対象外です。Voidのスキルリンクは`void init`がローカルの`node_modules`へ作成します。設計方針は`DESIGN.md`と`PRODUCT.md`に残しています。
