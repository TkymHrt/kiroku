# Diary application

Mode: Operate. User's precise approved functional brief controls layout and workflow. No additional hearing required.

## Direction contract

THESIS: An everyday diary whose date and durability stay visible. A clean task-oriented UI without a dashboard of statistics.

OWN-WORLD: Cool pale green ground, deep forest actions, graphite text. Familiar controls, one-pixel divisions, generous reading space, system Japanese sans. Seven considered sources: municipal library signage, Japanese stationery grids, botanical labels, transit wayfinding, the quiet green of a neighborhood reading room, archival index cards, and morning newspaper type. Assigned fifth: reading room; express it through palette and space, never a literal scene.

STORY: The user sees recorded dates, opens today, writes, and can tell whether the newest text is on the device or the server. The signature interaction is the persistent save indicator alongside a stable editor and keyboard toolbar.

FIRST VIEWPORT: Desktop side navigation at 228px; the content starts directly with task controls, with no duplicate topbar or oversized page introduction. Mobile uses a text-only wordmark, a today action, and current-page navigation. The list opens with one calendar trigger and compact month/day/weekday/status rows. The editor combines back, a Japanese year-first date chooser, previous/next entries, and save state into one compact header above the edit/preview tabs. A small modal calendar selects a date directly, with month/year controls and no manual date fields.

FORM: Reading-room palette in standard application controls, fifth candidate; seed:f0a24fd77768d724. Challenger transit/notation motifs declined because they obscure diary task clarity; retained their stable alignment and space discipline. Code-led. User's no-additional-hearing instruction overrides interactive concept selection.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 2026-10-18 user-directed refinement

The user identified repeated page titles/descriptions consuming mobile screen space, US-formatted native date controls and excessive internal spacing, and an unnecessary icon beside the wordmark. Preserve the established palette, writing typography, save-state safety, and all diary functions. Remove redundant context, provide Japanese calendar selection without typing or a second Open action, and keep one-action list return while writing. Contextual safety and export-scope copy remains; routine explanatory copy belongs in settings or first-use empty states. This is a refinement of the established visual system, not a new identity.

The next refinement addresses errors for a nontechnical user. Replace raw browser/API messages with a concise Japanese condition, where the text remains, and a concrete recovery action. Retry the operation that failed; do not turn a failed list load into an empty-state invitation. Keep diary-text rescue beside save errors and separate it from privacy-safe diagnostic copying. Preserve source text and storage/sync safeguards. Use the same existing notice palette, larger readable copy, wrapping 44px actions, and a manual selection fallback when automatic copy is unavailable.

The user prefers plain, practical empty states: no poetic encouragement, large decorative icons, or taglines. Keep only a neutral empty message, useful actions, and a straightforward editor prompt. Apply the same restraint to the session screen.
