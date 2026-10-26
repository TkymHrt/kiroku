# MCP・日次要約の検証記録

2026-10-21 JST。5ツール・本人認証・要約独立保存・復元を実装し、本人指示で [本番公開](mcp-deployment.md) した。先行クラウド試験は一時Worker/Access/D1と架空データだけを使い、課金を有効にしていない。

## 自動検証

| 対象       | 結果                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 一括検証   | check成功、単体110件・Workers6件。10月26日の再実行も [記録](local-test-results.md) を参照                                     |
| プロトコル | 公式SDKでinitialize/5ツール。ローカル・実OAuthでInspector tools/list --strict成功                                             |
| 認証・CSRF | JWT署名/iss/aud/本人/期限、設定不足、Origin/Host/query、Sec-Fetch-Siteを検証。既存APIのCSRF保持                               |
| 読取       | 日本語部分一致、範囲/cursor/件数、ゴミ箱除外、空日/空本文、Tokyo深夜/年境界                                                   |
| 長文       | 日本語・emoji・NUL・CRLFを含む1,000,000bytesの分割連結。途中更新/要約変更/epoch/改ざん拒否                                    |
| 保存       | ID/日付/source version/epoch/revision、削除・同日再作成、同payload再送、異payload拒否、並行処理、履歴失敗時の全batch rollback |
| 回収・出力 | 追記でstale、翌日回収、current再生成除外、JSON形式版2、要約更新中のEXPORT_CHANGED、本文version不変                            |
| 画面       | 既存40件中38件成功後、形式版1を期待した2件を版2と要約出力の確認へ修正し、対象2件成功。修正後40件の単一再実行は未実施          |
| 復元       | ローカルと [実一時D1](mcp-remote-backup-proof.json) で全7表・外部キー・1MB本文SHA・epoch回転・2DB削除成功                     |

migrationは4表の追加で、既存表の削除・本文変更はない。本文receipt・absenceToken・primary優先照合は維持。SDK/Inspectorは開発依存で、Workerはstateless JSON-RPCを実装している。

## 実クラウド・ChatGPT

一時Accessに本人1件Allow + Cloudflare IdP Require + Managed OAuthを設定した。ChatGPTのKiroku MCP Testから手動読取・保存が成功。予約作成後の00:52:23 JSTに本文をversion 2→3へ追記し、00:52:54の単発予約から00:54:12にsource version 3 / 要約revision 3を保存した。本文versionは不変、履歴/receiptは各3件。予約後の手動呼出・承認は挟んでいない。[ChatGPT証跡](mcp-chatgpt-proof.json)。

画面には応答の読込エラーと頻度表示の不一致があり、D1と保存済み設定を別経路で照合した。試験後は日次検証タスクを停止し、専用Worker/D1/Accessを削除、接続も解除した。[後片付け](mcp-cleanup-proof.json)・[タスク画像](mcp-schedule-proof.jpg)。

一時checkout `C:/Users/TkymHrt/AppData/Local/Temp/kiroku-mcp-proof-jJO1m6` は削除が自動承認ポリシーで拒否され、残存した。クラウドリソースの削除とは別で、別手段による削除は試みていない。

本番では旧チャットの予約保存がSAFETY_CHECK_BLOCKEDとなり、権限変更でも解消しなかった。新規チャットではデフォルト設定のまま、予約後の追記を含む架空本文version 2の要約revision 1を無人保存できた。架空日記は全削除し、実日記・既存receiptの不変を確認した。[本番接続記録](mcp-chatgpt-production.md)。

その後日次タスクを再開したが、日次自身の初回実行・厳密な時刻精度は未確認。既存MVPのAndroid/Access受入も、この試験で合格にはしない。

## CPU・D1量・無料運用の判定

| 証跡                                      | 実測・解釈                                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [長文試験](mcp-cloud-load-proof.json)     | 認証付き97要求が200。1MBを84分割でSHA一致、保存/再送で本文version不変、原文予約1,008,000bytes                                                             |
| [最適化後](mcp-cloud-load-optimized.json) | 遅延importとhex変換改善後、先頭240KB・31要求成功                                                                                                          |
| [Tail](mcp-tail-optimized.json)           | 11サンプル、中央値5ms・P90 6ms・最大20ms、全outcome=ok。全要求の記録ではない                                                                              |
| [Workers集計](mcp-cloud-metrics.json)     | GraphQLの集計。Tail個別値と混同しない                                                                                                                     |
| [D1集計](mcp-d1-metrics.json)             | UTC日・15:53 UTC時点で777 rows read / 216 rows written、450 read queries / 169 write queries。準備・負荷・ChatGPT・確認SQLを含み、日次1要約の原価ではない |

Workers FreeのCPU 10ms以内での安定運用は未合格。通常4〜6msでも初回最大20msが残り、この制約を報告した後の本人指示で公開した。成功応答は1年間無料で稼働する保証ではない。認証を弱めず、追加最適化かFreeでの許容性を判断する。Tailは終了時に削除し、本文・headers・URL・ログ本文は記録していない。

本文だけなら10KB/日で約3.65MB/年、100KBで36.5MB、1MBで365MB。履歴・永久receipt・indexも加わる。250MBまたは半年以内に500MB見込みで移行を検討する。OAuth grantは168時間のため本人再接続が必要で、1年間完全無人の要件は満たさない。接続・停止・再認証は [運用手順](mcp-operations.md) を使う。
