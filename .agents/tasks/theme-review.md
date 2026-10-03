# Dark/Light theme toggle for the expense tracker

A header toggle switches the app between light and dark color schemes. The theme is driven entirely through the existing `:root` custom properties: a new `[data-theme="dark"]` block on `<html>` overrides the color tokens, and every component rule keeps referencing the same tokens, so nothing hardcodes dark colors. A new static `ThemeManager` resolves the preference (saved choice, else OS `prefers-color-scheme`), applies it, persists it under `expense-tracker-theme`, and syncs the toggle's `aria-pressed` and icon. The Chart.js pie chart reads its legend/tooltip/border colors from the active tokens at build time and re-reads them on toggle. The feature was committed earlier in the workflow; the current working tree reflects two repairs the verifier made so the feature could actually run.

Watch for: the toggle lives in a `position: sticky` header and is positioned `absolute` (confirmed — sticky is a positioned containing block, so this anchors correctly). The custom-categories feature on this branch throws at startup; `ThemeManager.init()` was moved into a `finally` so the toggle survives that failure (confirmed), but the categories breakage is a real pre-existing defect outside this task's scope (confirmed). No blocking issues for the theme feature itself.

**Verdict**: APPROVED

## High-level view

Theming is token-only. The dark palette is a single `[data-theme="dark"]` override of the `:root` color variables, and because the component layer never changed, correctness depends on those tokens being complete and contrast-safe rather than on any per-component dark rule. The verifier computed each dark pair against AA; the details section lists the numbers.

The API surface is small: one Local Storage key (`expense-tracker-theme`, values `"light"`/`"dark"`), the OS-preference fallback on first load, and a `data-theme` attribute on `<html>`. Storage is read and written through the same try/catch guarding `StorageManager` uses, so a blocked storage degrades to in-session-only toggling without throwing.

The chart stays in sync by treating the CSS tokens as the single source of truth: `getThemeColors()` reads `--color-text` and `--color-background-alt` off the root, `createChartConfig()` applies them at build time, and `refreshTheme()` re-applies and calls `update()` on toggle. Category segment fills are deliberately unchanged in both themes because brightening them would drop their white-text contrast below AA.

The one structural wrinkle is bootstrap ordering. `ThemeManager.init()` runs in a `finally` so the toggle binds even though `UIManager.initialize()` currently throws (a defect from the unrelated custom-categories commit). That keeps the theme feature working but means a reviewer should not read a green theme toggle as evidence the rest of the app boots — it does not.

<details>
<summary>Issues (3)</summary>

1. **Light-theme `--color-text-secondary` is near-white (pre-existing, out of scope)** — `#f9f4f4` on white is effectively invisible for `.empty-state`/`.transaction-category`; the a11y comment block still claims `#666666`. Not introduced here and intentionally left untouched (changing it risks the header where white secondary text is intended). No action in this task; worth a separate ticket. (confirmed)
2. **Custom-categories startup error (pre-existing, out of scope)** — `UIManager.initialize()` throws on load from commit `ee47bd5`, showing the global error banner. The theme toggle was made resilient to it via the `finally` guard, but the categories feature itself remains broken and needs its owner. (confirmed via verification note; not re-run here)
3. **Chart theme correctness not exercised with a live chart** — headless jsdom/Edge could not drive a chart-present toggle because the app throws before the chart builds; chart color paths were verified by reading the built config and by code inspection only. Low risk given the code is straightforward, but it is the one path without a rendered-chart assertion. (confirmed as a coverage gap)

</details>

<details>
<summary>Details</summary>

### Token-only dark palette

The dark theme is one selector, `[data-theme="dark"]`, placed right after `:root`, overriding only color tokens: surfaces (`--color-background` `#121212`, `--color-background-alt` `#1e1e1e`), borders (`--color-border` `#6b6b6b`, `--color-border-focus` `#4d9fff`), text (`--color-text` `#eaeaea`, `--color-text-secondary` `#b0b0b0`), primary (`#1a73e8`/`#4285f4`), error trio, success, and deeper shadow tokens. No component rule was added or edited to carry a dark color, which is exactly the constraint the task set. Because the whole scheme rides on these tokens, the verifier's contrast computation is the real correctness check, and every pair clears AA: text 15.57:1, secondary 8.64:1 on `#121212`, border 3.52:1 (meets the 3:1 UI floor), white on primary 4.51:1, error 6.77:1, focus 6.89:1.

Category badge colors are deliberately identical across themes. They are applied inline by JS from the category palette and use white text; the built-ins (`#dc2626`/`#2563eb`/`#7c3aed`) sit at ~4.68/4.68/5.96:1 against white, and brightening them for the dark surface would have pulled white-text contrast under AA. Keeping them is the correct call and matches the requirement's "unless a dark variant improves contrast" escape hatch — here it would not.

One pre-existing inconsistency sits in the light theme: `--color-text-secondary` is `#f9f4f4` (near-white), while the a11y comment block and `.empty-state`/`.transaction-category` still assume `#666666`. On the light background that secondary text is effectively invisible already. This is not introduced by theming and was intentionally left untouched, since the light value also feeds the header where white-on-blue secondary text is intended. Coincidentally the dark override (`#b0b0b0`) reads better on dark than the light theme does on white.

