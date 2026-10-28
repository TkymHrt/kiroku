---
name: きろく
description: 日付と保存状態が見えるMarkdown日記と、用件ごとの独立メモ。
colors:
  accent: "#3f5846"
  accent-hover: "#304936"
  accent-light: "#e6ece2"
  paper: "#fff"
  surface: "#f5f6f2"
  ink: "#29332d"
  muted: "#637064"
  weekday-ink: "#58715c"
  weekday-sunday: "#98615e"
  weekday-saturday: "#526f86"
  line: "#dce1d8"
  sidebar: "#edf0e8"
  nav-selected: "#dfe6d9"
  nav-selected-ink: "#2d4533"
  row-hover: "#ebeee7"
  selection: "#dce6d9"
  selection-ink: "#203529"
  danger: "#9e4037"
  state-saved: "#61745e"
  state-local: "#8a6532"
  state-busy: "#5c7180"
  state-problem: "#9a4833"
  warning-surface: "#f2eadb"
  warning-ink: "#785925"
  warning-line: "#e4d5ba"
  danger-surface: "#f8ebe7"
  danger-ink: "#8f4235"
  danger-line: "#ead0c7"
typography:
  title:
    fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif'
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0.02em"
  diary-date:
    fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif'
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0"
  note-title:
    fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif'
    fontSize: "25px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0"
  note-title-mobile:
    fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif'
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0"
  note-row-title:
    fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif'
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.7
  note-row-title-mobile:
    fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif'
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.7
  section:
    fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif'
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.6
  source:
    fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.95
  preview:
    fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.95
  label:
    fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif'
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.7
  label-small:
    fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.7
  status:
    fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif'
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: "ui-monospace, Consolas, monospace"
    fontSize: "0.9em"
rounded:
  text: "4px"
  small-control: "5px"
  input: "6px"
  button: "7px"
  panel: "8px"
  dialog: "10px"
  calendar: "12px"
spacing:
  compact: "6px"
  small: "8px"
  control: "10px"
  medium: "12px"
  flow: "15px"
  wide: "17px"
  section: "24px"
  room: "30px"
  gutter: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "10px 16px"
  button-text:
    textColor: "{colors.accent}"
    typography: "{typography.label-small}"
    rounded: "{rounded.text}"
    padding: "6px 3px"
  date-picker-trigger:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.accent}"
    typography: "{typography.label-small}"
    rounded: "{rounded.button}"
    padding: "7px 11px"
    height: "44px"
  date-picker-compact:
    textColor: "{colors.ink}"
    typography: "{typography.diary-date}"
    padding: "4px"
    height: "44px"
  date-picker-dialog:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.calendar}"
    padding: "16px"
    width: "min(382px, calc(100vw - 20px))"
  navigation:
    rounded: "{rounded.input}"
    padding: "12px 15px"
  navigation-selected:
    backgroundColor: "{colors.nav-selected}"
    textColor: "{colors.nav-selected-ink}"
  diary-row:
    textColor: "{colors.ink}"
    padding: "14px 12px"
  note-row:
    textColor: "{colors.ink}"
    typography: "{typography.note-row-title}"
    padding: "20px 12px"
  note-row-mobile:
    textColor: "{colors.ink}"
    typography: "{typography.note-row-title-mobile}"
    padding: "18px 2px"
  note-search:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "0 12px"
    height: "46px"
  note-scope:
    textColor: "{colors.muted}"
    typography: "{typography.label-small}"
    rounded: "{rounded.input}"
    padding: "8px 11px"
    height: "44px"
  note-scope-selected:
    backgroundColor: "{colors.accent-light}"
    textColor: "{colors.accent}"
  note-task-toggle:
    width: "44px"
    height: "44px"
  editor-surface:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.panel}"
  save-state:
    textColor: "{colors.state-saved}"
    typography: "{typography.status}"
  mode-tab:
    padding: "0 9px"
  today-chip:
    backgroundColor: "{colors.accent-light}"
    textColor: "{colors.accent}"
    rounded: "{rounded.text}"
    padding: "1px 7px"
---

