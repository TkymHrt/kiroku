# MCP・日次要約の検証記録

2026-10-21 JST。[実装計画](mcp-implementation-plan.md)に沿って実装した。5ツール、本人限定認証、要約の独立保存、復元経路は実装済み。同日07時台、本人の公開指示を受けて既存Worker・本番D1へ反映した。[公開記録](mcp-deployment.md)と[本番の確認結果](mcp-production-proof.json)を参照。先行する書込・負荷・復元試験は専用の一時Worker/Access/D1と架空日記だけを使用し、PaidやAPI課金は有効にしていない。

続く[ChatGPT本番接続の検証](mcp-chatgpt-production.md)ではOAuth接続・手動の架空要約保存が成功した一方、旧検証チャットの予約では`SAFETY_CHECK_BLOCKED`が報告され、承認設定の変更でも解消しなかった。本人指示で新規チャットを作り、デフォルト設定のまま単発予約からの無人保存を再検証したところ、予約後に追記した架空本文version 2の要約revision 1がD1に保存され、本文version不変・履歴/receipt各1件・追記を含む事実だけの要約を確認した。既存の日次タスクを再開し、毎日00:15 Asia/Tokyoを確認した。全試験の架空日記を削除し、実日記と既存操作receiptの不変を確認済み。表示エラーと予定・保存時刻の不一致は残り、厳密な時刻精度と日次自身の初回実行は未確認。

## 自動検証

| 項目                                 | 結果                                                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint・整形・型・単体・Workers・build | `mise exec -- bun run check`で確認。単体110件、Workers連携6件                                                                                                        |
| MCPプロトコル                        | 公式SDKのStreamable HTTPクライアントでinitialize・5ツール。ローカルと実OAuth先でInspector `tools/list --strict`成功                                                  |
| 認証・CSRF                           | JWT署名/iss/aud/本人/期限、設定不足、Origin/Host/query拒否。AccessがBearerを消費した後の署名JWTを検証。Sec-Fetch-Siteを持つブラウザ要求拒否、既存APIのCSRF保持       |
| 読取                                 | 日本語部分一致、日付/cursor/件数制限、ゴミ箱除外、空日/空本文、Tokyo深夜/年境界                                                                                      |
| 長文                                 | 1,000,000bytesを日本語・emoji・NUL・CRLF込みで分割連結。途中の本文/要約/epoch変更、改ざんcursorを拒否                                                                |
| 保存                                 | source version/epoch/revision/ID/日付・削除・同日再作成を照合。同ID同payload再送は1回適用。競合/異payload拒否、並行書込、履歴INSERT失敗時の全batchロールバックを確認 |
| 追記・失敗回収                       | 更新後の要約をstaleへ戻し、翌日も未処理に残す。同じ版のcurrentは再生成対象外                                                                                         |
| JSON形式版2                          | 現在要約を同梱。要約更新が出力途中に起きてもEXPORT_CHANGED。本文versionは要約保存で不変                                                                              |
| 画面回帰                             | Edgeの既存40ケース中38件成功。旧JSON形式版1を期待した2件を版2＋MCP要約保存/出力確認へ更新し、PC/小画面の対象2件が成功。修正後40件の単一再実行はしていない            |
| ローカル復元                         | `backup_restore.py self-test`で全7表・外部キー・1MB本文・epoch回転が成功                                                                                             |
| 実D1復元                             | [証跡](mcp-remote-backup-proof.json)。空の一時D1へ親表順で分割復元、全7表・外部キー・本文SHA一致、epoch回転、試験用2DB削除が成功                                     |

生成されたmigrationは新規4表と制約だけで、既存表の削除・本文データ変更を含まない。既存本文receipt、absenceToken、primary優先照合は維持した。公式SDK/Inspectorは開発依存で、Workerの入口は小さいstateless JSON-RPC実装としている。

## 実クラウド・ChatGPT

専用AccessでManaged OAuth、本人1件Allow、既存Cloudflare IdP Requireを使用した。Slack用の秘密は流用していない。EdgeからChatGPTの「Kiroku MCP Test」を登録・接続し、手動の読取と要約保存をD1で確認した。[ChatGPT証跡](mcp-chatgpt-proof.json)には本文・tokenを残していない。

