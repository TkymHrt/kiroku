# きろく

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Void + React + TypeScript、Cloudflare Workers / D1、Drizzle、Bun/mise、CodeMirror 6、react-markdown + remark-gfm。

## Users

本人ひとり。Android Chromeで日々の短い記録を追記し、PC Chromeでも閲覧・編集する。

## Product Purpose

日付ごとのMarkdown日記と、用件ごとの独立メモを、速く、消失しにくく記録する。Google Keepの過去分は移行しない。

## Operating Context

認証後は一覧を開く。今日・指定日・記録済みの前後へ移動し、日本時間の日付で編集する。午前0時でも編集中の日付は変えない。開いている本文はオフラインで編集でき、再起動時は端末下書きを復元する。

## Capabilities and Constraints

端末保存・D1自動同期・手動競合解決・ゴミ箱・本文出力。日記は1日1件。独立メモは複数作成でき、固定・しまう・検索とMarkdownチェックリストを備える。本文は各1,000,000 UTF-8 bytesまで。Accessで本人だけを許可し、無料枠で運用する。MCPでは日記を参照し、要約だけを別に保存する。詳細は [要件](docs/requirements.md)。

## Evidence on Hand

2026-10-18の確定要件と、その後のMCP追加要件。名称「きろく」は実装上の仮称で、承認済みのブランド資産はない。実証範囲は [受入表](docs/verification.md) を参照。

## Product Principles

- 本文の保護を優先する。
- 端末保存とサーバー保存を区別する。
- 競合した本文を本人の確認なしに上書きしない。
- 書く操作に集中できる画面を作る。