# Design System: きろく

## 方針

淡い緑の背景、白い本文面、濃い緑の操作色を使う。日付と実際の保存状態を見やすくし、書くための領域を確保する。実装は `src/styles.css`・`src/components/`・`src/App.tsx` を参照する。名称と色名は実装上の初期値で、承認済みのブランド資産ではない。

ロゴは「きろく」の文字だけとし、タグラインや装飾アイコンを添えない。機能アイコンはLucideの線画SVG、faviconはノートの幾何学SVG。写真や生成画像をUI資産として使わない。

独立メモも同じ淡い緑・白い本文面・線画を継承する。メモはタイトルと本文の手掛かりで探す一列の一覧とし、日記の日付中心の構成と使い分ける。

## 色と文字

色・書体・余白・角丸・主要部品の値はfrontmatterにまとめる。本文は端末にある日本語sans、コードだけmonospaceで、webfontは同梱しない。

- 編集ソースは16px・行高1.95で固定し、見出し記号でも文字を大きくしない。
- プレビューは15px・行高1.95。単改行を表示するが、保存ソースは変えない。
- 日付は19px、保存状態は行内11px/編集上部12px。補助表示の細かな値はCSSを参照する。
- メモの詳細タイトル・行タイトルはfrontmatterのnote系を使う。700px以下は各mobile版へ切り替える。抜粋は補助文字、未完了件数と更新日は小さなメタ情報としてタイトルより弱くする。一覧のページ見出しは読み上げ用だけに残し、総件数は表示しない。
- 保存色にはアイコンと日本語ラベルを併用し、「端末保存済み」と「保存済み」を区別する。
- 曜日は平日緑・日曜赤・土曜青。文字も残し、紙/背景とのコントラスト4.60:1以上を維持する。

通常面は色差と1pxの線で区切り、行・ボタン・本文面に影を付けない。影はモーダルとtoastに限定する。空状態は「日記はまだありません」「ゴミ箱は空です」「本文を入力」などの短文と必要な操作にする。

## レイアウト

| 幅             | 配置                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| PC標準         | 左ナビ228px。通常内容は最大956px・左右48px、日記は最大1020px。重複する上部バーや大きな導入は置かない |
| 1000px以下     | ナビ202px、内容の左右余白30px                                                                        |
| 700px以下      | ナビを画面全幅の3等分にし、隙間・外側余白なし。背景・下線・押下範囲も各1/3。ブランド/今日は左右20px  |
| モバイル編集中 | ナビ行を隠し、補助バーをvisualViewport由来のkeyboard-inset上へ固定。safe-areaと本文下部の余白を確保  |

一覧は月見出しの下に日番号・曜日・今日・保存状態を並べる。日付を重複表示せず、読み上げ名には完全な日付を残す。設定は線で区切る。

PCでは日記一覧とメモを主ナビに並べ、日記のゴミ箱と設定を線の下の補助ナビに置く。700px以下は日記一覧・メモ・その他を3等分にし、その他から日記のゴミ箱・設定・ログアウトへ進む。新規作成ボタンは開いている日記/メモの文脈に合わせる。メモ詳細ではモバイルのナビ行を隠す。

メモ一覧は通常内容幅を使い、検索、表示範囲、固定、最近のメモの順に置く。ナビと重複するページ見出し・総件数は画面に置かない。PCの検索と表示範囲は同じ行、700px以下は検索の下に表示範囲を置く。詳細は戻る/保存状態、タイトル、固定/しまう/更新日、白い本文面の順に並べる。日記の月別一覧と編集ヘッダーは維持する。

## 操作部品

主要操作は緑地と白文字、補助操作は白地と枠線、文字操作は緑で区別する。通常ボタンは高さ44px以上。hoverは色だけを0.15秒で変える。キーボードfocusは緑の枠で示し、モバイルナビは3px内側にして端で切れないようにする。

### 日付選択

一覧の「日付からひらく」と編集上部のYYYY/MM/DDは同じカレンダーを使う。日を選ぶとすぐ開き、手入力や2回目の「ひらく」は不要。ゴミ箱には日付移動を置かない。

