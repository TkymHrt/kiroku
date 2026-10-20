---
name: きろく
description: 日付と保存状態が見える、日々のMarkdown日記。
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

## Overview

**Creative North Star: "Reading room"**

A pale green ground, forest actions, graphite text, and open reading space carry the reading-room direction recorded in `.impeccable/surface.md`. Familiar controls and quiet date rows support daily writing. The durable product constraint is that device saving and server saving must remain distinguishable; status has a stable place beside the date and in the list.

This is a record of the implemented system in `src/styles.css`, `src/components/DatePicker.tsx`, `src/components/MarkdownEditor.tsx`, and `src/App.tsx`, rather than an independently approved brand identity. The name きろく, descriptive palette names, and exact visual values are implementation defaults. Japanese system sans is the established application type choice; there is no display-font treatment or packaged webfont. The wordmark is text only, without an adjacent icon or tagline. The only shipped art asset is the geometric SVG favicon; development review screenshots are not product imagery.

**Key Characteristics:**

- Pale ground and white writing surfaces separated by fine borders.
- Date-first hierarchy and compact, explicit Japanese save labels.
- Roomy writing text, compact task controls, and an accessible Japanese calendar chooser.
- Restrained color transitions and progress rotation, respecting reduced motion.

## Colors

The palette uses a forest primary family and green-tinted neutrals, with functional ochre, blue-grey, and red-brown states.

### Primary

- **Forest** (`accent`): primary actions, focus rings, selected tabs, links, caret, and Markdown headings. `accent-hover` deepens primary-button hover; `accent-light` gives quiet actions and the today marker a pale fill.

### Neutral

- **Paper / pale ground** (`paper`, `surface`, `sidebar`): white editor and controls, the page ground, and the slightly deeper navigation field.
- **Graphite / quiet text** (`ink`, `muted`): main text and supporting copy. Quiet text is shared with editor placeholders and Markdown processing instructions and quotes.
- **Fine division** (`line`): one-pixel boundaries between rows, controls, panels, and sections.
- **Navigation selection** (`nav-selected`, `nav-selected-ink`): tonal selection on desktop. Mobile changes selection to an accent underline.
- **Hover / text selection** (`row-hover`, `selection`, `selection-ink`): list hover and editor/browser text selection.

### Functional states

- **Saved green** (`state-saved`), **local ochre** (`state-local`), **busy blue-grey** (`state-busy`), and **problem red-brown** (`state-problem`) distinguish synchronization states alongside an icon and text.
- **Danger** (`danger`) marks destructive action text. Warning and danger surface/ink/line families frame actionable notices; the conflict panel uses its own warm paper treatment.
- **Weekdays:** `weekday-ink` is green for Monday–Friday, `weekday-sunday` is muted red, and `weekday-saturday` is muted blue. List labels, the editor's short weekday, and calendar weekday headings share these colors. Each has at least 4.60:1 contrast on paper and the page surface; day names remain visible alongside the color.

**The Explicit Status Rule.** Pair save-state color with an icon and the actual Japanese state label. Preserve the distinction between 端末保存済み and 保存済み.

The sidecar's eight-step tonal ramps are generated panel previews, not additional shipped UI colors or a replacement for these primitives.

## Typography

**Application font:** the Japanese sans stack in the frontmatter. It uses locally available fonts with a generic sans fallback; no font file is shipped. **Code font:** the monospace stack is limited to rendered Markdown code. Font synthesis is disabled.

The hierarchy uses moderate weight changes and generous line spacing. Source headings receive syntax color without changing their font size. Tabular numerals stabilize dates and byte/status metadata where implemented.

### Hierarchy

- **Page title:** `title` is the base heading style, reduced to (25px) at the mobile breakpoint. List, trash, and settings retain one screen-reader-only page heading; their selected navigation item supplies visible page context.
- **Diary date:** `diary-date` defines the compact year-first date trigger at every viewport size. The chooser displays `YYYY/MM/DD`, alongside a quieter short weekday and, when applicable, 今日.
- **Section title:** `section`; settings and conflict titles use (17px), reducing to (16px) and (15px) respectively on mobile.
- **Source:** `source`; fixed (16px) with (1.95) line-height on every viewport, including Markdown headings. The editor inherits the application font rather than switching the whole document to monospace.
- **Preview:** `preview`; rendered heading sizes are (27px), (22px), and (18px), with (1.6) line-height. Preview paragraphs use vertical margins of (12px). A single source newline renders as a visible line break; blank lines retain paragraph separation. This display rule does not change the saved Markdown source.
- **Controls and copy:** `label` and `label-small`; most supporting prose is (12–14px), with settings text capped at (68ch).
- **Save status:** `status` uses (11px) in rows on desktop and mobile; the diary heading uses (12px). Byte/footer metadata is (10px), reducing to (9px) on mobile; these small values describe the current build, not a new minimum text-size standard.

