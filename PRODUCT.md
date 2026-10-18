# きろく

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

利用者指定: Void + React + TypeScript、Cloudflare Workers + D1、Drizzle、Bun/mise、CodeMirror 6、react-markdown + remark-gfm。

## Users

本人ひとり。Android Chromeで毎日の短い記録を追記し、PC Chromeでも閲覧・編集する。

## Product Purpose

日付ごとのMarkdown日記を、速く、消失しにくく記録する。Google Keepの過去分は移行しない。

## Operating Context

認証後は日記一覧。今日への移動、日付指定、記録済みの前後移動。日本時間の日付を使う。編集中に日付を自動変更しない。オフラインでも開いている本文を編集し、再起動時に端末内下書きを復元する。

## Capabilities and Constraints

端末内下書き、D1自動同期、手動競合解決、ゴミ箱、コピー、Markdown保存、JSON一括出力。1日1件、本文1,000,000 UTF-8 bytes。Cloudflare Accessで本人だけ許可。無料枠。要件の詳細は docs/requirements.md。

## Evidence on Hand

2026-10-18版の確定要件。実データ・ブランド資産は未提供。名称「きろく」は作業フォルダー名からの実装上の仮称。機能の追加ヒアリングは不要と指定済み。

## Product Principles

- 本文の保護を保存成功の見た目より優先する。
- 端末保存とサーバー保存を区別する。
- 競合した本文を黙って上書きしない。
- 書く操作に集中できる画面を作る。