年/月はnative select、日付は6週の固定グリッド。表示年の前後100年、1〜9999年の範囲で候補を更新する。矢印は右12px、右側余白36px。footerは「今日」のみ。ダイアログ幅はmin(382px, 100vw - 20px)、360px以下は余白12px・間隔4pxで320pxに収める。

開く時は選択日へfocusし、矢印/Home/End/PageUp/Down、Shiftで年移動に対応する。Escape・閉じる・背景で取消し、起動ボタンへfocusを戻す。日付の読み上げ名、aria-selected、今日のaria-currentを残す。

### 編集

戻る・日付・曜日・記録済みの前後・保存状態を1ヘッダーに置く。編集/プレビューの選択は緑の下線で示し、本文コピー等を同じ操作列に置く。本文は白地と細い枠で、端末幅に合わせて内側余白を減らす。

補助バーは日本語のaccessible nameを持つ実ボタンを使う。IME変換中は無効にし、pointer-downで選択を保つ。CodeMirrorの外枠非表示を他の操作部品へ広げない。

### メモの一覧と詳細

一覧行はタイトル、1行の本文抜粋、未完了件数と更新日の順にし、長いタイトルと抜粋は省略する。更新日は日本時間のYYYY/MM/DDで西暦を常に含め、右下に表示する。日付の途中は改行せず、保存状態が増えたらメタ情報全体を折り返す。詳細の更新日も同じ形式を使う。行全体を押せる細い下線の一覧とし、カードの影は付けない。通常範囲では固定を先頭に分け、各区分は更新順にする。タイトル未入力時は本文から表示名を作る。

検索はタイトルと本文を対象とし、白い入力面と検索アイコンを使う。入力を含む外枠にfocusを示す。メモ/しまったメモ/ゴミ箱は押下状態を淡い緑で示し、日記のゴミ箱と文脈を分ける。

メモの作成は上部のペンアイコン付き「メモを書く」とし、移動用の矢印は付けない。新規は編集、作成済みメモはプレビューで開く。詳細タイトルは編集時に任意入力、プレビュー時に見出しとして表示する。固定としまうはタイトルの下、削除は本文面の下に置く。日記と同じ編集/プレビュー、本文コピー、Markdown保存を使い、現在の端末本文と実際の保存状態を扱う。

### メモのチェックリスト

プレビューのチェックは44px四方の押下領域に18pxのチェックボックスを置く。本文の文字と余白は共通プレビューに従う。各チェックは項目自身の文をaria-labelledbyで参照し、親項目の読み上げ名へ入れ子の子項目を含めない。キーボードでも操作でき、重複文や入れ子でも対象のソース位置だけを変更する。完了による自動並び替えや自動移動は行わない。

### 保存状態・エラー

アイコンとラベルを6px間隔で並べる。保存済み、端末保存中、端末保存済み、同期中、未同期、ログインが必要、内容の確認が必要、保存できていませんを区別する。空日は「まだ記録されていません」。

ErrorNoticeに短い見出し・説明・復旧操作をまとめる。タイトル15px、説明14px、操作は44px以上で折り返す。端末保存失敗では本文退避を先頭にする。診断コピーは本文コピーと分ける。条件と操作の対応は [エラー表示](docs/error-recovery.md) を参照する。

競合は両本文を確認できるパネルにし、pre-wrapとスクロールで全文を保持する。通常の保存説明を編集上部で繰り返さず、設定や初回空状態へ置く。出力範囲・削除・復元など判断に必要な説明は操作のそばに残す。

メモも端末保存とサーバー保存を分ける。空の新規画面は「まだメモは作成されていません」とし、競合時は両版のタイトル・本文・固定・しまった状態を比較できる形にする。認証切れや保存失敗でも現在の本文と退避操作を保つ。

### ダイアログと動き

一般ダイアログは最大510px、横幅calc(100% - 36px)、余白26px/モバイル21px。toastはモバイル補助バーの上へ移す。進捗回転は1.2秒。reduced-motionではtransitionとsmooth scrollを止め、animationを0.01ms・1回にする。
