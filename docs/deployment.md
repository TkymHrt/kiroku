# 初回公開記録

初回公開日：**2026-10-18（日本時間）**。

- 公開リポジトリ：[TkymHrt/kiroku](https://github.com/TkymHrt/kiroku)
- 初回mainコミット：`bd8d65b`
- アプリ：[きろく](https://kiroku.tkymhrt.dpdns.org/)
- 旧URL：[workers.dev](https://kiroku.23-h-takayama-nutfes.workers.dev/)（Access保護付きで維持）
- 実行環境：Cloudflare Workers、Worker名`kiroku`
- データベース：Cloudflare D1、DB名`kiroku-db`、binding名`DB`

Void CLIでbuild・D1確保・migration適用・deployを実行した。リソース情報は`void.lock.json`、公開口と観測ログの設定は`void.config.ts`へ記録する。GitHubへのpushとCloudflareへの公開はローカルから手動で行い、CI/CDは導入していない。課金設定は変更していない。

## Accessと公開口

単一Workerを対象にするself-hosted Accessアプリの`worker` destinationで、画面・API・静的ファイル・Void内部経路を含む全経路を保護した。Allow policyのIncludeは本人の完全一致メールアドレスだけ、RequireはCloudflare IdPだけとし、メンバー全体を許可するpolicyは設けていない。

Application / Policy sessionは168時間（7日）。共通Global sessionは他アプリへの影響を避けるため変更していない。preview URLと観測ログは無効にした。CLIとの互換性のため、このアプリのBinding Cookieは無効、HttpOnlyは維持した。

Workerには次のサーバーsecretを登録した。値は公開資料へ記載しない。

- `ACCESS_TEAM_DOMAIN`
- `ACCESS_AUD`
- `ACCESS_EMAIL`

WorkerでもAccess JWTの署名・issuer・audience・有効期限・本人メールを照合する。認証設定が欠けた場合はfail closedとする。

## 独自ドメインでの公開

同日、既存のCloudflare zone内の未使用ホスト`kiroku.tkymhrt.dpdns.org`をVoidの`domain add`で既存Workerへ接続した。DNS・TLS・Workerの公開口を同期し、アプリの再deployやDB migrationは行っていない。Void設定・lock差分をcommitし、課金設定は変更していない。

Workerを対象にしたAccess保護、本人メール1件だけのAllow policy、Cloudflare IdP、168時間のsessionは維持した。本人のMFA有効化申告に加え、Cloudflare APIでも有効化済みであることを確認した。

新URLでも下記8経路すべてが匿名アクセス時にAccessへ302で移動し、PCのMicrosoft Edgeで本人SSO後に日記一覧の取得完了（空一覧）まで確認した。旧workers.dev URLは、旧URLに残る端末下書きを同期・退避できるよう維持する。IndexedDBはoriginごとに分かれるため、下書きは新URLへ自動移行されない。旧URLで「保存済み」を確認するか、コピー・Markdown保存で退避してから新URLへ移動する。

## 確認した範囲

匿名HTTPで次の8経路を確認し、すべてAccessのログインへ302で移動した。

- `/`
- `/api/session`
- `/api/diaries`
- `/api/diaries/2099-12-31`
- `/api/diaries/2099-12-31/neighbors`
- `/api/export`
- `/__void/ready`
- `/favicon.svg`

PCのMicrosoft Edgeで本人のSSOを使い実画面を表示した。架空日付`2099-12-31`で、作成→「保存済み」→ゴミ箱→復元→再びゴミ箱→完全削除を確認し、終了後のD1日記件数は0件だった。

実D1では1,000,000 UTF-8バイト本文を含む架空データをSQLへ出力し、新しい空D1へ分割パラメータで復元した。全表・本文の一致、index復元、epoch回転が成功し、試験用DB2件を削除した。[本文を含まない証跡](remote-backup-proof.json)を保存している。

型チェック・単体テスト86件・公式Workers連携4件・ビルドが成功した。ソース固定後のE2E40件も単一実行ですべて成功した。標準MiniflareのASSETS配信でHTML/JSのセキュリティヘッダー8項目の一致を確認したが、本番での認証後応答を直接観測した結果ではない。[検証結果](local-test-results.md)も参照。

## 更新公開（2026-10-19）

スマートフォンのナビ3項目を等幅・中央揃えにし、Markdownの単改行をプレビューでも表示する修正を公開した。本文の保存形式は変えず、DBの新規migrationはない。

Void CLIの通常のstaged deployがreadiness確認・activationまで成功し、公開中のWorker Versionは`880ece18-fd9a-4c8d-94da-a63a100cbfb3`。Accessで保護されたreadinessには短期の本人JWTを`CF_ACCESS_TOKEN`へ、送信先の明示に`CLOUDFLARE_WORKERS_SUBDOMAIN`を同じdeployプロセスへ渡した。具体的な手順は[運用資料](operations.md)を参照する。

独自ドメインと旧workers.devの両方で、配信されたmain JS・CSS・MarkdownPreview JSがローカルbuildとバイト単位で一致した。独自ドメインのHTML・session・一覧・JSON出力は認証付きでHTTP 200、`no-store`・CSPを含む8ヘッダーを直接確認した。匿名の上記8経路はすべてAccessへ302。本番のモバイル相当表示でもナビ3項目の等幅・高さ44pxを確認した。

型チェック、単体91件、Workers連携4件、E2E40件、本番buildが成功。320px/390px幅のナビ、段落・コード・リスト・同名チェック項目と保存ソースの保持を含む。Android実機確認とは区別する。

## 残る確認

- Android Chrome実機での日本語IME、キーボード直上ツールバー、コピー/Markdownファイル保存。
- 別アカウントによる実ログインの拒否。
- 実Access期限切れ後の下書き保持・再認証・競合確認。
- Time Travel相当の復旧後に各端末の未同期下書きが停止する実機確認。本番DBを復元試験に使わない。

実データの利用開始前に[受入表](verification.md)の残る項目を確認する。障害運用としての本番Time Travel巻戻し手順は未実施であり、上記の受入確認とは区別する。更新・バックアップ・復旧の手順は[運用資料](operations.md)を参照。
