# 開発・公開・復旧手順

基準日 2026-10-18。同日にVoid CLIでWorkers / D1へ初回公開し、本人のAccessログインと架空データの保存・削除を確認した。実D1での1MBバックアップ復元も成功した。設定と確認範囲は[公開記録](deployment.md)、残る受入項目は[受入表](verification.md)を参照する。

## ローカル開発

ツール版は`mise.toml`、依存版は`bun.lock`を基準にする。Bunを基本とし、Cloudflare/testツールが要求するNodeをmiseで併用する。

```powershell
mise install
bun install --frozen-lockfile
bun run dev
```

VoidのD1開発データはローカルに置く。開発に本番の接続情報を使わない。初回に空のローカルD1へmigrationを適用する。Voidの標準手順は`bunx void db migrate`。schemaを変更したら`bunx void db generate`でmigrationを作り、生成SQLを読んで既存データへの影響を確認する。通常のschema変更を複数CLIで管理しない。[Void D1](https://void.cloud/guide/database/d1)

リポジトリの`package.json`にある型検査・unit/API/E2E・buildを実行する。DB変更時は加えて次の架空データ試験を行う。

```powershell
python scripts/backup_restore.py self-test
```

この試験は現行SQL migrationから空SQLiteを作り、1,000,000バイト本文（日本語、絵文字、CRLF、引用符）、空本文、ゴミ箱、操作履歴を入れる。SQL出力→空SQLite復元→全表digest/本文UTF-8 SHA-256比較、同じ転送処理によるパラメータ分割復元、epoch回転を検証する。SQL文上限を模擬したSQLite試験であり実D1試験ではない。本文は一時ディレクトリへ保存して終了時削除、証跡は本文を含まないJSONだけ。

## Accessの初回設定

1. 本人のCloudflareアカウントにMFAを設定する。Zero TrustでCloudflareをIdPとして追加し、アカウントメンバー限定も有効にする。[Cloudflare IdP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/cloudflare/)
2. 単一Workerを対象とするself-hosted Accessアプリの`worker` destinationで、画面・API・静的ファイル・内部経路を含む全経路を保護する。Allow policyは本人のメールアドレスだけをIncludeし、Cloudflare IdPをRequireする。メンバー全体を許可するselectorだけで済ませない。Bypass/Everyoneや別の広いAllowを残さない。[Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
3. Application / Policy sessionは168時間（7日）に設定する。初回公開では共通Global sessionを変更していない。Global変更は他アプリへ影響するため、既存アプリを調査してから決める。Cloudflare One Client認証を使う場合はそちらのsessionが優先し得る。[Session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
4. ApplicationのAUDを`ACCESS_AUD`、team domain（`https://TEAM.cloudflareaccess.com`）を`ACCESS_TEAM_DOMAIN`、本人メールを`ACCESS_EMAIL`としてサーバー設定へ登録する。説明用の`docs/access.env.example`も参照。Voidはルートの`.env.example`を許可しないため、ローカル設定が必要な場合は単一の`.env`だけを使う。Cloudflareアカウントのパスワード/API tokenをアプリへ渡さない。
5. WorkerでもAccess JWTの署名・`iss`・`aud`・有効期限を検証する。本人emailを追加照合する。ヘッダーが存在するだけで認証済みとみなさない。JWKSはteamの`/cdn-cgi/access/certs`から取得する。[JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
6. `workers.dev`や別ルートも同じWorkerのAccess保護対象であることを確認する。初回公開ではpreview URLを無効化した。公開口の設定は`void.config.ts`へ残し、deployで戻らないようにする。

Accessが期限切れするとfetchが401/403だけでなくログインHTMLへリダイレクトされる場合もある。下書きを残したまま同期を止め、再認証導線でログイン後に再取得・version/epoch照合する。実Accessの期限切れ試験は残っている。短いsessionで試験するときは他アプリへの影響を避け、終了後に目標7日へ戻す。ログアウト後の既存タブ、戻るボタン、API拒否も確認する。

## 手動公開

初回公開は完了している。更新時は型チェック・必要なテスト・migrationレビューを行い、[受入表](verification.md)に確認結果を記録する。実データの利用開始前には残るAndroid実機・別アカウントでの拒否・実Access期限切れ等の受入確認を行う。

```powershell
bunx void connect --platform cloudflare
bunx void deploy --platform cloudflare
```

Voidがbuild、リソース確保、migration、deployを管理する。生成された`void.config.ts`/`void.lock.json`は必要に応じてバージョン管理する。`cf init/dev/build/deploy`で別構成を追加しない。課金が必要な選択肢を有効にする前は本人へ確認する。CI/CDや常設クラウド検証環境は作らない。[Void deployment](https://void.cloud/guide/deployment)

Access保護後の再deployでは、保護されたreadinessへのアクセスに短期の本人トークンを`CF_ACCESS_TOKEN`としてdeployプロセスへ渡す必要がある。`cf access login`等による取得を含む再deploy手順は未検証。トークンをGit・コマンド引数・ログへ記録せず、本人限定policyを緩めて通過させない。VoidのCloudflareガイドのAccess認証手順を確認し、再deploy成功後に本書へ実行結果を追記する。

追加のリソース操作は`cf`を優先する。`bunx cf cli search "export D1 database"`、該当`--help`/`bunx cf schema ...`、`--dry-run`で現行の引数と送信先を確かめる。cfはbetaでNode 22以上が必要。アプリの設定・migration管理はVoidに統一する。[公式cf CLI](https://github.com/cloudflare/cf/blob/main/packages/cli/README.md)

Void/cfが対応しない操作だけWranglerを例外使用できる。SQL exportの公式例は次の形。コマンドをコピーする前に実DB名・保存先とローカル/本番指定を見直す。

```powershell
bunx wrangler d1 export DATABASE_NAME --remote --output 'X:/Encrypted/KirokuBackup/diary-20261018-before-change.sql'
```

初回は架空の日記で読み書き・ゴミ箱・復元・完全削除を確認し、確認後の本番日記件数は0件だった。匿名8経路のAccessへのリダイレクトも確認した。JSONを含む詳細機能はローカル自動テストで確認しており、本番での確認範囲とは区別する。観測ログは無効に設定した。HTML/JSのセキュリティヘッダー8項目は標準MiniflareのASSETS配信で一致を確認したが、本番での認証後応答を直接観測した結果ではない。

## SQLバックアップ

必須契機は破壊的DB変更の前。通常コード更新前は必須でなく、週次/月次の定期取得もしない。開発PCの**暗号化ストレージ**へ保存し、Git・クラウド共有フォルダ・端末の公開領域へ置かない。バックアップ内の削除済み本文も秘密情報として扱う。

SQL出力はDBを一時的にブロックするため、入力を止めるか保存完了を確認してから取得する。運用スクリプトは公式D1 APIを使い、アプリのCLI設定を追加しない。API tokenは環境変数`CLOUDFLARE_API_TOKEN`、accountは`CLOUDFLARE_ACCOUNT_ID`へ設定する。必要権限に絞り、コマンド引数・Git・ログへtokenを書かない。

```powershell
python scripts/backup_restore.py remote-export --database-id DATABASE_UUID --output 'X:/Encrypted/KirokuBackup/diary-20261018-before-change.sql'
python scripts/backup_restore.py verify-sql --sql 'X:/Encrypted/KirokuBackup/diary-20261018-before-change.sql' --report 'X:/Encrypted/KirokuBackup/diary-20261018-verified.json'
```

`remote-export`はSQLをローカル空SQLiteへ読み戻し、ライブD1の全表digestとも比較して、同名`.manifest.json`を付ける。検査中に書込やepoch変更があれば失敗として新しい世代で再取得する。D1の照合は本文3件ずつ、receipt等は100件ずつに区切り、表全体の本文を一度に取得しない。これはローカルSQLと取得元の一致の証拠であり、実D1での復旧成功を意味しない。SQL入力は信頼する自分のバックアップに限定する。

直近**3世代**を保持する。新規SQLと検査manifestの作成・検査が成功してから、本人が最古の世代を手動で削除する。スクリプトは世代削除を自動化しない。JSON一括エクスポートは本文を持ち出す機能で、操作履歴・epochを含むDB退避の代用にはしない。

## 1MBと復元経路

公式D1制限はSQL文100,000バイト、文字列/BLOB/1行2,000,000バイト。日記上限は1,000,000バイトなので、通常dumpの単一INSERTはSQL文上限を超え得る。複数行INSERTを分割するだけでは1件の長い本文を救えない。[D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

`backup_restore.py`はSQLを空SQLiteへ読み、スキーマを作った後、小さなパラメータ付きINSERTと最大48,000 UTF-8バイトの追記UPDATEで復元する。本文をSQLリテラルへ埋め込まず、Unicode境界で分割し、改行もバイト一致を検証する。新しい空DBにしか書かず、途中失敗時は成功扱いせずアプリを接続しない。現行MVPのtable/indexに限定し、将来trigger/view/BLOBを追加したら復元経路も再設計・再検証する。

初回とDB構造変更時に、**架空データだけ**で次を実行する。スクリプトは毎回ランダム名`kiroku-restore-check-*`のD1を2つ作成し、sourceへ1MB本文等を入れ、sourceから本物のSQL exportを取得し、空targetへ分割パラメータ復元、全表・本文SHA比較、epoch回転まで行う。その呼び出しが作った2件だけをID/名前再確認後に削除する。アカウントにFreeの空き2枠がないと停止し、課金設定は変更しない。

```powershell
python scripts/backup_restore.py remote-proof --run-remote --report docs/remote-backup-proof.json
```

API tokenには対象accountのD1 Read/Edit（作成・削除・query・export）が必要。成功とcleanupの両方を証跡で確認する。cleanup失敗時は報告された**一時DBのUUID/名前だけ**を管理画面で確認して削除する。2026-10-18にこの実D1経路が成功し、1,000,000バイト本文を含む全表一致、index復元、epoch回転、一時DB2件の削除を[remote-backup-proof.json](remote-backup-proof.json)へ記録した。標準SQL importの成功を意味するものではなく、分割パラメータ復元の検証結果である。[D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)、[Export API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/)

## 障害復旧

1. 現在のデータと障害範囲を確認する。必要ならAccessを管理者専用にして書込を止め、可能なら現DBを新しい世代へ退避する。端末未同期本文はコピー/Markdownで確保し、IndexedDBを消さない。
2. コードを戻すかDBを戻すかを別々に決める。`bunx void project status`/`bunx void project logs`で状況確認。`bunx void project rollback`はDB migrationを戻さない。旧コードと現DBの互換性を確認する。
3. SQL復旧は本番を直接上書きせず、Void管理情報と矛盾しない手順で**新しい空D1** `kiroku-recovery-*`を作る。作成はcfで送信先を確認する。空DBのUUIDと名前を再確認し、次を実行する。

```powershell
python scripts/backup_restore.py restore-empty-d1 --sql 'X:/Encrypted/KirokuBackup/SELECTED.sql' --database-id NEW_EMPTY_UUID --confirm-empty-database-id NEW_EMPTY_UUID --expected-name kiroku-recovery-YYYYMMDD --report 'X:/Encrypted/KirokuBackup/recovery-proof.json'
```

4. 全表digest一致とepoch回転が成功してから、VoidのD1 bindingを復旧先へ更新し、必要なmigrationとコードの整合性を確認して手動deployする。スクリプトはbindingや本番DBを変更しない。元DBは原因調査・復帰判断が終わるまで残す。
5. Time Travelを選ぶならVoidが記録したrestore command/ブックマークを確認する。指定時点後の全書込を捨てる操作である。Free保持7日を過ぎた点には戻せない。巻き戻し後は**書込を開く前に**`app_meta.database_epoch`へ新UUIDを設定する。復旧前のepochを再利用しない。
6. 端末を開くとepoch不一致として同期停止することを確認する。本人が端末版/復旧後サーバー版を比較し、必要な変更を手動で再適用する。古いversionが偶然一致してもそのまま送らない。復旧テスト後、AndroidとPCの各端末で確認して書込を再開する。

完全削除した本文もSQL世代やTime Travelには残り得る。ブラウザデータ消去・端末喪失・容量不足は下書き保護の保証外。普段は設定のJSON出力や未同期本文のMarkdown退避を本人の判断で利用する。

## 無料枠の確認

D1 Freeは1DB 500MB、最大10DB、account全体5GB、Time Travel7日。1日1MB近い本文を増やすと容量が先に制約になる。本文を持たないreceiptも永久保持のため増える。Cloudflare管理画面でWorkers/D1のリクエスト・行読み書き・保存量を確認し、上限接近時はJSON退避や運用を見直す。自動課金やPaid有効化はしない。
