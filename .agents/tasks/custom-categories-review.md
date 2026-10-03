# Custom categories for the expense tracker

The change lets users add their own expense categories alongside the three permanent built-ins (Food, Transport, Fun), delete the custom ones when nothing uses them, and have those categories flow through validation, the pie chart, the per-transaction badges, and the monthly summary chips. A new instance-based `CategoryManager` owns the custom list, persists it under `expense-tracker-categories` with the same versioned-payload / never-throw contract the transaction store already uses, and assigns each custom category a stable color from a fixed accessible palette so badges and chart slices share one source of truth. `TransactionManager` now takes the manager by injection and iterates the dynamic active list for validation, category totals, and monthly summaries. The add flow is an inline keyboard-operable input triggered by a `+ Add new category…` dropdown sentinel; deletion lives in a "Manage categories" disclosure that lists only custom categories.

Watch for: the custom-color palette starts at index 0, so the first three custom categories are handed the exact built-in colors (red/blue/purple) — a visual-ambiguity gap that contradicts both the plan and the method's own comment (confirmed, non-blocking). Separately, the verification note claims badge text renders white, but a pre-existing `.transaction-category { color: var(--color-text-secondary) }` rule later in the cascade overrides `.category-badge { color: white }` — this is unchanged from the base branch and therefore out of scope, but the "white text" evidence is inaccurate (confirmed, non-blocking).

**Verdict**: APPROVED

## High-level view

The persistence and merge model matches the plan exactly: built-ins are constants that always lead the active list and are never stored, only custom `{name,color}` entries are persisted, and `load()` validates structure, drops malformed and duplicate entries, and returns `[]` on any failure without throwing. Save failures keep the in-memory add so categories remain usable in-session.

Validation is centralized and dynamic. `CategoryManager.validateName` trims, rejects empty, caps at a documented 30 characters, rejects the reserved sentinel, and rejects case-insensitive duplicates of any active name. `TransactionManager.validateTransaction` gained an optional fourth `activeCategories` parameter defaulting to the static list, and both live call sites pass `getActiveCategories()`, so a transaction can only reference a currently-active category.

Totals and the chart are driven off the same dynamic list. `getCategoryTotals` and `getMonthlySummaries` seed every active category at zero (complete totals) while the chart's existing all-zero empty-state behavior is untouched, so a zero-spend custom category behaves exactly like a zero-spend built-in. Badge and slice colors both resolve through `getCategoryColor`, so the chart always matches the badges.

The color story is where the one real gap sits: colors are accessible and consistent, but custom categories draw from palette index 0 upward, which reuses the three built-in colors before reaching the five distinct hues. The UI surface (inline add, manage-list delete, dropdown re-render, multi-tab reload on the categories key) is complete, accessible, and built entirely with DOM APIs rather than innerHTML.

<details>
<summary>Issues (2)</summary>

