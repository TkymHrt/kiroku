# 初回公開記録

初回公開は2026-10-18 JST。手順は [運用](operations.md)、最新のMCP公開は [mcp-deployment.md](mcp-deployment.md)、未確認項目は [受入表](verification.md) を参照する。

| 対象        | 設定                                                                                  |
| ----------- | ------------------------------------------------------------------------------------- |
| リポジトリ  | [TkymHrt/kiroku](https://github.com/TkymHrt/kiroku)、初回main bd8d65b                 |
| アプリ      | [きろく](https://kiroku.tkymhrt.dpdns.org/)                                           |
| 旧URL       | [workers.dev](https://kiroku.23-h-takayama-nutfes.workers.dev/)、Access保護付きで維持 |
| Worker / D1 | kiroku / kiroku-db、binding DB                                                        |
| 管理        | Void CLI、void.config.ts、void.lock.json。手動公開、課金変更なし                      |

## 認証と公開口

Accessのworker destinationで全経路を保護した。Allowは本人メール完全一致のIncludeとCloudflare IdPのRequire。Application/Policy sessionは168時間、Global sessionは未変更。preview URLと観測ログは無効。CLI互換のためBinding Cookieは無効、HttpOnlyは維持した。

ACCESS_TEAM_DOMAIN・ACCESS_AUD・ACCESS_EMAILを登録し、WorkerでもJWTを照合する。本人MFAは申告とCloudflare APIで確認した。独自ドメインは同日Voidのdomain addで既存Workerへ接続し、再deploy・migrationは行っていない。

## 公開後の確認

匿名で `/`・`/api/session`・`/api/diaries`・日付API・neighbors・`/api/export`・`/__void/ready`・`/favicon.svg` の8経路がAccessへ302。独自ドメインと旧URLで本人SSOも確認した。

Edgeで架空日付2099-12-31の作成→保存→ゴミ箱→復元→完全削除を確認し、終了時の日記件数は0件。実D1の一時DBでは1,000,000バイト本文のSQL退避・分割復元・全表一致・epoch回転・2DB削除が成功した。[復元証跡](remote-backup-proof.json)。

型・単体86件・Workers4件・build・ソース固定後のE2E40件が成功。初回の8セキュリティヘッダーは標準Miniflareでの確認で、本番認証後の直接確認は翌日の更新で行った。

## 2026-10-19の更新

| 更新                                 | 公開version・確認                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| スマホナビの等幅化・単改行プレビュー | 880ece18-fd9a-4c8d-94da-a63a100cbfb3。Access保護後のstaged deploy、両originのアセット一致、認証付き4経路200と8ヘッダー、匿名8経路302 |
| 全幅タップ範囲・日付選択・曜日色     | commit 7fc25c1、version 9058adbc-8d40-4705-905d-12f5c87e11cc。両originの配信物一致とAccess維持                                       |

390px幅でナビは0–130 / 130–260 / 260–390px、高さ44px。各領域両端のhit判定、矢印右余白12px、曜日3色、footerが「今日」のみであることを確認した。本番のブラウザ検証は読取だけで、書込は0件。

単体91件・Workers4件・型・build・E2E40件が成功し、フォーカス微調整後の関連2件も成功した。詳細は [ローカル検証](local-test-results.md) と [UI変更](ui-refinement.md)。Android実機や実Access期限切れの合格には含めない。
