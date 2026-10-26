# きろく

本人ひとり向けの日付別Markdown日記です。Android Chromeを優先し、PC Chromeにも対応します。Void + React + TypeScriptで構成し、Cloudflare Workers / D1で動作します。

[アプリを開く](https://kiroku.tkymhrt.dpdns.org/)。画面・API・MCPはCloudflare Accessで本人だけに制限しています。

## できること

- 日付別の編集・一覧・移動、入力補助、Markdownプレビュー。
- IndexedDBへの端末保存とD1への自動同期。未同期本文の退避、手動の競合解決。
- ゴミ箱・復元・確認付き完全削除、本文コピー・Markdown保存・JSON一括出力。
- ChatGPTからのMCP一覧・部分一致検索・原文取得と、本文を変更しない日次要約の保存。

記録日は日本時間で、編集中に日付を自動変更しません。端末保存とサーバー保存は別の状態として表示します。添付、Keepインポート、AIによる原文編集、自動デプロイは対象外です。

## ローカル起動

```powershell
mise install
mise exec -- bun install --frozen-lockfile
mise exec -- bunx void db migrate
mise exec -- bun run dev
```

通常は `http://127.0.0.1:5173/` を開きます。データはローカルD1とブラウザのIndexedDBへ保存します。認証を省略するのは開発モードのloopbackだけです。開発サーバーを外部公開しないでください。

ツール版は `mise.toml`、依存関係は `bun.lock` に従います。Windowsでは内部ツール用のNodeも含め、`mise exec --` から実行します。Vite+はプロジェクト内の依存として使うため、グローバルインストールは不要です。

| 管理するもの                           | 設定・ツール                                                                |
| -------------------------------------- | --------------------------------------------------------------------------- |
| Node・Bun・Pythonの版                  | `mise.toml`                                                                 |
| 依存関係                               | Bun・`package.json`・`bun.lock`                                             |
| 開発・ビルド・単体・Lint・整形・型検査 | Vite+・`vite.config.mts`。Workers連携だけ `server/vitest.workers.config.ts` |
| 型生成・migration・Cloudflare公開      | Void・`void.config.ts`・`void.lock.json`                                    |

Vite+の[公式手動導入手順](https://viteplus.dev/guide/local-cli)に従い、`vite` aliasをVite+と同じ版、`vitest` overrideを同梱版に固定しています。更新時は `mise exec -- bunx --no-install vp migrate` で揃え、`vp toolchain` と `bun run check` を確認します。Voidも[Vite+を標準選択肢](https://void.cloud/guide/quickstart)にしています。

## 検証

```powershell
mise exec -- bun run check
mise exec -- python scripts/backup_restore.py self-test --report test-results/local-backup-proof.json
```

`check` はVoidの型生成後、Vite+でLint・整形チェック・型検査・単体・Workers連携・ビルドを実行します。整形の適用は `mise exec -- bun run format`。Vite+の `vp check` 単独は静的検査だけで、単体やビルドを含む全検証には `bun run check` を使います。CIも検証とローカル復元試験だけを行います。

普段のビルドはキャッシュを標準利用します。エージェントの反復作業でも次を使います。

```powershell
mise exec -- bun run build
```

内部では `vp run cached-build` を使います。入力が同じなら `dist/` を復元し、入力が変わった・キャッシュがない場合は通常ビルドして成功結果を保存します。キャッシュ保存の対象外になってもビルド自体は実行されます。ビルド本体の失敗はそのまま失敗として扱います。

Void生成物を入力から除外するタスクを `vite.config.mts` に定義しています。ソース・設定・lock・環境変数は[Vite+の自動追跡](https://viteplus.dev/guide/automatic-data-tracking)に任せ、キャッシュは `node_modules/.vite/task-cache` に置きます。`check` 内のビルドも同じキャッシュを使い、静的検査・単体・Workers連携は毎回実行します。強制再ビルドは `mise exec -- bun run build:fresh`。手動公開時のビルドはVoidに任せます。CIへのキャッシュ転送は、保存・復元の時間もかかる[実験的な機能](https://viteplus.dev/guide/github-actions-cache)のため追加していません。

E2Eは別途 `mise exec -- bun run test:e2e` を使います。既存の `127.0.0.1:5173` を再利用し、Edgeで2080年/2081年の架空データを作成・削除します。実データのある環境では実行しないでください。Android実機の確認とは区別します。

## 文書の案内

| 知りたいこと                     | 参照先                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 機能・対象範囲                   | [要件](docs/requirements.md)                                                                                |
| API・同期・データ構造            | [設計](docs/architecture.md)                                                                                |
| UI方針・見た目                   | [PRODUCT.md](PRODUCT.md)・[DESIGN.md](DESIGN.md)                                                            |
| エラー表示・本文の退避           | [復旧導線](docs/error-recovery.md)                                                                          |
| 公開・認証・バックアップ・DB復旧 | [運用手順](docs/operations.md)                                                                              |
| MCP接続・日次タスク              | [MCP運用](docs/mcp-operations.md)                                                                           |
| 確認済み範囲・残る受入項目       | [受入表](docs/verification.md)・[MCP検証](docs/mcp-verification.md)                                         |
| 公開・テスト・UI変更の記録       | [公開記録](docs/deployment.md)・[ローカル検証](docs/local-test-results.md)・[UI変更](docs/ui-refinement.md) |

Android実機、別アカウントでの拒否、実Access期限切れ、DB復旧後の端末整合性は未確認です。MCPは初回CPU超過と実行時刻の不一致が残ります。成功した試験の範囲は受入表で確認してください。

旧workers.dev URLの下書きは新URLへ自動移行されません。旧URLで「保存済み」を確認するか、コピー・Markdown保存で退避してから移動してください。

SQLバックアップは破壊的DB変更前に取得し、開発PCの暗号化ストレージで直近3世代を保管します。認証情報・日記データ・開発用スキル本体はGitに含めません。Voidのローカルスキルリンクは `void init`、Impeccableなどの開発用スキルは端末ごとに導入します。
