# Theme / Dark-mode — Verification Note

## Scope of this task
Add a dark/light theme toggle to the expense tracker (button in the header,
persisted choice, OS-preference default, theme-aware Chart.js). The theme
feature itself was implemented and committed earlier in this workflow
(`322644a feat(theme): ...`); this run verified it end-to-end and repaired two
things that were blocking it from running (details under "Repairs").

## Environment constraints
- No Node.js (`node` absent). No usable Python (`python`/`python3` resolve to
  the Windows Store stub and refuse to run), so the README's
  `python -m http.server 8000` and any JS linter could not be used.
- Fallbacks actually used:
  - PowerShell `System.Net.HttpListener` static server
    (`.agents/tasks/_serve.ps1`) on `http://localhost:8000` (utf-8).
  - Microsoft Edge driven headless (`--headless=new --dump-dom`) to render
    pages and read real DOM / computed-style / `window.onerror` output.
  - WCAG contrast ratios computed deterministically in PowerShell.
- This is a DOM/computed-style assertion + headless-render verification, not a
  manual click-through with a visible browser (no interactive browser could be
  driven here). Screenshots were not captured; computed-style and DOM-state
  assertions were used instead, as the task permits.

## What was verified (real browser, headless Edge)

### app.js parses with no errors
`http://localhost:8000/_err.html` (loads `js/app.js`, `window.onerror` capture):
`LOADED_OK typeofTheme=function typeofCategory=function typeofUI=function`
=> No SyntaxError; `ThemeManager`, `CategoryManager`, `UIManager` all defined.

### Toggle works end-to-end on a faithful copy of the real index.html body
`_index_dbg.html` (real `index.html` body + `window.onerror` capture, clicks the
toggle twice and reads computed styles):
```
initThemeOnLoad data-theme=(none) pressed=false bg=#ffffff
afterClick1     data-theme=dark   pressed=true  bg=#121212 text=#eaeaea stored=dark
afterClick2     data-theme=(none) pressed=false bg=#ffffff           stored=light
```
Confirms, against the real markup/CSS/JS:
- (a) the toggle switches light <-> dark (data-theme, `--color-*` tokens flip),
- (b) the choice persists (`expense-tracker-theme` = dark then light),
- (c) `aria-pressed` tracks the state,
- (d) first load with no saved preference follows the OS setting
  (`OS_prefers_dark=false` -> initial light).

### ThemeManager unit-level behavior (harness)
`getPreferredTheme()` returns `dark` when stored dark, `light` when stored light;
`applyTheme('dark')` sets `data-theme=dark`, `aria-pressed=true`, sun icon, and
flips tokens to the dark palette; `applyTheme('light')` reverts. No exceptions.

### Chart theme-awareness
`ChartComponent.getThemeColors()` reads `--color-text` / `--color-background-alt`
from the root; `createChartConfig()` sets legend/tooltip colors + segment
`borderColor` from them at build time; `refreshTheme()` re-applies them and
calls `update()`. `ThemeManager.init()`/`toggle()` call `refreshChart()`.
NOTE: a chart-present click-through could not be fully exercised headless
because the host app's startup currently throws before the chart builds (see
"Known remaining issue"); the chart code paths were verified by reading the
built config in the ThemeManager harness and by code inspection.

### WCAG AA contrast of the dark tokens (computed)
- text `#eaeaea` on `#121212` = 15.57:1 (on `#1e1e1e` = 13.86:1) — text >=4.5 OK
- secondary `#b0b0b0` on `#121212` = 8.64:1 — OK
- border `#6b6b6b` on `#121212` = 3.52:1 — UI >=3 OK
- white on primary `#1a73e8` = 4.51:1 — OK
- error `#f87171` on `#121212` = 6.77:1 — OK
- focus `#4d9fff` on `#121212` = 6.89:1 — OK
- Category badges keep light-theme hues (`#dc2626`/`#2563eb`/`#7c3aed`,
  ~4.68/4.68/5.96:1 white-text). Brightening for dark would have dropped
  white-text contrast below AA, so per the task they are inherited unchanged.

### Static checks
`js/app.js` braces 556/556 balanced; theme wiring present across
`index.html`, `css/styles.css`, `js/app.js`, `README.md`.

## Repairs made this run (needed for the theme feature to run)

1. **Re-stitched `TransactionListComponent`** in `js/app.js`.
   A later, unrelated commit (`ee47bd5 feat: add user-defined custom
   categories`) rewrote `app.js` and mis-stitched the file: it inserted
   `class MonthlySummaryComponent` into the middle of
   `TransactionListComponent`, leaving that class unterminated and displacing
   its `removeTransaction`/`onDelete`/`showEmptyState`/`hideEmptyState` methods
   below `MonthlySummaryComponent`. Headless Edge reported
   `Uncaught SyntaxError: Unexpected identifier 'MonthlySummaryComponent'
   @ js/app.js:1739`, which prevented the ENTIRE script (including the theme
   feature) from loading. Fix: moved the displaced methods back inside
   `TransactionListComponent` and removed the duplicated orphan block. The
   method bodies were restored verbatim from the file's own displaced copy (no
   behavior invented). After the fix app.js parses clean.

2. **Made theme init resilient** in `initApp()` (`js/app.js`).
   `ThemeManager.init()` previously ran only after `uiManager.initialize()`
   inside the same `try`. Because the custom-categories feature's
   `uiManager.initialize()` currently throws on startup, theme init was being
   skipped and the toggle never bound. Moved `ThemeManager.init()` into a
   `finally` block (guarded by its own try/catch) so the toggle always
   initializes regardless of other init failures. This matches the plan's
   item 6 requirement that theming initialize without throwing even when the
   rest of boot is impaired. Verified: the toggle now binds and works even
   while the categories init still fails.

## Known remaining issue (OUTSIDE this task's scope)

The custom-categories feature (commit `ee47bd5`) has a **runtime error in
`UIManager.initialize()`** that still throws on startup. `initApp()` catches it
and shows the global error banner:
"Something went wrong while starting the application. Please reload the page."
Evidence (`_index_dbg.html`, before the theme-init move): `uiManager=object`
(constructed) but the banner is visible with that message, and `window.onerror`
captured nothing because `initApp`'s own try/catch swallows it.

With repair #2 the theme toggle works despite this, but the categories feature
itself remains broken on load. Diagnosing/fixing that belongs to whoever owns
the custom-categories feature — it is a different feature, and this task should
not guess at its intended behavior. This is flagged to the caller.