**The Stable Source Rule.** Keep the source editor at its fixed text size; heading syntax must not reflow the writing surface by increasing heading font sizes.

## Layout

The desktop shell has a fixed left navigation width of (228px), and the workspace has the matching left margin. Content begins with task controls, without a separate top bar or repeated page introduction. Standard content is centered in a border-box maximum width of (956px) with (48px) horizontal padding, yielding an (860px) inner column at its maximum. The diary uses a wider maximum of (1020px), yielding an (924px) inner column. The session screen has its own (540px) maximum.

Spacing is a set of observed, task-specific steps, not a strict arithmetic scale. Small action gaps use (6–10px), control groups and text flow use (12–17px), and section intervals use (24–30px). Month headings group full-width date rows. Each row contains the day number, weekday, optional today marker, and save state without repeating its month or date. Rows use the frontmatter padding and a (78px) minimum height. Settings use divided sections rather than cards; the first section starts with (8px) top padding.

| Boundary           | Implemented behavior                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| At or above 1450px | Standard content retains 28px top padding; diary retains 22px top padding.                                                                                                                                                                                                                                                                                                                                                                                 |
| At or below 1000px | Navigation width and workspace offset become 202px; content padding becomes 24px 30px 48px, with diary top padding 18px.                                                                                                                                                                                                                                                                                                                                   |
| At or below 700px  | Navigation spans the viewport edge to edge with three equal-width columns and no gaps or outer horizontal padding. Each link has 10px vertical / 8px horizontal padding and centered contents. The brand and today action retain 20px side insets, and the sidebar footer disappears. Workspace offset becomes zero. Standard content padding is 12px 20px 36px; diary content is 8px 16px 85px. Date rows use 12px 4px padding and a 74px minimum height. |

While editing on mobile, the navigation row hides and the identity band compacts. The formatting toolbar is fixed across the viewport above `--keyboard-inset`, which the editor updates from `visualViewport`; safe-area bottom padding is added. Its eight buttons share the width, each with a (42px) height and (55px) maximum width. Desktop formatting remains a sticky row at the editor's bottom. Preserve the content bottom clearance needed by this toolbar.

## Elevation & Depth

The application is flat at rest: pale fields, white paper, and one-pixel borders establish grouping. Buttons, navigation, diary rows, and the editor do not carry shadows. The modal and toast are the only shadowed surfaces: modal shadow (`0 18px 70px #1c2e2333`), toast shadow (`0 7px 22px #1b30221c`). The dialog backdrop is a translucent green-black (`#20312766`).

**The Flat Work Surface Rule.** Use tonal differences and fine borders for ordinary work surfaces; reserve the implemented shadows for overlays and transient feedback.

## Shapes

Corners are softly rectangular. Small text actions and the today marker use `rounded.text`; editor tools and code blocks use `rounded.small-control`; desktop navigation and calendar controls use `rounded.input`; buttons use `rounded.button`; editor and conflict panels use `rounded.panel`; general dialogs use `rounded.dialog`; the calendar uses `rounded.calendar`. The mobile editor tightens to (7px). List rows and selected-tab underlines remain square. Empty states use plain text and useful actions, without decorative symbols or slogans. An empty list reads 日記はまだありません, empty trash reads ゴミ箱は空です, and an empty editor prompts 本文を入力. The session screen also omits decorative branding icons and taglines.

Use stroke SVG geometry for functional icons, as the implementation does through Lucide. Keep the きろく wordmark text only. The favicon is a rounded forest square containing a fine line notebook symbol. There is no raster-art vocabulary to propagate.

## Components

### Buttons

Familiar, compact controls with a clear action hierarchy. Primary buttons use forest with paper text; secondary buttons use paper, graphite, and a one-pixel divider-color border. Both use the frontmatter padding and a (44px) minimum height. The compact variant is (38px) minimum height with (6px 12px) padding. Text actions have a (36px) minimum height. Disabled buttons use (0.4) opacity and the default cursor.

