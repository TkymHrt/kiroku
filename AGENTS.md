<!--injected-by-void-v1.1.11-->

## Void

- This project uses [Void](https://void.cloud), a full-stack Vite framework for Cloudflare Workers with file-based API routing, server-rendered pages, and typed backend services.
- Use Void's CLI and typed APIs. Before working with Void, read the relevant Markdown docs in `node_modules/void/docs/`; start with `guide/quickstart.md` for setup and `reference/cli.md` for commands.

<!--/injected-by-void-->

## プロジェクトと参照先

きろくは本人ひとり向けの日付別Markdown日記。Android Chromeを優先し、PC Chromeにも対応する。ブラウザ側は `src/`、API入口は `routes/api/`、永続化・認証・入力検証は `server/` にある。

- 機能・対象範囲を変えるときは `docs/requirements.md`。自動デプロイ・常設クラウド検証環境・有料化は現行範囲外。
- API・同期・データ構造を扱うときは `docs/architecture.md`。通信型は `src/lib/types.ts`、スキーマは `db/schema.ts`、適用SQLは `db/migrations/`。
- UIを変えるときは `PRODUCT.md` と `DESIGN.md`、エラーや復旧導線は `docs/error-recovery.md`。
- 公開・Access・バックアップ・DB復旧は `docs/operations.md`。実証済み範囲と残る受入項目は `docs/verification.md`。

## 開発と検証

ツール版は `mise.toml`、依存関係は `bun.lock` に従い、Bunを使う。初回セットアップと起動は `README.md`。Windowsでは `mise exec --` を付け、内部ツール用のNodeも指定版を使う。

変更に応じて次から選ぶ。`check` はLint・整形チェック・型検査・単体・Workers連携・ビルドの一括実行で、E2Eは含まない。

| 目的                                                | コマンド                            |
| --------------------------------------------------- | ----------------------------------- |
| Lint（Oxlint）                                      | `mise exec -- bun run lint`         |
| 整形チェック（Oxfmt）                               | `mise exec -- bun run format:check` |
| 整形を適用                                          | `mise exec -- bun run format`       |
| 型検査・Void生成物更新                              | `mise exec -- bun run typecheck`    |
| 単体・Miniflareテスト（末尾に対象ファイルを指定可） | `mise exec -- bun run test`         |
| Workersランタイム連携                               | `mise exec -- bun run test:workers` |
| 本番ビルド                                          | `mise exec -- bun run build`        |
| ブラウザ操作                                        | `mise exec -- bun run test:e2e`     |
| 一括検証                                            | `mise exec -- bun run check`        |

- 検証CIは `.github/workflows/ci.yml`。PR・mainへのpushで `check` とローカル復元試験を実行する。本番の認証情報・リソースは使わず、自動デプロイは行わない。
- E2Eは既存の `127.0.0.1:5173` サーバーを再利用し、2080年/2081年の予約日付を作成・削除する。実データのある環境では実行しない。Microsoft Edgeを使うローカル試験であり、Android実機や本番Accessの実証とは区別する。
- DB構造・復元処理を変えた場合は `mise exec -- python scripts/backup_restore.py self-test --report test-results/local-backup-proof.json` でローカル復元経路も確認する。実D1の試験は `docs/operations.md` に従い、架空データの一時DBだけを使う。
- `.void/`、`.void-wrangler.jsonc`、`dist/` は生成物。型生成は `bun run prepare` / `typecheck` で行い、直接編集しない。Voidの設定・リソース識別情報は `void.config.ts` と `void.lock.json` で管理する。

## 本文と運用の境界

- 記録日はAsia/Tokyoの `YYYY-MM-DD`、作成・更新時刻はUTC。日付をまたいでも編集中の対象日を自動変更しない。
- 端末保存とD1保存を区別する。認証切れ・競合・保存失敗でも本文と未同期下書きを保持し、コピー・Markdown退避を使える状態にする。競合を自動上書きで解消しない。
- 同期の `mutationId`・期待version・epoch・`absenceToken` は、再送や完全削除後の再作成を防ぐ契約。送信前に固定した操作を再送時に変更しない。`mutation_receipts` を期限削除せず、receiptと本文変更の同一batch、および `server/database.ts` のprimary優先照合を維持する。
- 認証省略は開発モードのloopbackだけ。開発サーバーを外部公開しない。公開環境はAccess設定不足時も拒否し、Worker側のJWT・本人照合を省略しない。実データの本文・認証情報をURL、ログ、診断コピー、Gitへ含めない。
- Markdownソースを本文の正とする。プレビューから本文を再生成せず、生HTMLを実行せず、外部画像を自動取得しない。
- スキーマ変更はVoidでmigrationを生成・レビューし、別CLIで重複管理しない。破壊的DB変更前はSQLバックアップを取得する。復元試験で本番DBを上書きせず、DB復旧後は書込再開前に `database_epoch` を回転する。具体的な対象確認・退避・復旧手順は `docs/operations.md` に従う。
