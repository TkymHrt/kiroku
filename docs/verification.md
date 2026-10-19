# MVP受入と公開判定

初回基準日 2026-10-18、更新確認 2026-10-19。Accessで保護した初回公開と[独自ドメインでの公開](https://kiroku.tkymhrt.dpdns.org/)は完了した。本人のMFA有効化もCloudflare APIで確認した。`未確認`は失敗とも成功とも扱わず、自動テストと実機/本番の確認を区別する。実データの利用開始前に残る必須項目の証跡を揃える。

実行済みの検証は[local-test-results.md](local-test-results.md)と[公開記録](deployment.md)にまとめた。PC/390px相当のEdge Chromiumで、ソース固定後のE2E40ケースが単一実行ですべて成功した。Vitest86件、公式Workers連携4件、ビルドも成功した。実D1復元と本人SSOでの本番操作も確認したが、Android実機の合格を意味しない。

2026-10-19の更新では、プレビュー回帰5件を加えた単体91件、Workers連携4件、E2E40件、型チェック・buildが成功した。スマホナビの等幅と単改行プレビューを本番へ反映し、Access保護後の再deploy、配信アセット一致、認証後ヘッダーも直接確認した。

| # | 要件・確認内容 | 検証方法/期待する証跡 | 状態 |
|---|---|---|---|
| 1 | 本人以外/未認証で画面・全API拒否 | 本人メールだけのIncludeとCloudflare IdP Require。Worker全経路を保護、preview無効。新独自ドメインでも匿名8経路はAccessへ302、本人SSOで実画面表示。JWT不正/iss/aud/expiry拒否も自動テスト。 | 本人/匿名確認済み、別アカウント実ログイン拒否は未確認 |
| 2 | Android一覧/日付/前後/今日 | Android実機で未同期新規を含む移動・段階読込・Tokyo日付を確認。PC/小画面E2Eも実行。 | 実機未確認 |
| 3 | 開くだけでは新規作成せず、1日1件 | API/unit/E2Eで空日を開く→一覧なし→入力→1件→同日create競合。入力を空に戻すと未作成。 | 自動テスト結果は実行ログ参照 |
| 4 | 保存済み空本文/午前0時保持 | 空への更新が消えずversion進行。時刻をTokyo深夜へ固定して編集中日付/本文/selection保持。 | 自動テスト結果は実行ログ参照 |
| 5 | 編集/補助/IME/preview/checkbox | Android日本語変換中・候補選択・undo/redo・selection・キーボード直上・回転を実機確認。重複チェック項目、HTML/危険URL/外部画像非取得はunit/E2E。 | Android IME/viewport未確認 |
| 6 | オフライン追記/再起動復旧/再接続 | 開いた日をoffline→編集→端末保存→閉じる→online起動で同本文復元。ネット復旧で1回更新。offline新規起動は保証外。 | 自動テスト＋実機要確認 |
| 7 | 日付移動時の端末保存/正しい状態表示 | IndexedDB成功後移動、失敗時警告。旧日リクエスト完了が新日の状態を変えない。最新本文だけ保存済み。 | 自動テスト結果は実行ログ参照 |
| 8 | 応答喪失の再送/複数端末競合 | 同じmutationId再送でversion不変、同ID違う内容拒否、後続更新後の古receipt再送で上書きなし、古versionは409。 | 自動テスト結果は実行ログ参照 |
| 9 | 両版確認/選択/統合/削除競合 | 2タブで競合、両本文・退避、採用の確認、解決中再競合、削除/復元との交差を確認。 | 自動テスト＋Android要確認 |
| 10 | ゴミ箱/復元/完全削除/古端末 | すべてversion照合。purge後のupdate/create再送が再作成しない。未送信の新規下書き→別端末でcreate/trash/purge→最初のcreate送信もabsenceToken不一致で409。明示的な新規作成と旧操作を区別。 | 自動テスト成功。本番のゴミ箱/復元/完全削除も確認済み |
| 11 | 未同期コピー/Markdown/JSON | offline本文をClipboard/Blobで全文退避、見出し追加なし。JSONはD1全件＋ゴミ箱、purge/端末だけの下書きを除外。ページ取得の途中変更はEXPORT_CHANGEDで中止してやり直す。Android保存先/日本語ファイルを実機確認。 | Androidファイル保存未確認 |
| 12 | 1,000,000byte境界/超過保護/再試行 | 日本語/emojiで境界成功・超過拒否、本文保持。503/通信断/Retry-After/401/409/validationの分岐、24時間警告、IDB失敗退避。 | 自動テスト結果は実行ログ参照 |
| 13 | 実D1で約1MB SQL export/復元/一致 | `python scripts/backup_restore.py remote-proof --run-remote`。新規2つの一時D1、fake1MB本文、SQL export→空D1分割restore、全表digest一致、epoch回転、cleanup成功。 | **成功、[実D1証跡](remote-backup-proof.json)** |
| 14 | 本番Access/読み書き/削除/ログ | 初回は匿名8経路拒否と本人SSO、架空日記の作成/保存/ゴミ箱/復元/完全削除後に日記件数0を確認。観測ログ無効。10/19は更新公開後の認証付き4経路と8ヘッダーも直接確認。 | 基本smokeと認証後ヘッダー確認成功 |

## 既にある復元の証跡

[local-backup-proof.json](local-backup-proof.json)は2026-10-18 JSTに実行した**ローカルSQLiteだけ**の試験。1,000,000 UTF-8 bytesをSQLへ出力→空SQLiteへ復元しSHA-256一致。小パラメータ分割経路も同じデータで一致した。行全体・ゴミ箱・空文字・receiptを含み、epochを回転することを確認した。実D1、Access、Androidはこの証跡では検証していない。

同日の独立監査で、空日を見た端末の未送信createが別端末でcreate/trash/purgeした後に通る不具合をMiniflare上で再現した。修正後は古いabsenceTokenで409 CONFLICT、新しく取得したtokenで本人確認後のcreate成功を再確認した。バックアップ試験も現行のreceipt日付indexを含む3index、app_meta、同日複数と完全削除履歴を含む5receiptの全列一致を検証済み。

[remote-backup-proof.json](remote-backup-proof.json)は同日の実Cloudflare D1での試験結果。`kind`は`real-temporary-cloudflare-d1`、`passed`と全`cleanup.deleted`はtrue。1,000,000バイト本文、空本文、ゴミ箱、操作履歴を含む全表一致、index復元、epoch回転が成功し、一時DB2件も削除した。単にファイルが存在するだけでなく、これらの結果を確認した。

## 手動チェックの記録欄

| 対象 | 実行日(JST) | 端末/ブラウザ・アカウント | 結果/証跡 |
|---|---|---|---|
| Android IME/toolbar/viewport | — | — | 未確認 |
| Android copy/Markdown download | — | — | 未確認 |
| Access本人限定/別の公開口 | 2026-10-18 | PC Microsoft Edge、本人SSO/匿名HTTP | workers.devと新独自ドメインで本人表示成功、匿名8経路302、Worker全経路保護・preview無効。別アカウントでの実ログイン拒否は未確認 |
| アカウントMFA | 2026-10-18 | 本人申告、Cloudflare API | 有効化済みを確認 |
| Access期限切れ→下書き保持→再認証/競合 | — | — | 未確認 |
| 1MB実D1 restore | 2026-10-18 | Cloudflareの一時D1 2件、架空データ | 全表/本文一致、index復元、epoch回転、両DB削除成功。[証跡](remote-backup-proof.json) |
| 復旧後の端末下書き停止 | — | — | 実D1復元時のepoch回転は成功。Time Travel相当の復旧後に各端末の未同期下書きが停止する実機確認は未実施。本番DBを復元試験に使わない |
| 本番初回smoke/log設定 | 2026-10-18 | PC Microsoft Edge、本人SSO | 作成→保存済み→ゴミ箱→復元→再ゴミ箱→完全削除。D1日記件数0、観測ログ無効。[公開記録](deployment.md) |
| Access保護後の更新公開/ヘッダー | 2026-10-19 | Void CLI、本人JWT、PC Microsoft Edge | 再deploy成功、両originの配信アセット一致、独自ドメインの認証付き4経路200/8ヘッダー、匿名8経路302、本番モバイル幅でナビ等幅を確認 |

本番に実データを入れる前に未確認項目を確認し、上表を更新する。障害運用としての本番Time Travel巻戻し手順は未実施であり、受入試験のために本番DBを巻き戻さない。Application / Policy sessionは168時間、共通Global sessionは他アプリへの影響を避けるため未変更。ヘッダー8項目は初回の標準Miniflare検証に加え、10/19に本番の認証後HTML/APIでも直接確認した。旧URLの端末下書きは新URLへ自動移行されないため、旧URLでの同期完了かコピー・Markdown保存による退避を確認する。ログやスクリーンショットに実際の日記本文・JWTを含めない。