Hover changes color over (0.15s); primary hover deepens forest, secondary hover uses (`#eef1ea`), and text actions use the pale accent. Keyboard focus on buttons, links, inputs, and textareas is an accent outline (2px) with a (4px) offset. Selects use the same outline with a (3px) offset; calendar days tighten it to (1px). Mobile navigation uses an inward (-3px) outline offset so focus remains visible at the viewport edges. Do not copy the editor's removed CodeMirror container outline onto other controls.

### Today marker

A compact contextual chip, with pale accent fill, forest text, (10px) type, and the frontmatter padding. It identifies today's list row; it is not a general filter-control system.

### Inputs / Fields

Merge and copy textareas use a fine border, (13px) padding, (16px) type, and (1.8) line-height; they resize vertically. Date selection uses the dedicated calendar chooser rather than editable date segments or manual date fields.

### Date chooser

The list has one 日付からひらく trigger. Selecting a calendar day opens that day's diary immediately; there is no second open action. The editor uses the same chooser in a compact `YYYY/MM/DD` trigger. Trash has no date jump; its optional ゴミ箱について disclosure holds restoration and deletion guidance.

The local modal calendar uses native Japanese year and month selects, a stable six-week day grid, previous/next month actions, and a 今日 shortcut. Each select retains the native option menu while its wrapper positions a Lucide chevron (12px) from the right edge; (36px) right padding keeps the label clear of the icon. The year select centers a window of up to (201) years on the displayed year, bounded to (1–9999). Selecting a year recenters that window, so distant dates remain reachable without a full-range menu. The footer contains only the 今日 action, without a repeated current-date label.

The trigger uses paper, a fine border, forest text, the frontmatter padding, and a (44px) minimum height. Its compact editor variant is transparent, hides the leading calendar icon, and uses the diary-date type role. The popup uses the frontmatter width and padding with a maximum height of `calc(100dvh - 32px)` and internal overflow. Year/month selects have (14px) text, (44px) minimum height, and flexible widths of (96–114px) and (78–86px). At or below (360px), dialog padding becomes (12px), and month-navigation / select gaps become (4px), keeping the controls within a (320px) viewport. Month and close buttons are (44px) square; day cells have a (46px) minimum height and day buttons are up to (44px) square. Selection uses forest fill and paper text; today has a forest border; dates outside the displayed month use muted text.

Opening focuses the selected day. Arrow keys move by day or week; Home/End move to the week's edges; Page Up/Down move a month, or a year with Shift. Escape, the close action, or the backdrop cancels; closing restores trigger focus. Each day has its full Japanese date and weekday as its accessible name, selection uses `aria-selected`, and today's date uses `aria-current="date"`. Native modal behavior contains focus while open.

### Navigation and diary rows

Desktop links have a (46px) minimum height, modest rounding, and tonal selection with stronger weight. At or below (700px), the three mobile links use equal-width `minmax(0, 1fr)` columns with no gaps or outer horizontal padding. Each hit area, hover area, and active underline spans one third of the viewport, including its edge. Contents are centered with (10px 8px) padding. The links retain a (44px) minimum height, square corners, and a (2px) active underline. The current destination has `aria-current="page"`; diary editing keeps 日記一覧 selected. Diary rows retain a stable day-number column and a flexible weekday/status column, with status aligned to the opposite edge. Hover fills the entire row; the separating line remains the organizing device. Each row's accessible name retains its complete date.

### Editor

A compact date/navigation header combines one-action return to the list or trash, the date chooser, weekday, previous/next recorded entries, and actual save state. Its grid uses (40px) action columns, a flexible date column, and (8px) column gaps, reducing to (6px) on mobile. Save state occupies the line beneath the date in the same header. The group ends (12px) before the writing panel, or (10px) on mobile.

The writing panel is paper with a thin border. Its tab/action bar is (57px) tall, or (48px) on mobile. Source and preview tabs use a (2px) accent underline and weight (600) for selection; the bar also holds compact icon actions. Source text has (28px) side insets, reduced to (17px) on mobile, and a (360px) minimum host height. Preview uses (27px 29px 55px) padding, reduced to (21px 18px 40px).

Preview preserves visible single line breaks through `remark-breaks`, so one Enter in ordinary prose starts a new display line. It does not insert trailing spaces or rewrite source text; editing, saving, copying, and Markdown download retain the original source. GFM lists, task markers, paragraphs, and code keep their existing structure.