1. **Palette reuses built-in colors for first customs** — `addCategory` picks `PALETTE[customCount % 8]` starting at index 0, so the first three custom categories get Food red, Transport blue, and Fun purple, making them visually indistinguishable from built-ins and contradicting the method's own "starting after them" comment. Start assignment at index 3 (`3 + customCount % 5`, or reserve the first three palette entries) so customs get the five distinct hues first.
2. **Verification claims white badge text, but grey wins the cascade** — `.category-badge { color: white }` is overridden by the later, equal-specificity `.transaction-category { color: var(--color-text-secondary) }` (#666) on list/summary badges; this is unchanged from the base branch (the old `.category-Food` white rule was overridden the same way), so it is out of scope for this PR, but the verification note's "white text" statement is inaccurate and the ≥4.5:1-against-white palette evidence does not describe what actually renders.

</details>

<details>
<summary>Details</summary>

### CategoryManager persistence and merge model

`CategoryManager` mirrors `TransactionManager`: instance-based with injected storage, built-ins as a `static BUILT_INS` constant, custom entries held in `this.customCategories` as `{name, color}`. `getActiveCategories()` returns `[...BUILT_INS, ...customNames]`, so built-ins always lead and customs follow in insertion order. Only customs are persisted, under `expense-tracker-categories` with payload `{ version, categories }`, matching the transaction store's versioned shape.

`load()` reuses the never-throw contract: it returns `[]` on a missing key, a schema-structure failure, or any thrown error, and iterates entries dropping anything malformed (`isValidStoredCategory`) or case-insensitively duplicate — including a stored "custom" that collides with a built-in, which is treated as corrupt. `save()` returns false rather than throwing on quota/disabled storage. `addCategory` keeps the in-memory push even when `save()` fails, so a category stays usable in-session; `deleteCategory` rolls the splice back if the save fails, keeping memory consistent with storage.

### Dynamic active list drives validation and totals

`validateTransaction` takes `activeCategories = TransactionManager.CATEGORIES` as an optional fourth param and checks membership against it, falling back to the static list if a non-array is passed. Both call sites — `UIManager.handleFormSubmit` and `TransactionManager.addTransaction` — pass `getActiveCategories()`, so the dynamic list governs real submissions while the bare static signature stays safe. `getCategoryTotals` and `getMonthlySummaries` both resolve the active list once and seed every active category at zero, then guard accumulation with the same non-negative-integer-cents check used elsewhere, and skip transactions whose category is not currently active. Money stays integer cents throughout; the transaction schema is unchanged except that `category` may now be any active name.

### Color assignment reuses built-in hues

The palette is eight hues, each documented ≥4.5:1 against white, with the first three equal to the built-in colors. `addCategory` assigns `PALETTE[this.customCategories.length % PALETTE.length]`. Because the index starts at 0, the first custom category receives `#dc2626` (Food's red), the second `#2563eb` (Transport's blue), the third `#7c3aed` (Fun's purple), and only the fourth onward reaches the five distinct hues. The method's own comment says customs are "assigned starting after them," and the plan reserved the first three "for built-ins" — the code does neither. The colors remain accessible and the chart stays in sync with the badges, so this is not a correctness or accessibility defect, but a user who adds one custom category gets a badge the same color as Food. Starting the index at 3 (and cycling through the remaining five, or the full set after exhausting them) would honor the stated intent.

```js
// current
PALETTE[this.customCategories.length % PALETTE.length]        // first custom -> red (Food)
// honoring the comment/plan
PALETTE[3 + (this.customCategories.length % (PALETTE.length - 3))]  // first custom -> green
```

### Badge text color cascade (pre-existing, out of scope)

Both list and summary badges carry `transaction-category category-badge` / `monthly-category category-badge` with the background set inline from the resolved color. `.category-badge { color: white }` sits earlier in the stylesheet than `.transaction-category { color: var(--color-text-secondary) }`; at equal specificity the later grey rule wins, so the rendered badge text is #666, not white. This matches the base branch exactly — the removed `.category-Food/.category-Transport/.category-Fun { color: white }` rules were overridden by the same grey rule — so the diff introduces no regression. It is flagged only because the verification note asserts white text and leans on the palette's white-contrast figures, which do not describe the actual render. Confirming the real contrast of #666 text on each palette background (or scoping the white rule to beat the grey override) would make the badge-contrast evidence trustworthy, but that work predates this feature.

### Add / delete / dropdown UI

`renderCategoryOptions` rebuilds the select via DOM APIs only (no innerHTML, names set with `textContent`), keeping the blank placeholder first, active categories in the middle, and the `+ Add new category…` sentinel last, and restores the prior selection when it is still valid and non-sentinel. Selecting the sentinel reveals the inline input and focuses it; Enter confirms, Escape and the Cancel button revert to the previous selection; a failed add shows the message in `#new-category-error`, sets `aria-invalid`, and keeps the input open. The manage list renders one row per custom category only — built-ins never appear — and delete is delegated through a single listener. `handleDeleteCategory` builds the in-use set from live transactions and routes through `isDeletable`, blocking an in-use delete with a clear message rather than removing it. `categoryManager.onChange` re-renders the dropdown and manage list on every add/delete, and `handleStorageChange` reloads and re-renders when another tab writes the categories key, so multi-tab stays in sync. No new dependencies, `'use strict'` preserved, JSDoc density consistent with the surrounding code.

</details>

<details>
<summary>Files changed</summary>

- `js/app.js` — new `CategoryManager` class; `TransactionManager` takes the manager by injection and iterates the dynamic list for validation/totals/monthly summaries; chart and both badge components take a color resolver; `UIManager` gains the inline add flow, manage-categories list, dropdown re-render, and multi-tab reload for the categories key.
- `index.html` — empty category `<select>` populated by JS, inline add-category group (input + confirm/cancel + alert span), and a "Manage categories" disclosure.
- `css/styles.css` — per-name `.category-Food/-Transport/-Fun` rules and `--color-food/-transport/-fun` custom properties removed; single `.category-badge` rule added; styles for the inline add group and manage list.

Full diff: `git diff origin/main -- index.html css/styles.css js/app.js`

</details>