### Toggle button and positioning

The button carries `type="button"`, `aria-label="Toggle dark mode"`, `aria-pressed="false"`, and a decorative `aria-hidden="true"` icon span, and sits inside `<header id="balance-section">`. Styling uses the shared `--min-touch-target` (44px) for both min-width and min-height, a `--transition-fast` hover on `background-color`/`transform`, and a `:focus-visible` ring (3px white outline plus a `--color-border-focus` box-shadow) consistent with `.btn-primary`.

It is positioned `absolute` (top/right) against `#balance-section`, which is `position: sticky` rather than `relative`. A sticky element is a positioned containing block, so the toggle anchors to the header as intended and the balance text stays centered — I confirmed the sticky/absolute pairing resolves correctly rather than escaping to the viewport.

### ThemeManager and the storage contract

`ThemeManager` is a static class mirroring `StorageManager`'s shape. `getStoredTheme()` reads `expense-tracker-theme`, returns only `'dark'`/`'light'` and `null` on anything else (unrecognized value, or a throwing `localStorage`), wrapped in try/catch so it never propagates. `getPreferredTheme()` returns the stored value when present, else probes `matchMedia('(prefers-color-scheme: dark)')` (guarded for environments without `matchMedia`), defaulting to light. `applyTheme()` sets or removes `data-theme="dark"` on `document.documentElement`, then syncs the toggle's `aria-pressed` and swaps the icon (moon in light, sun in dark — a consistent convention documented in the class JSDoc and the README). `saveTheme()` returns false instead of throwing when persistence fails, which is what lets the toggle keep working in-session when storage is blocked.

The verifier's headless run confirms the full round trip against the real markup: initial load with no saved preference follows the OS setting, click one flips to dark (`data-theme=dark`, `bg=#121212`, `aria-pressed=true`, `stored=dark`), click two reverts and stores `light`.

### Chart stays token-driven

`getThemeColors()` reads `--color-text` and `--color-background-alt` off the root with sensible fallbacks. `createChartConfig()` consumes them at build time for legend label color, tooltip title/body color, and the dataset `borderColor`, so a chart first built while already in dark mode is correct immediately. `refreshTheme()` re-reads the tokens, reassigns those same three targets on the live instance, and calls `update('none')`; `ThemeManager.toggle()` and `init()` both reach it through `refreshChart()` via the module-scoped `uiManager`, keeping ThemeManager decoupled from component wiring.

Worth flagging: the segment border moved from the old hardcoded `#FFFFFF` to `--color-background-alt`. That is the right direction — slices now separate against the actual chart surface in both themes instead of assuming a white backdrop. The one coverage gap is that no live-chart toggle was exercised headless (the app throws before the chart builds on this branch), so these paths rest on config inspection and code reading rather than a rendered assertion.

### Bootstrap resilience and the pre-existing categories defect

`ThemeManager.init()` was moved into `initApp()`'s `finally`, guarded by its own try/catch. The storage-unavailable early `return` still falls through to the `finally`, so even when the form is locked the toggle applies the OS preference and binds — correct, since the toggle lives outside the locked form and theming does not depend on storage.

This resilience exists because the unrelated custom-categories commit (`ee47bd5`) left `UIManager.initialize()` throwing at startup; without the `finally`, theme init would be skipped and the toggle never bound. The repair is sound and in-scope for "theming initializes without throwing even when the rest of boot is impaired." But the categories failure itself is real and unfixed — `initApp()` catches it and shows the global error banner. That belongs to the custom-categories owner, not this task, and the verifier flagged it rather than guessing at the intended behavior.

### README and verification posture

The README adds the required "Theme / Dark mode" subsection (header toggle, OS-preference default, persistence under `expense-tracker-theme` with the storage-unavailable degradation noted, chart adaptation) and lists both keys in the Local Storage schema. The code matches house style: ES6 static classes, camelCase, JSDoc, no inline styles/scripts, no new dependencies. Per the task I did not re-run the build or server; the verification note separates what was proven programmatically (parse integrity, the end-to-end toggle on the real body, contrast math, token flips) from what rested on code inspection (the live-chart color paths), and the one thing I spot-checked by reading — the sticky/absolute containing-block interaction — holds.

</details>

<details>
<summary>File map</summary>

- `index.html` — adds the `#theme-toggle` button (and icon span) inside the balance header.
- `css/styles.css` — adds the `[data-theme="dark"]` token overrides, the `#theme-toggle` styling/hover/focus rules, and a `body` color transition (neutralized by the existing reduced-motion block).
- `js/app.js` — adds the `ThemeManager` static class, makes `ChartComponent` theme-aware (`getThemeColors`/`refreshTheme` plus build-time colors in `createChartConfig`), and wires `ThemeManager.init()` into `initApp()`'s `finally`.
- `README.md` — adds the "Theme / Dark mode" subsection and the `expense-tracker-theme` key to the Local Storage schema.

Full diff: `git diff 9b52096 322644a` for the feature commit, plus `63c891e`/`0cbe6bf` for the stitch/verification repairs on the current tree.

</details>