ChatGPTへの依頼で毎日00:15 Asia/Tokyoの「きろくMCP日次要約検証」と単発の回収試験を作成した。タスク作成の会話でMCPを実行しないよう指定し、作成完了後の00:52:23 JSTに通常APIからsource versionを2→3へ追記した。単発予約は00:52:54 JSTで、00:54:12 JSTにsource version 3の要約revision 3をD1へ保存した。本文versionは3のまま、履歴・receiptは各3件。予約後に書込承認や手動MCP操作を挟まず成功し、ChatGPTのスケジュール一覧でも「きろくMCP回収再検証」の完了を確認した。検証用の日次タスクは試験後に一時停止した。

一部のChatGPT応答は画面に「この回答を読み込めませんでした」と表示された。登録成功だけで保存成功とは判定せず、D1のrevision/履歴/receiptを別経路で照合した。日次カードの頻度表示とスケジュール一覧の表示にも差があり、一覧の「毎日」とAsia/Tokyoの設定を確認した。

![検証日次タスクの一時停止と単発回収の完了](mcp-schedule-proof.jpg)

試験後、専用Worker・D1・Accessアプリを削除し、再照会で削除済みと確認した。ChatGPT側も検証アカウントの接続を解除し「接続」ボタンへ戻った。[後片付けの証跡](mcp-cleanup-proof.json)。検証プラグインは本番用ではなく、削除した入口へ再接続しない。本番へ接続する時は本番用として別途登録する。

ローカルの一時検証checkout `C:/Users/TkymHrt/AppData/Local/Temp/kiroku-mcp-proof-jJO1m6` は削除操作が自動承認ポリシーで拒否されたため残っている。cloudリソースの削除とは別の残存物であり、削除を別手段で迂回していない。

## CPU・D1量・無料運用の判定

[実Workers長文試験](mcp-cloud-load-proof.json)では認証付き97要求が全て200、1MBを84分割でSHA一致、保存と同payload再送で本文version不変を確認した。原文予約量は1,008,000bytes。日次上限をD1の条件付き更新で共有し、並行要求でも残予算を超えない。

サービスの遅延importとhex→byte変換の割当削減後、[追加の長文取得試験](mcp-cloud-load-optimized.json)は先頭240KB・31要求が成功。[Tail実測](mcp-tail-optimized.json)は11サンプル、中央値5ms、P90 6ms、最大20ms、全件outcome=ok。一部の初回要求は10msを超えた。Tailは全要求を返さず、GraphQLの分位値も[集計値](mcp-cloud-metrics.json)なので両者を混同しない。観測用Tailは終了時に削除し、本文・headers・URL・ログ本文は記録していない。

**Workers FreeのCPU 10ms以内での安定運用は未合格。** 通常処理は収まったが初回超過を解消できていない。この制約を報告後の本人指示で公開した。認証を弱めたり有料化したりせず、継続運用では追加のCPU改善または実際のFree枠での許容性を判断する。エラーが無かったことは、1年間の無料稼働保証にはならない。

[D1 GraphQL実測](mcp-d1-metrics.json)は試験用DBだけのUTC日集計で、15:53 UTC取得時点の777 rows read / 216 rows written（450 read queries / 169 write queries）。セットアップ・長文負荷・ChatGPT・確認用SQLを含み、日次1要約の原価と同一視しない。行読み書きの定義は[公式D1 metrics](https://developers.cloudflare.com/d1/observability/metrics-analytics/)を参照。

容量は本文10KB/日で約3.65MB/年、100KB/日で36.5MB/年、1MB/日で365MB/年。要約履歴・永久receipt・indexも増える。250MBまたは半年以内に500MB見込みで移行を検討する。Accessのgrantは168時間なので、認証期限後の本人再接続が必要。1年間完全無人という要件は満たさない。

## 引き継ぎ

[接続・スケジュール登録用プロンプト・復旧手順](mcp-operations.md)を用意した。初回CPUの制約を報告した後、本人の公開指示により本番へ反映した。SQLバックアップ、MCP専用Access/secret設定、対象originでの匿名拒否と本人接続を確認済み。Android実機と本番Accessの既存受入項目を、この試験で合格へ変更しない。
