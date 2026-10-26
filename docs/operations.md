# 開発・公開・復旧手順

公開先は [きろく](https://kiroku.tkymhrt.dpdns.org/)。公開履歴は [deployment.md](deployment.md)、受入状況は [verification.md](verification.md)、MCPの認証・日次処理は [mcp-operations.md](mcp-operations.md) を参照する。

## ローカル開発

初回起動は [README](../README.md#ローカル起動) を使う。miseでツール版、Bunで依存関係、Vite+で開発・検証・ビルド、Voidで型生成・DB・公開を管理する。Windowsでは `mise exec --` を付ける。開発はローカルD1を使い、本番の接続情報を使わない。

```powershell
mise exec -- bunx void db generate
mise exec -- bunx void db migrate
mise exec -- bun run check
```

schema変更時はVoidでmigrationを生成し、SQLをレビューしてから適用する。複数CLIでschemaを管理しない。E2Eは架空データだけの環境で別途実行する。DB構造・復元処理を変えたら次も実行する。

```powershell
mise exec -- python scripts/backup_restore.py self-test --report test-results/local-backup-proof.json
```

この試験は空SQLiteに1,000,000バイト本文・空本文・ゴミ箱・履歴を作り、SQL復元、分割パラメータ復元、全表digest/本文SHA-256、外部キー、epoch回転を確認する。実D1試験ではない。本文は一時領域から終了時に削除し、本文を含まないJSONだけを残す。

PR・mainへのpushで `.github/workflows/ci.yml` が `check` とローカル復元試験を実行する。E2E・実Cloudflare試験・デプロイはCIに含めず、本番の認証情報やリソースを使わない。

## Accessの初回設定

1. 本人のCloudflareアカウントにMFAを設定する。Zero TrustにCloudflare IdPを追加し、アカウントメンバー限定を有効にする。
2. self-hosted Accessアプリのworker destinationで、画面・API・静的ファイル・内部経路を含むWorker全経路を保護する。Allowは本人メールだけのInclude、Cloudflare IdPのRequireとする。メンバー全体の許可、Bypass/Everyone、広いAllowを残さない。
3. Application/Policy sessionは168時間。初回公開では共通Global sessionを変更していない。変更の要否は他アプリへの影響を調べてから決める。Cloudflare One Clientを使う場合はそちらのsessionが優先し得る。
4. AUDをACCESS_AUD、team domainをACCESS_TEAM_DOMAIN、本人メールをACCESS_EMAILへ登録する。例は `access.env.example`。ローカル設定は単一の `.env` を使い、パスワード/API tokenをアプリへ渡さない。
5. WorkerでもJWTの署名・iss・aud・有効期限・本人emailを照合する。JWKSはteamの `/cdn-cgi/access/certs`。ヘッダーの存在だけで許可しない。
6. workers.devや別ルートも保護し、preview URLを無効にする。公開口は `void.config.ts` / `void.lock.json` で管理する。

参考: [WorkersのAccess保護](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)、[session](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)、[JWT検証](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)。

期限切れでは401/403以外にログインHTMLへのredirectもあり得る。下書きを残して同期を止め、再認証後にversion/epochを読み直す。短いsessionで試験した場合は168時間へ戻す。実期限切れ・ログアウト後のタブ/戻る操作/API拒否は受入表で確認する。

## 手動公開

型・必要テスト・migrationレビュー後、確認結果を受入表へ記録する。実データの利用開始前には残るAndroid実機・別アカウント拒否・実Access期限切れ等を確認する。

別端末での初回接続だけ `mise exec -- bunx void connect --platform cloudflare` を実行する。以後は次のコマンドを使う。

```powershell
mise exec -- bunx void deploy --platform cloudflare
```

Voidがbuild・リソース・migration・deployを管理する。通常の開発・公開にcf CLIやWranglerの直接実行は不要。生成物を直接編集せず、設定とlockの差分を管理する。常設クラウド検証環境は作らず、課金が必要な選択肢は有効化前に本人へ確認する。

Access保護後のreadiness確認は次の手順を使う。

1. 公開時だけ、Cloudflare公式の `cloudflared access token --app=https://kiroku.23-h-takayama-nutfes.workers.dev` で本人セッションを取得する。標準出力のJWTは表示せず変数へ受け取る。未認証ならブラウザで本人認証する。これはVoidのCloudflareアカウント認証とは別。
2. 短期JWTを当該deployプロセスだけのCF_ACCESS_TOKENへ渡す。preview無効の構成では送信先確認用に `CLOUDFLARE_WORKERS_SUBDOMAIN=23-h-takayama-nutfes` も同じプロセスへ渡す。
3. 終了後は成功・失敗にかかわらずトークンを環境変数から除く。引数・Git・ログへ記録しない。readiness失敗をAccess policyの緩和やpreview有効化で回避しない。

SQL退避・分割復元は下記の既存スクリプトを使う。Voidの `db export` はローカル用で、リモート退避の代用にしない。Time TravelはVoidの `db restore`、Access policy・復旧用D1作成はCloudflare管理画面で対象を確認して行う。[VoidのCloudflare連携](https://void.cloud/integrations/cloudflare)・[DBコマンド](https://void.cloud/reference/cli/database)・[AccessのCLI認証](https://developers.cloudflare.com/cloudflare-one/tutorials/cli/) を参照する。

実DB名・保存先・local/remoteを確認する。観測ログは無効にし、公開後は匿名拒否・本人接続・配信物・ヘッダーを確認する。架空データを使った試験と実データへの操作を区別する。

### ドメインと旧URLの下書き

独自ドメインはVoidのdomain addで既存Workerへ接続済み。旧workers.dev URLもAccess保護付きで維持する。IndexedDBはorigin別で、新URLへ下書きは自動移行されない。旧URLで「保存済み」を確認するか、本文をコピー・Markdown保存してから移動する。確認前に旧URLのブラウザデータを消さない。

## SQLバックアップ

破壊的DB変更前に取得する。通常コード変更前は任意で、週次/月次の定期取得はしない。開発PCの暗号化ストレージで直近3世代を保管し、Git・クラウド共有・公開領域へ置かない。削除済み本文も秘密情報として扱う。

SQL出力はDBを一時ブロックする。入力を止めるか保存完了を確認し、MCPも停止してから取得する。MCPは読取でも予算表を更新する。

スクリプトは公式D1 APIを使う。対象accountをCLOUDFLARE_ACCOUNT_ID、必要権限に絞ったtokenをCLOUDFLARE_API_TOKENへ設定し、引数やログにtokenを残さない。

```powershell
mise exec -- python scripts/backup_restore.py remote-export --database-id DATABASE_UUID --output 'X:/Encrypted/KirokuBackup/diary-YYYYMMDD-before-change.sql'
mise exec -- python scripts/backup_restore.py verify-sql --sql 'X:/Encrypted/KirokuBackup/diary-YYYYMMDD-before-change.sql' --report 'X:/Encrypted/KirokuBackup/verified.json'
```

remote-exportは空SQLiteへの読戻しとライブD1の全表digest比較を行い、隣にmanifestを保存する。本文3件、receipt等100件ずつ照合し、途中の書込やepoch変更は失敗とする。新しい世代で再取得し、SQLとmanifestの検査成功後に本人が最古世代を手動削除する。

SQL入力は自分の信頼するバックアップだけに限定する。取得元との一致は実D1での復旧成功を意味しない。JSON形式版2は現在要約を含むが、履歴・receipt・epochを含むDB退避の代用にはならない。

## 1MBと復元経路

D1のSQL文上限は100,000バイト、文字列/BLOB/1行は2,000,000バイト。本文上限1,000,000バイトの単一INSERTは通常importできない場合がある。[D1 limits](https://developers.cloudflare.com/d1/platform/limits/)。

backup_restore.pyはSQLを空SQLiteへ読み、schema作成後、パラメータ付きINSERTと最大48,000 UTF-8バイトの追記UPDATEで空D1へ転送する。Unicode境界で分割し、全表digest・本文SHA・外部キーを検証する。親表から子表へ入れ、外部キーを無効化しない。旧3表のバックアップも扱うが、新コード接続前に必要なmigrationをVoidで適用する。

新しい空DBだけを対象にする。途中失敗を成功扱いせず、アプリを接続しない。現行table/index向けの処理なので、trigger/view/BLOB追加時は再設計・再検証する。

初回・DB構造変更時は架空データだけで実D1復元試験を行う。

```powershell
mise exec -- python scripts/backup_restore.py remote-proof --run-remote --report docs/remote-backup-proof.json
```

ランダム名 `kiroku-restore-check-*` のDBを2つ作り、sourceのSQL exportから空targetへ分割復元、全表/本文一致、epoch回転を確認する。Freeの空き2枠が必要で、課金設定は変更しない。tokenには対象accountのD1 Read/Editが必要。

その呼出が作ったDBだけをID/名前で再確認して削除する。成功とcleanupの両方を確認し、削除失敗時は証跡の一時DBのUUID/名前だけを管理画面で照合する。既存の [実D1証跡](remote-backup-proof.json) と [MCP追加後の証跡](mcp-remote-backup-proof.json) は分割復元の結果で、標準importの成功証明ではない。

## 障害復旧

1. データと障害範囲を確認する。必要ならAccessを管理者専用にして書込を止め、可能なら現DBを新しい世代へ退避する。MCPも停止し、端末未同期本文はコピー/Markdownで確保する。IndexedDBを消さない。
2. コードrollbackとDB復元を別々に判断する。Voidのproject status/logsを確認する。project rollbackはmigrationを戻さないため、旧コードと現DBの互換性も確認する。
3. SQL復旧はVoid管理情報と整合する新しい空D1 `kiroku-recovery-*` を使う。Cloudflare管理画面で対象accountを確認して作成し、UUID・名前・空であることを再確認して次を実行する。

```powershell
mise exec -- python scripts/backup_restore.py restore-empty-d1 --sql 'X:/Encrypted/KirokuBackup/SELECTED.sql' --database-id NEW_EMPTY_UUID --confirm-empty-database-id NEW_EMPTY_UUID --expected-name kiroku-recovery-YYYYMMDD --report 'X:/Encrypted/KirokuBackup/recovery-proof.json'
```

4. 全表一致とepoch回転の成功後、VoidのD1 bindingを復旧先へ更新し、migration/コードの整合性を確認して手動deployする。スクリプトはbindingや本番DBを変更しない。元DBは調査・復帰判断が終わるまで残す。
5. Time Travelを選ぶ場合は、Voidのdeployがmigration前に表示した `void db restore --platform cloudflare --bookmark BOOKMARK`、または `void db restore --platform cloudflare --timestamp ISO_TIME` を使う。対象DBと復元時点を確認し、`--yes` を付けず対話で実行する。指定時点後の全書込を捨てる操作で、Free保持7日を超えた点には戻せない。コードは戻らずmigration適用履歴は戻るため、次のdeploy前に問題のmigrationを修正する。書込再開前にapp_meta.database_epochを新UUIDへ回転し、旧epochを再利用しない。
6. Android/PCでepoch不一致による同期停止を確認し、本人が端末版と復旧後のサーバー版を比較して再適用する。古いversionが一致してもそのまま送らない。各端末を確認してから書込を再開する。

復元試験で本番DBを上書きしない。完全削除本文もSQL世代・Time Travelには残り得る。ブラウザデータ削除・端末喪失・容量不足による下書き消失は保証外で、日常のJSON出力・Markdown退避は本人が判断する。

## 無料枠の確認

D1 Freeは1DB 500MB、最大10DB、account全体5GB、Time Travel7日。本文だけでなく永久receipt・要約履歴・indexも増える。Workers/D1の利用量を管理画面で確認し、自動課金やPaidを有効にしない。

MCPは250MB到達、または半年以内に500MBへ達する見込みを移行検討の目安にする。初回CPU超過を含む実測と未合格項目は [MCP検証](mcp-verification.md) を参照する。