The formatting toolbar uses real labelled SVG buttons; each has a Japanese accessible name. During IME composition the toolbar disables, and pointer-down preserves the current editor selection. Text selection uses the selection tone; caret and cursor use forest. CodeMirror's container outline is intentionally removed; the text cursor and selection communicate editing position.

### Save state and notices

Save state is an inline icon/label pair, (6px) apart, with no wrapping. The labels are 保存済み, 端末保存中, 端末保存済み, 同期中, 未同期, ログインが必要, 内容の確認が必要, and 保存できていません. A new, empty date reads まだ記録されていません. Use concise Japanese copy that names the current condition and a concrete next action.

Errors use the shared `ErrorNotice`: one short title, a plain Japanese explanation, and recovery controls in the same notice. Do not display browser exceptions or API messages directly. A list failure offers 一覧を読み直す and never looks like a first-use empty list. An export failure offers もう一度エクスポート and retries export itself. Authentication offers ログイン画面を開く followed by ログイン後に保存を再開. Server save errors explain where the current text remains and offer 本文をコピー and Markdown保存 beside retry. Local storage failures place these escape actions first and emphasize copying before retrying storage.

A failed diary read with no pending changes uses 日記を読み込めませんでした and 日記を読み直す. Its state label is 読み込みできていません; do not claim the unknown diary is empty or saved. If a cached diary exists, identify the displayed text as the device copy whose latest server content has not yet been confirmed.

During an HTTP-requested retry delay, show 再試行までお待ちください on the disabled retry control and explain the wait below the actions. The control becomes available at the deadline. A deliberate diary read otherwise retries immediately, without silently discarding an early tap.

Error titles use (15px) type and descriptions use (14px), including on mobile. Action buttons wrap with an (8px) gap and retain (44px) targets. The primary recovery uses forest; supporting actions have a transparent ground and an ink-colored border. A local-storage warning emphasizes 本文をコピー instead of retry. The separate エラー情報をコピー text action also has a (44px) target and copies only fixed classification, operation, HTTP status, and copy time. Diary text, raw exception messages, account details, URLs, and credentials never enter that report. Copy rejection opens a labelled read-only textarea with すべて選択 and manual-copy guidance; the title distinguishes diary text from error information.

Keep routine save explanations in settings or first-use empty states. The editor retains its actual save status and actionable notices rather than a repeated generic autosave paragraph. Export scope, local-storage risks, restoration guidance, and conflict instructions remain where they affect a decision.

Warning and danger notices combine a tinted fill, matching border, icon, and text; actions wrap on small widths. Conflict resolution is a warm paper panel with both versions visible and wrapping action buttons. Version text is preserved with `pre-wrap` and its own scrolling boundary, not truncated.

### Dialogs, feedback, and motion

General confirmation and copy dialogs are at most (510px) wide, with width `calc(100% - 36px)`, padding (26px), and the overlay treatment above. Mobile padding is (21px); the date chooser keeps its separate compact dimensions. Toasts float above page content and shift above the mobile toolbar. Progress indicators rotate linearly over (1.2s); ordinary interaction only transitions background and text color. Reduced-motion mode removes transitions and smooth scrolling, and reduces animations to one (0.01ms) iteration.

## Do's and Don'ts

### Do:

- **Do** keep dates and actual save-state labels visible together in diary and list views.
- **Do** use the existing Japanese sans stack, source size, and generous writing line-height.
- **Do** preserve fine divisions, pale fields, and the established button hierarchy.
- **Do** keep the wordmark text only, use current navigation for page context, and retain semantic page headings for assistive technology.
- **Do** use the Japanese calendar chooser for a single date-selection action and keep complete dates in accessible row labels.
- **Do** retain visible focus, labelled SVG actions, IME handling, keyboard clearance, and reduced-motion behavior.
- **Do** write clear Japanese condition-and-action copy, distinguishing device storage from server synchronization.

### Don't:

- **Don't** collapse local-save and server-save status into one success message.
- **Don't** enlarge Markdown source headings or substitute a monospace font for the whole source document.
- **Don't** add shadows to ordinary rows, controls, or the writing surface.
- **Don't** repeat page context or routine instructions above the primary task controls.
- **Don't** treat generated tonal ramps, development screenshots, or the provisional app name as approved brand assets.
