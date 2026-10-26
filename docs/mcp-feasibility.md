# 日記MCP・日次要約の実現性調査と提案

2026-10-20の採用前調査を、判断理由と再利用できる実験結果に絞った記録。実装後の仕様は [設計](architecture.md)、公開・実測・未合格項目は [MCP検証](mcp-verification.md) を参照する。以下の見積りは現在の稼働保証ではない。

## 採用した構成

ChatGPT定期タスク → 本人限定Cloudflare認証付きMCP → 既存D1を採用した。既契約のChatGPT利用枠とWorkers/D1無料枠を使い、追加API料金を避ける。既存のSlack Dumperで接続・定期読取が成功していたため、日記側では無人書込と更新・削除・復旧の整合性を確認対象にした。

MCPは一覧・検索・原文取得・未処理取得・要約保存に限定する。本文編集・削除・任意SQL・全件一括取得を提供しない。要約は別表と独立revisionで保存し、全文取得・元日記のID/version/epochを照合する。日次処理は毎日00:15 JSTに前日までを少数件処理し、遅い同期・追記・失敗を次回回収する。

初期検索は日付絞り込みとパラメータ付き部分一致。FTS・embedding・人物グラフ・週次/月次要約は実装しない。Workers AI/Cronやセルフホストは採用しておらず、先行実装しない。サーバー移転だけではChatGPTの承認や利用枠は解決しない。

## ローカルの検索・保存実験

```powershell
mise exec -- node scripts/mcp-feasibility.mjs
```

既存migrationを一時Miniflareへ適用し、2080年の架空データだけで10/10項目が成功した。Node v24.21.0、Miniflare 4.20260730.0、compatibility date 2026-02-24。出力はGit対象外の `test-results/mcp-feasibility.json`。

| 実験                                             | 結果                                           |
| ------------------------------------------------ | ---------------------------------------------- |
| 「今日は図書館で読書した。」から「図書館」を検索 | unicode61は0件、trigramは該当                  |
| 2文字の「東京」を検索                            | trigram MATCHは0件、部分一致なら該当           |
| 英字語・ゴミ箱                                   | 英字語に該当し、有効日記とのJOINでゴミ箱を除外 |
| 別表要約                                         | 本文version不変                                |
| 古い要約revision・本文version・epoch             | 保存拒否、最新の前提なら更新可                 |
| ゴミ箱・完全削除後の同日再作成                   | 古い結果の保存拒否                             |
| 深夜・年境界                                     | 前日のTokyo日付を算出                          |

これは検索方式とSQL条件の原型だけ。MCPプロトコル、認証、同時処理、receipt、実AI品質、クラウドCPU、定期実行の証明には使わない。現行実装の回帰確認は通常のテストを使う。

## 容量の試算

```powershell
mise exec -- python scripts/mcp-capacity.py
```

SQLite上で365日、本文20,000 UTF-8 bytes/日、要約2,000bytes/日を1版ずつ保存した近似値。結果は `test-results/mcp-capacity.json` に出す。

| 本文の保存成功回数/日 | 本文receipt/年 | DB全体  | receiptとindexの増分 |
| --------------------- | -------------- | ------- | -------------------- |
| 100                   | 36,500件       | 約20MB  | 約11MB               |
| 500                   | 182,500件      | 約66MB  | 約57MB               |
| 1,000                 | 365,000件      | 約123MB | 約114MB              |

打鍵数ではなくD1保存成功回数で、同じ操作の再送は増分にならない。実D1容量、FTS、要約の複数版・receipt、クラウド管理領域は別途加算する。容量目的で永久receiptを期限削除しない。

本文だけなら20KB/日を10年で約73MB、1MB/日なら1年で365MB。保存頻度によってreceiptも増えるため、250MB到達か半年以内に500MB見込みを移行検討の目安にした。公式上限そのものではない。

## 残した判断理由

無料運用では呼出回数に加え、JWT・初期化・長文処理のCPU、単一DB容量、読書量、認証期限を確認する。採用前の「1年は現実的」という見込みより、実装後に判明した初回CPU超過と再認証の制約を優先して判断する。

将来FTSを使うなら短い日本語語句の部分一致を残し、容量・更新時の書込増幅・復元を実D1で検証する。セルフホストならD1 session/batch・transaction・環境変数・OAuthのアダプターが必要で、設定変更だけの移行にはならない。

参考にしたのは [dayone-mcp](https://github.com/benlen10/dayone-mcp)、[dayone-headless](https://github.com/yunanwg/dayone-headless)、[mcp-obsidian](https://github.com/MarkusPfundstein/mcp-obsidian)、[Cloudflare MCP](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/)、[SQLite trigram](https://sqlite.org/fts5.html#the_trigram_tokenizer)。設計参考であり、安全性監査や導入試験ではない。
