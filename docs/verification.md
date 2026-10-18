# MVP受入と公開判定

基準日 2026-10-18。`未確認`は失敗とも成功とも扱わない。自動テストで検証した範囲と実機/本番の確認を区別する。公開の最終判定には全必須項目の証跡が必要。

実行済みのローカル検証は[local-test-results.md](local-test-results.md)にまとめた。PC/390px相当のEdge Chromiumで40ケース、Vitest86件、公式Workers連携4件が成功確認済み。E2Eは分割実行とHMR中断後の再実行を含む。Android実機の合格を意味しない。

| # | 要件・確認内容 | 検証方法/期待する証跡 | 状態 |
|---|---|---|---|
| 1 | 本人以外/未認証で画面・全API拒否 | 実Accessでシークレットウィンドウ、他アカウント、API直URL、workers.dev/preview代替口を試す。本人だけ許可。JWT不正/iss/aud/expiry拒否も自動テスト。 | 実Access未確認 |
| 2 | Android一覧/日付/前後/今日 | Android実機で未同期新規を含む移動・段階読込・Tokyo日付を確認。PC/小画面E2Eも実行。 | 実機未確認 |
| 3 | 開くだけでは新規作成せず、1日1件 | API/unit/E2Eで空日を開く→一覧なし→入力→1件→同日create競合。入力を空に戻すと未作成。 | 自動テスト結果は実行ログ参照 |
| 4 | 保存済み空本文/午前0時保持 | 空への更新が消えずversion進行。時刻をTokyo深夜へ固定して編集中日付/本文/selection保持。 | 自動テスト結果は実行ログ参照 |
| 5 | 編集/補助/IME/preview/checkbox | Android日本語変換中・候補選択・undo/redo・selection・キーボード直上・回転を実機確認。重複チェック項目、HTML/危険URL/外部画像非取得はunit/E2E。 | Android IME/viewport未確認 |
| 6 | オフライン追記/再起動復旧/再接続 | 開いた日をoffline→編集→端末保存→閉じる→online起動で同本文復元。ネット復旧で1回更新。offline新規起動は保証外。 | 自動テスト＋実機要確認 |
| 7 | 日付移動時の端末保存/正しい状態表示 | IndexedDB成功後移動、失敗時警告。旧日リクエスト完了が新日の状態を変えない。最新本文だけ保存済み。 | 自動テスト結果は実行ログ参照 |
| 8 | 応答喪失の再送/複数端末競合 | 同じmutationId再送でversion不変、同ID違う内容拒否、後続更新後の古receipt再送で上書きなし、古versionは409。 | 自動テスト結果は実行ログ参照 |
| 9 | 両版確認/選択/統合/削除競合 | 2タブで競合、両本文・退避、採用の確認、解決中再競合、削除/復元との交差を確認。 | 自動テスト＋Android要確認 |
| 10 | ゴミ箱/復元/完全削除/古端末 | すべてversion照合。purge後のupdate/create再送が再作成しない。未送信の新規下書き→別端末でcreate/trash/purge→最初のcreate送信もabsenceToken不一致で409。明示的な新規作成と旧操作を区別。 | 自動テスト結果は実行ログ参照 |
| 11 | 未同期コピー/Markdown/JSON | offline本文をClipboard/Blobで全文退避、見出し追加なし。JSONはD1全件＋ゴミ箱、purge/端末だけの下書きを除外。ページ取得の途中変更はEXPORT_CHANGEDで中止してやり直す。Android保存先/日本語ファイルを実機確認。 | Androidファイル保存未確認 |
| 12 | 1,000,000byte境界/超過保護/再試行 | 日本語/emojiで境界成功・超過拒否、本文保持。503/通信断/Retry-After/401/409/validationの分岐、24時間警告、IDB失敗退避。 | 自動テスト結果は実行ログ参照 |
| 13 | 実D1で約1MB SQL export/復元/一致 | `python scripts/backup_restore.py remote-proof --run-remote`。新規2つの一時D1、fake1MB本文、SQL export→空D1分割restore、全表digest一致、epoch回転、cleanup成功。 | **実D1未実行・公開前必須** |
| 14 | 本番Access/読み書き/削除/ログ | 保護設定後の架空データsmoke、no-store、API全path、本文/tokenがURL/アクセス/例外ログにないこと。保存後に実データ登録。 | **未公開・未確認** |

## 既にある復元の証跡

[local-backup-proof.json](local-backup-proof.json)は2026-10-18 JSTに実行した**ローカルSQLiteだけ**の試験。1,000,000 UTF-8 bytesをSQLへ出力→空SQLiteへ復元しSHA-256一致。小パラメータ分割経路も同じデータで一致した。行全体・ゴミ箱・空文字・receiptを含み、epochを回転することを確認した。実D1、Access、Androidはこの証跡では検証していない。

同日の独立監査で、空日を見た端末の未送信createが別端末でcreate/trash/purgeした後に通る不具合をMiniflare上で再現した。修正後は古いabsenceTokenで409 CONFLICT、新しく取得したtokenで本人確認後のcreate成功を再確認した。バックアップ試験も現行のreceipt日付indexを含む3index、app_meta、同日複数と完全削除履歴を含む5receiptの全列一致を検証済み。

remote-proofを実行した場合は`remote-backup-proof.json`の`kind`が`real-temporary-cloudflare-d1`、`passed`がtrue、全`cleanup.deleted`がtrueであることを読む。単にファイルが存在するだけでは合格としない。

## 手動チェックの記録欄

| 対象 | 実行日(JST) | 端末/ブラウザ・アカウント | 結果/証跡 |
|---|---|---|---|
| Android IME/toolbar/viewport | — | — | 未確認 |
| Android copy/Markdown download | — | — | 未確認 |
| Access本人限定/別の公開口 | — | — | 未確認 |
| Access期限切れ→下書き保持→再認証/競合 | — | — | 未確認 |
| 1MB実D1 restore | — | — | 未実行 |
| Time Travel/SQL復旧後のepoch/下書き停止 | — | — | 実D1未確認 |
| 本番初回smoke/log確認 | — | — | 未公開 |

本番に実データを入れる前に上表を更新する。ログやスクリーンショットに実際の日記本文・JWTを含めない。
