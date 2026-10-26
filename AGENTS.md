<!--injected-by-void-v1.1.11-->

## Void

- This project uses [Void](https://void.cloud), a full-stack Vite framework for Cloudflare Workers with file-based API routing, server-rendered pages, and typed backend services.
- Use Void's CLI and typed APIs. Before working with Void, read the relevant Markdown docs in `node_modules/void/docs/`; start with `guide/quickstart.md` for setup and `reference/cli.md` for commands.

<!--/injected-by-void-->

## プロジェクトと参照先

きろくは本人ひとり向けの日付別Markdown日記。Android Chrome優先、PC Chrome対応。画面は `src/`、ブラウザAPIは `routes/api/`、MCPは `routes/mcp.ts`、永続化・認証・検証は `server/`。

| 作業                           | 参照先                                                               |
| ------------------------------ | -------------------------------------------------------------------- |
| 機能・範囲                     | docs/requirements.md                                                 |
| API・同期・DB                  | docs/architecture.md、src/lib/types.ts、db/schema.ts、db/migrations/ |
| UI・復旧導線                   | PRODUCT.md、DESIGN.md、docs/error-recovery.md                        |
| 公開・認証・バックアップ・復旧 | docs/operations.md、MCPはdocs/mcp-operations.md                      |
| 受入・実証範囲                 | docs/verification.md、docs/mcp-verification.md                       |

## 開発と検証

ツールはmise.toml、依存関係はbun.lockに従いBunを使う。開発・検証・buildはローカルVite+、型生成・DB・公開はVoid。Windowsでは内部ツール用Nodeも指定版を使い、コマンドに `mise exec --` を付ける。初回起動はREADME.md。

- `bun run check` はVoidの型生成、Vite+のLint・整形チェック・型、単体・Workers連携・build。`vp check` 単独は静的検査のみ。設定はvite.config.mtsへ集約し、Workers連携だけserver/vitest.workers.config.tsを使う。個別実行はpackage.jsonのscripts、整形適用は `bun run format`。
- エージェントの反復ビルドは `bun run build` を使う。vite.config.mtsのcached-buildタスクでキャッシュを標準利用し、入力変更やキャッシュなしでは通常ビルドする。Void生成物を入力から除きdistだけを復元する。`check` 内のbuildも同じ。強制再ビルドが必要な場合だけ `bun run build:fresh` を使う。静的検査・単体・Workers連携は毎回実行し、deployのbuildはVoidに任せる。Vite+更新時はvite aliasと同梱vitestのoverrideを揃える。
- E2Eは `bun run test:e2e` で別実行。既存127.0.0.1:5173を使い、2080年/2081年の予約日付を作成・削除する。実データのある環境では実行しない。Edgeのローカル試験をAndroid/本番Accessの実証にしない。
- DB構造・復元変更時は `mise exec -- python scripts/backup_restore.py self-test --report test-results/local-backup-proof.json`。実D1試験は運用手順に従い、架空データの一時DBだけを使う。
- CIはPR/main pushでcheckとローカル復元を実行する。自動デプロイ・常設クラウド検証・有料化は対象外。
- `.void/`・`.void-wrangler.jsonc`・`dist/` は生成物で直接編集しない。型生成はprepare/typecheck、設定とidentityはvoid.config.ts・void.lock.jsonで管理する。

## 本文と運用の条件

- 記録日はAsia/TokyoのYYYY-MM-DD、時刻はUTC。日付をまたいでも編集中の対象日を自動変更しない。
- 端末保存とD1保存を区別する。認証切れ・競合・保存失敗でも本文と未同期下書き、コピー・Markdown退避を保持する。競合は自動上書きしない。
- mutationId・期待version・epoch・absenceTokenを維持し、送信前に固定した操作を再送時に変えない。receiptを期限削除せず、変更と同一batchにする。server/database.tsのprimary優先照合を維持する。
- 要約は本文と別管理し、原文を変更しない。MCPの取得上限・本人認証・全文取得後の条件付き保存を維持する。
- 認証省略は開発モードのloopbackだけ。開発サーバーを外部公開しない。公開設定不足は拒否し、WorkerのJWT/本人照合を省略しない。実本文・認証情報をURL・ログ・診断コピー・Gitへ含めない。
- Markdownソースを本文の正とし、プレビューから再生成しない。生HTMLを実行せず、外部画像を自動取得しない。
- migrationはVoidで生成・レビューする。破壊的DB変更前はSQL退避し、復元試験で本番を上書きしない。DB復旧後は書込再開前にdatabase_epochを回転する。対象確認・退避・復旧は運用手順に従う。
