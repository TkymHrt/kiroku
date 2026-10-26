# MCP本番公開

2026-10-21 JST、初回CPU超過の制約を報告した後、本人指示で既存Worker/D1へ公開した。Paid・追加API課金は有効にしていない。操作手順は [MCP運用](mcp-operations.md)、負荷の判定は [MCP検証](mcp-verification.md) を参照する。

| 対象       | 公開時の状態                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------- |
| 画面 / MCP | [きろく](https://kiroku.tkymhrt.dpdns.org/) / 同originの `/mcp`、OAuth/DCR                          |
| Worker     | kiroku、version 1c1a39a7-cbed-4f35-a142-89b8d981ba49                                                |
| D1         | kiroku-db、migration 20261020145658_abnormal_northstar.sql適用、全3件applied                        |
| Access     | kiroku-mcp、application c28b8ff3-073a-4df4-888e-8eb846699eec。本人1件Allow + Cloudflare IdP Require |

既存Worker全体のpolicyは維持し、MCPのDCR redirectだけChatGPTの現行/従来コールバックへ限定した。localhost/loopbackは無効。session168時間も照合した。

## 公開前の退避・適用

公式D1 exportのSQL 95,147bytesをメモリ上のSQLiteで検査し、ライブD1の全表digestと一致した。ディスク暗号化状態を読めなかったため、平文SQLを保存せずWindows DPAPI CurrentUserで暗号化し、復号後も元bytesと照合した。

保存先は `C:/Users/TkymHrt/AppData/Local/Kiroku/Backups/diary-20261021-before-mcp.sql.dpapi`。隣の `diary-20261021-before-mcp.sql.manifest.json` に照合結果を保存した。Base64のDPAPI保護bytesで、同じWindowsユーザーのProtectedData.Unprotect(..., CurrentUser)を使う。端末/プロファイル喪失をまたぐ可搬バックアップではない。復元は [新しい空DBへの手順](operations.md#障害復旧) に従う。

MCP_ORIGIN・MCP_ACCESS_AUD・MCP_CURSOR_SECRETをVoidのstdinから登録し、secret名6件を確認した。専用乱数鍵を使い、既存認証secretは維持した。短期本人JWTをdeployプロセスだけへ渡し、通常staged deployのbuild・migration・readiness・activation・route更新が成功した。

独自ドメインrouteをvoid.config.tsへ明示し、Voidがlockを更新した。Worker/DB identity、workers.dev維持、preview無効、観測ログ無効を維持した。

## 公開後の確認

[確認JSON](mcp-production-proof.json)の28項目で次を確認した。

- 独自ドメイン/旧URLそれぞれ匿名8経路302。MCP匿名401、resource/認可サーバーmetadata200。
- 本人JWTでHTML・session・一覧・JSON出力200、8ヘッダー、旧URLのsession200。
- APIのCSRFなしPOST403。MCPの不正Origin・Sec-Fetch-Site・別origin403、query400、GET405。
- 本番専用audienceと公式SDKでinitialize・tools/list・ping。5ツール中読取4つ。
- 既存Access policyと本文/操作receipt/app_metaの全行digestは公開前と一致。epoch不変。

[認証画像](mcp-production-auth-proof.jpg)も保存した。この公開作業では実日記への要約書込・実本文送信・実データE2Eは行っていない。後続の本人承認による [ChatGPT接続試験](mcp-chatgpt-production.md) とは区別する。

公開前は型・Lint・整形・buildが成功。機能コードは前回check（単体110件・Workers6件）成功時から変更していない。全文負荷・DB復元を本番で再実行していない。
