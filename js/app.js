// Expense & Budget Visualizer Application
// Application logic will be implemented in subsequent tasks

'use strict';

/**
 * StorageManager
 *
 * Provides an abstraction layer over the browser Local Storage API for
 * persisting transaction data. Implemented as a static class since storage
 * access is stateless and shared across the application.
 *
 * Methods (isStorageAvailable, loadTransactions, saveTransactions,
 * validateStoredData, clearStorage) are added in subsequent tasks.
 */
class StorageManager {
  // Local Storage key under which transaction data is persisted.
  static STORAGE_KEY = 'expense-tracker-transactions';

  // Schema version used to support future data migrations.
  static SCHEMA_VERSION = '1.0';

  /**
   * Check whether Local Storage is available and usable in the current browser.
   *
   * Some browsers expose `localStorage` but throw on write (e.g. Safari private
   * mode, or when storage is disabled). The only reliable test is to actually
   * perform a write/read/remove round-trip inside a try/catch.
   *
   * @returns {boolean} true if storage can be read and written, false otherwise
   */
  static isStorageAvailable() {
    try {
      const testKey = '__storage_test__';
      // Round-trip a value to confirm reads and writes both succeed.
      localStorage.setItem(testKey, testKey);
      const readBack = localStorage.getItem(testKey);
      localStorage.removeItem(testKey);
      return readBack === testKey;
    } catch (error) {
      // Access can throw (SecurityError, QuotaExceededError, etc.).
      console.error('Local Storage is not available:', error);
      return false;
    }
  }

  /**
   * Validate the structural shape of data parsed from storage.
   *
   * This is a shallow structure check only; individual transactions are
   * validated separately in loadTransactions().
   *
   * @param {*} data - Parsed JSON object retrieved from storage
   * @returns {boolean} true if data has a version field and a transactions array
   */
  static validateStoredData(data) {
    return (
      data !== null &&
      typeof data === 'object' &&
      typeof data.version !== 'undefined' &&
      Array.isArray(data.transactions)
    );
  }

  /**
   * Validate a single transaction object against the expected schema.
   *
   * Expected shape: { id, itemName, amount, category, timestamp }
   * where amount is a non-negative integer (cents) and timestamp is a number.
   *
   * @param {*} transaction - Candidate transaction object
   * @returns {boolean} true if the transaction has all required valid fields
   */
  static isValidTransaction(transaction) {
    return (
      transaction !== null &&
      typeof transaction === 'object' &&
      typeof transaction.id === 'string' &&
      transaction.id.length > 0 &&
      typeof transaction.itemName === 'string' &&
      typeof transaction.amount === 'number' &&
      Number.isInteger(transaction.amount) &&
      transaction.amount >= 0 &&
      typeof transaction.category === 'string' &&
      transaction.category.length > 0 &&
      typeof transaction.timestamp === 'number'
    );
  }

  /**
   * Load all transactions from Local Storage.
   *
   * Reads and parses the stored payload, validates its schema, then validates
   * each transaction individually. Corrupted transactions are filtered out and
   * logged rather than discarding the entire dataset. Never throws.
   *
   * @returns {Array} Array of valid transactions, or an empty array when data
   *                  is missing, unparseable, or structurally invalid.
   */
  static loadTransactions() {
    try {
      const rawData = localStorage.getItem(StorageManager.STORAGE_KEY);

      // No data persisted yet is a normal first-run state, not an error.
      if (rawData === null) {
        return [];
      }

      const parsed = JSON.parse(rawData);

      // Reject payloads that do not match the expected schema structure.
      if (!StorageManager.validateStoredData(parsed)) {
        console.error(
          'Stored data has an invalid schema structure; returning empty transactions.'
        );
        return [];
      }

      // Keep only well-formed transactions; log any that are dropped.
      const validTransactions = [];
      for (const transaction of parsed.transactions) {
        if (StorageManager.isValidTransaction(transaction)) {
          validTransactions.push(transaction);
        } else {
          console.warn('Skipping corrupted transaction:', transaction);
        }
      }

      return validTransactions;
    } catch (error) {
      // Covers JSON parse errors and any storage access failures.
      console.error('Failed to load transactions from Local Storage:', error);
      return [];
    }
  }

  /**
   * Save a transactions array to Local Storage.
   *
   * Wraps the array in the versioned storage schema, serializes it, and writes
   * it under STORAGE_KEY. Never throws; returns false on failure such as a
   * quota exceeded error or storage being disabled.
   *
   * @param {Array} transactions - Transaction objects to persist
   * @returns {boolean} true on success, false on failure
   */
  static saveTransactions(transactions) {
    try {
      const payload = {
        version: StorageManager.SCHEMA_VERSION,
        transactions: transactions
      };

      const serialized = JSON.stringify(payload);
      localStorage.setItem(StorageManager.STORAGE_KEY, serialized);
      return true;
    } catch (error) {
      // Typically QuotaExceededError or SecurityError when storage is disabled.
      console.error('Failed to save transactions to Local Storage:', error);
      return false;
    }
  }

  /**
   * Remove all stored transaction data from Local Storage.
   *
   * Intended for testing and reset flows. Never throws.
   *
   * @returns {boolean} true on success, false on failure
   */
  static clearStorage() {
    try {
      localStorage.removeItem(StorageManager.STORAGE_KEY);
      return true;
    } catch (error) {
      console.error('Failed to clear Local Storage:', error);
      return false;
    }
  }
}

/**
 * CategoryManager
 *
 * Owns the set of expense categories available to the user: the three
 * permanent built-ins (Food, Transport, Fun) plus any custom categories the
 * user adds. Instance-based with injected storage, mirroring
 * TransactionManager, so category logic stays testable and persistence stays
 * stateless. Only CUSTOM categories are persisted; built-ins are implicit and
 * always lead the active list.
 *
 * Each custom category stores a stable color assigned at creation from a fixed
 * accessible palette, so badges and chart slices share one source of truth and
 * stay consistent across reloads even if the palette changes later.
 *
 * Custom category shape: { name: string, color: string } where color is a hex
 * string legible with white text (>=4.5:1) in both themes.
 */
class CategoryManager {
  // Permanent, non-deletable built-in categories; always first in the active
  // list. Keep in sync with TransactionManager.CATEGORIES default.
  static BUILT_INS = ['Food', 'Transport', 'Fun'];

  // Local Storage key for custom categories, matching the 'expense-tracker-*'
  // convention used by the other managers.
  static STORAGE_KEY = 'expense-tracker-categories';

  // Schema version used to support future data migrations.
  static SCHEMA_VERSION = '1.0';

  // Documented maximum length for a category name (characters, after trim).
  static MAX_NAME_LENGTH = 30;

  // Sentinel <option> value used by the dropdown to trigger the inline
  // add-category flow. Reserved: never allowed as a real category name.
  static ADD_NEW_SENTINEL = '__add_new__';

  // Built-in colors preserve the app's established look: Food red, Transport
  // blue, Fun purple. These match the --color-food/-transport/-fun values the
  // CSS previously used and are white-text legible in both themes.
  static BUILT_IN_COLORS = {
    Food: '#dc2626',
    Transport: '#2563eb',
    Fun: '#7c3aed'
  };

  // Fallback color used when a category's color cannot be resolved. Grey keeps
  // an unknown badge/slice visible without implying a real category color.
  static FALLBACK_COLOR = '#CCCCCC';

  // Accessible palette for custom categories. Every hex is verified >=4.5:1
  // against WHITE text, so white badge text and dark-theme parity hold (same
  // bar the CSS documents for the built-ins). The first three mirror the
  // built-in colors; custom categories are assigned starting after them, but
  // assignment cycles the full palette so colors stay varied.
  static PALETTE = [
    '#dc2626', // red (Food)
    '#2563eb', // blue (Transport)
    '#7c3aed', // purple (Fun)
    '#047857', // green      (4.54:1 on white)
    '#b45309', // amber-brown(4.52:1 on white)
    '#be185d', // pink       (5.41:1 on white)
    '#0f766e', // teal       (4.76:1 on white)
    '#4338ca'  // indigo     (7.0:1 on white)
  ];

  /**
   * @param {typeof StorageManager} storageManager - Storage dependency used
   *        for loading and persisting custom categories. Only used for the
   *        availability check; this class reads/writes its own key directly to
   *        reuse the same never-throw try/catch contract.
   */
  constructor(storageManager) {
    // Keep a reference to the injected persistence layer (for availability).
    this.storageManager = storageManager;

    // In-memory list of custom categories ({ name, color }); populated by
    // initialize(). Built-ins are not stored here.
    this.customCategories = [];

    // Change listeners notified whenever the active list changes (add/delete),
    // so the UI can re-render the dropdown and manage list from one source.
    this.listeners = [];

    // Tracks whether initialize() has run.
    this.isInitialized = false;
  }

  /**
   * Load custom categories from storage into memory and prepare for use.
   * Never throws; falls back to an empty custom list on any failure.
   *
   * @returns {void}
   */
  initialize() {
    this.customCategories = this.load();
    this.isInitialized = true;
  }

  /**
   * Validate the structural shape of data parsed from storage.
   *
   * Shallow check only; individual entries are validated in load().
   *
   * @param {*} data - Parsed JSON object retrieved from storage
   * @returns {boolean} true if data has a version field and a categories array
   */
  static validateStoredData(data) {
    return (
      data !== null &&
      typeof data === 'object' &&
      typeof data.version !== 'undefined' &&
      Array.isArray(data.categories)
    );
  }

  /**
   * Validate a single stored custom-category entry.
   *
   * Expected shape: { name: non-empty string, color: non-empty string }. The
   * name must not collide (case-insensitively) with a built-in, since only
   * customs are stored.
   *
   * @param {*} entry - Candidate category entry
   * @returns {boolean} true if the entry is a well-formed custom category
   */
  static isValidStoredCategory(entry) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      typeof entry.name !== 'string' ||
      entry.name.trim().length === 0 ||
      typeof entry.color !== 'string' ||
      entry.color.trim().length === 0
    ) {
      return false;
    }

    // A stored "custom" that duplicates a built-in is corrupt; drop it.
    const lower = entry.name.trim().toLowerCase();
    return !CategoryManager.BUILT_INS.some(
      (builtIn) => builtIn.toLowerCase() === lower
    );
  }

  /**
   * Read and validate custom categories from Local Storage. Never throws;
   * returns [] when data is missing, unparseable, or structurally invalid, and
   * drops individual malformed/duplicate entries.
   *
   * @returns {Array<{name: string, color: string}>}
   */
  load() {
    try {
      const rawData = localStorage.getItem(CategoryManager.STORAGE_KEY);

      // No data persisted yet is a normal first-run state, not an error.
      if (rawData === null) {
        return [];
      }

      const parsed = JSON.parse(rawData);

      if (!CategoryManager.validateStoredData(parsed)) {
        console.error(
          'Stored categories have an invalid schema structure; returning no custom categories.'
        );
        return [];
      }

      // Keep only well-formed entries; drop case-insensitive duplicates so the
      // active list never has two categories that compare equal.
      const seen = new Set(
        CategoryManager.BUILT_INS.map((name) => name.toLowerCase())
      );
      const valid = [];
      for (const entry of parsed.categories) {
        if (!CategoryManager.isValidStoredCategory(entry)) {
          console.warn('Skipping corrupted category:', entry);
          continue;
        }
        const lower = entry.name.trim().toLowerCase();
        if (seen.has(lower)) {
          console.warn('Skipping duplicate category:', entry);
          continue;
        }
        seen.add(lower);
        valid.push({ name: entry.name.trim(), color: entry.color.trim() });
      }

      return valid;
    } catch (error) {
      // Covers JSON parse errors and any storage access failures.
      console.error('Failed to load categories from Local Storage:', error);
      return [];
    }
  }

  /**
   * Persist the current custom categories to Local Storage, wrapped in the
   * versioned payload. Never throws; returns false on failure (e.g. quota or
   * storage disabled) so category changes still apply in-session.
   *
   * @returns {boolean} true on success, false on failure
   */
  save() {
    try {
      const payload = {
        version: CategoryManager.SCHEMA_VERSION,
        categories: this.customCategories
      };
      localStorage.setItem(CategoryManager.STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch (error) {
      console.error('Failed to save categories to Local Storage:', error);
      return false;
    }
  }

  /**
   * Get the active category list: built-ins first, then custom names in the
   * order they were added.
   *
   * @returns {Array<string>} Active category names
   */
  getActiveCategories() {
    return [
      ...CategoryManager.BUILT_INS,
      ...this.customCategories.map((category) => category.name)
    ];
  }

  /**
   * Resolve the display color for a category name.
   *
   * @param {string} name - Category name
   * @returns {string} Hex color: the built-in color, the custom's stored
   *   color, or the grey fallback when the name is unknown.
   */
  getCategoryColor(name) {
    if (
      Object.prototype.hasOwnProperty.call(
        CategoryManager.BUILT_IN_COLORS,
        name
      )
    ) {
      return CategoryManager.BUILT_IN_COLORS[name];
    }

    const custom = this.customCategories.find(
      (category) => category.name === name
    );
    return custom ? custom.color : CategoryManager.FALLBACK_COLOR;
  }

  /**
   * Validate a proposed new category name.
   *
   * Rules: trim; reject empty; reject names longer than MAX_NAME_LENGTH;
   * reject the reserved sentinel; reject case-insensitive duplicates of any
   * active category (built-in or custom). Returns a user-facing error message.
   *
   * @param {string} name - Raw proposed name (may contain whitespace)
   * @returns {{valid: boolean, error: string}} error is '' when valid
   */
  validateName(name) {
    const trimmed = typeof name === 'string' ? name.trim() : '';

    if (trimmed.length === 0) {
      return { valid: false, error: 'Category name is required.' };
    }

    if (trimmed.length > CategoryManager.MAX_NAME_LENGTH) {
      return {
        valid: false,
        error: `Category name must be ${CategoryManager.MAX_NAME_LENGTH} characters or fewer.`
      };
    }

    // The sentinel is reserved for the dropdown's add-new option.
    if (trimmed === CategoryManager.ADD_NEW_SENTINEL) {
      return { valid: false, error: 'That category name is reserved.' };
    }

    const lower = trimmed.toLowerCase();
    const duplicate = this.getActiveCategories().some(
      (existing) => existing.toLowerCase() === lower
    );
    if (duplicate) {
      return { valid: false, error: 'That category already exists.' };
    }

    return { valid: true, error: '' };
  }

  /**
   * Add a new custom category after validating its name.
   *
   * On success assigns the next palette color (cycling when exhausted),
   * appends it, persists, and notifies listeners. The in-memory add is kept
   * even if persistence fails so the category is usable in-session.
   *
   * @param {string} name - Proposed category name (will be trimmed)
   * @returns {{ok: boolean, error: string, name: string}} name is the trimmed
   *   stored name on success, '' otherwise.
   */
  addCategory(name) {
    const validation = this.validateName(name);
    if (!validation.valid) {
      return { ok: false, error: validation.error, name: '' };
    }

    const trimmed = name.trim();
    // Assign the next color by custom-category count, cycling the palette.
    const color =
      CategoryManager.PALETTE[
        this.customCategories.length % CategoryManager.PALETTE.length
      ];

    this.customCategories.push({ name: trimmed, color });
    this.save();
    this.notify();

    return { ok: true, error: '', name: trimmed };
  }

  /**
   * Delete a custom category by name.
   *
   * Built-ins can never be deleted. In-use checks are the caller's
   * responsibility (see isDeletable); this method only enforces that the name
   * is a known custom category. On a persistence failure the removal is rolled
   * back so memory stays consistent with storage.
   *
   * @param {string} name - Category name to delete
   * @returns {boolean} true if removed and persisted, false otherwise
   */
  deleteCategory(name) {
    if (CategoryManager.BUILT_INS.includes(name)) {
      return false;
    }

    const index = this.customCategories.findIndex(
      (category) => category.name === name
    );
    if (index === -1) {
      return false;
    }

    const [removed] = this.customCategories.splice(index, 1);

    const saved = this.save();
    if (!saved) {
      // Roll back so memory matches the un-persisted state.
      this.customCategories.splice(index, 0, removed);
      return false;
    }

    this.notify();
    return true;
  }

  /**
   * Determine whether a category can be deleted: it must be a custom category
   * (never a built-in) AND not currently used by any transaction.
   *
   * @param {string} name - Category name to test
   * @param {Set<string>} usedCategorySet - Set of category names currently in
   *        use by transactions
   * @returns {boolean} true if the category may be deleted
   */
  isDeletable(name, usedCategorySet) {
    if (CategoryManager.BUILT_INS.includes(name)) {
      return false;
    }
    const isCustom = this.customCategories.some(
      (category) => category.name === name
    );
    if (!isCustom) {
      return false;
    }
    return !(usedCategorySet && usedCategorySet.has(name));
  }

  /**
   * Get a defensive copy of the custom categories (name + color).
   *
   * @returns {Array<{name: string, color: string}>}
   */
  getCustomCategories() {
    return this.customCategories.map((category) => ({ ...category }));
  }

  /**
   * Register a change listener invoked after every add/delete.
   *
   * @param {Function} callback - Called with no arguments on change
   * @returns {void}
   */
  onChange(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback);
    }
  }

  /**
   * Notify all registered listeners of a category change. A failing listener
   * is logged but does not prevent the others from running.
   *
   * @returns {void}
   */
  notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error('Category change listener failed:', error);
      }
    }
  }
}

/**
 * ThemeManager
 *
 * Manages the light/dark color theme. Implemented as a static class to mirror
 * StorageManager, since theme state is global and the methods are stateless.
 *
 * Behavior:
 *  - Reads a saved preference from Local Storage key 'expense-tracker-theme'.
 *  - On first load with no saved value, falls back to the OS preference via
 *    prefers-color-scheme.
 *  - Applies the theme by toggling data-theme="dark" on <html> and syncing the
 *    toggle button's aria-pressed and icon.
 *  - Persists the choice on toggle, guarded so storage failures never throw.
 *
 * Icon convention: 🌙 (moon) is shown in light mode (click to go dark); ☀️
 * (sun) is shown in dark mode (click to go light).
 */
class ThemeManager {
  // Local Storage key, matching the 'expense-tracker-*' convention.
  static STORAGE_KEY = 'expense-tracker-theme';

  // Icons per active theme (see convention note above). Written as Unicode
  // escapes so the source stays pure ASCII and renders correctly regardless of
  // how the file is served/decoded: \u{1F319} = 🌙 (crescent moon),
  // \u2600\uFE0F = ☀️ (sun with emoji variation selector).
  static ICON_LIGHT = '\u{1F319}';
  static ICON_DARK = '\u2600\uFE0F';

  /**
   * Read the saved theme from Local Storage without ever throwing.
   *
   * @returns {('dark'|'light'|null)} the stored theme, or null when nothing is
   *   saved, the value is unrecognized, or storage is unavailable.
   */
  static getStoredTheme() {
    try {
      const stored = localStorage.getItem(ThemeManager.STORAGE_KEY);
      return stored === 'dark' || stored === 'light' ? stored : null;
    } catch (error) {
      // Access can throw when storage is disabled (e.g. Safari private mode).
      console.error('Could not read saved theme:', error);
      return null;
    }
  }

  /**
   * Resolve the theme to apply: the saved preference when present, otherwise
   * the OS preference via prefers-color-scheme, defaulting to light.
   *
   * @returns {('dark'|'light')}
   */
  static getPreferredTheme() {
    const stored = ThemeManager.getStoredTheme();
    if (stored) {
      return stored;
    }

    // matchMedia may be absent in very old environments; guard defensively.
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }

    return 'light';
  }

  /**
   * Persist the chosen theme. Never throws; returns false on failure (e.g.
   * storage disabled or quota exceeded) so the UI can still toggle in-session.
   *
   * @param {('dark'|'light')} theme
   * @returns {boolean} true when saved, false otherwise.
   */
  static saveTheme(theme) {
    try {
      localStorage.setItem(ThemeManager.STORAGE_KEY, theme);
      return true;
    } catch (error) {
      console.error('Could not save theme preference:', error);
      return false;
    }
  }

  /**
   * Apply a theme to the document and sync the toggle button's state.
   *
   * Sets (or removes) data-theme="dark" on <html> so getComputedStyle on the
   * root resolves the active custom-property values. Updates the toggle's
   * aria-pressed and icon to reflect the current theme.
   *
   * @param {('dark'|'light')} theme
   * @returns {void}
   */
  static applyTheme(theme) {
    const isDark = theme === 'dark';

    if (isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }

    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      // aria-pressed reflects "dark mode is on".
      toggle.setAttribute('aria-pressed', isDark ? 'true' : 'false');

      const icon = toggle.querySelector('.theme-toggle-icon');
      if (icon) {
        icon.textContent = isDark ? ThemeManager.ICON_DARK : ThemeManager.ICON_LIGHT;
      }
    }
  }

  /**
   * Determine the currently applied theme from the document.
   *
   * @returns {('dark'|'light')}
   */
  static getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light';
  }

  /**
   * Flip to the opposite theme, apply it, persist it, and refresh the chart so
   * its label/tooltip colors track the new theme.
   *
   * @returns {void}
   */
  static toggle() {
    const next = ThemeManager.getCurrentTheme() === 'dark' ? 'light' : 'dark';
    ThemeManager.applyTheme(next);
    ThemeManager.saveTheme(next);
    ThemeManager.refreshChart();
  }

  /**
   * Ask the running chart (if any) to recompute its theme-dependent colors.
   * Resolved through the module-scoped uiManager so ThemeManager stays
   * decoupled from the component wiring.
   *
   * @returns {void}
   */
  static refreshChart() {
    if (uiManager && uiManager.chartComponent) {
      uiManager.chartComponent.refreshTheme();
    }
  }

  /**
   * Initialize theming: apply the preferred theme and bind the toggle click.
   * Called from initApp() after the UI (and chart) have been built so the
   * initial apply can refresh an already-created chart.
   *
   * @returns {void}
   */
  static init() {
    ThemeManager.applyTheme(ThemeManager.getPreferredTheme());
    ThemeManager.refreshChart();

    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => ThemeManager.toggle());
    }
  }
}

/**
 * TransactionManager
 *
 * Manages the in-memory transaction collection and the business logic that
 * surrounds it: loading persisted data, validating user input, and generating
 * unique identifiers. Persistence is delegated to an injected StorageManager
 * so this class stays focused on transaction logic.
 *
 * Transaction shape: { id, itemName, amount, category, timestamp }
 * where `amount` is stored as an integer number of cents.
 */
class TransactionManager {
  // Allowed category values. Amounts are validated against these exactly.
  static CATEGORIES = ['Food', 'Transport', 'Fun'];

  // Amount bounds expressed in dollars (inclusive). 0.01 min, 999,999.99 max.
  static MIN_AMOUNT_DOLLARS = 0.01;
  static MAX_AMOUNT_DOLLARS = 999999.99;

  // Maximum allowed length for a transaction's item name.
  static MAX_ITEM_NAME_LENGTH = 100;

  /**
   * @param {typeof StorageManager} storageManager - Storage dependency used
   *        for loading and persisting transactions.
   * @param {CategoryManager} [categoryManager] - Source of the dynamic active
   *        category list used for validation and totals. Optional so the
   *        manager still works if constructed without one (falls back to the
   *        static CATEGORIES).
   */
  constructor(storageManager, categoryManager) {
    // Keep a reference to the injected persistence layer.
    this.storageManager = storageManager;

    // Source of the dynamic active category list (built-ins + customs).
    this.categoryManager = categoryManager || null;

    // In-memory transaction list; populated by initialize().
    this.transactions = [];

    // Tracks whether initialize() has run so callers can guard against use
    // before data has been loaded from storage.
    this.isInitialized = false;
  }

  /**
   * Load transactions from storage into memory and prepare the manager for use.
   *
   * Loaded transactions are sorted newest-first so downstream consumers (list
   * rendering, etc.) receive data in the expected display order. Should be
   * called once during application startup.
   *
   * @returns {void}
   */
  initialize() {
    // Pull persisted transactions; StorageManager returns [] on any failure.
    const loaded = this.storageManager.loadTransactions();
    this.transactions = Array.isArray(loaded) ? loaded : [];

    // Sort newest-first by timestamp for reverse-chronological display.
    this.transactions.sort((a, b) => b.timestamp - a.timestamp);

    this.isInitialized = true;
  }

  /**
   * Validate raw transaction input without creating a transaction.
   *
   * Each field is checked independently so the caller can surface all errors
   * at once. Error messages are user-facing and describe how to fix the issue.
   *
   * @param {string} itemName - Raw item name (may contain surrounding whitespace)
   * @param {number} amount - Amount in dollars
   * @param {string} category - Category value
   * @param {Array<string>} [activeCategories] - The live list of valid
   *        categories to check against. Defaults to the static CATEGORIES so
   *        the method is safe when called without the dynamic list.
   * @returns {{valid: boolean, errors: {itemName?: string, amount?: string, category?: string}}}
   */
  static validateTransaction(
    itemName,
    amount,
    category,
    activeCategories = TransactionManager.CATEGORIES
  ) {
    const errors = {};

    // --- Item name: required, non-empty after trimming, max length ---
    const trimmedName =
      typeof itemName === 'string' ? itemName.trim() : '';
    if (trimmedName.length === 0) {
      errors.itemName = 'Item name is required.';
    } else if (trimmedName.length > TransactionManager.MAX_ITEM_NAME_LENGTH) {
      errors.itemName = `Item name must be ${TransactionManager.MAX_ITEM_NAME_LENGTH} characters or fewer.`;
    }

    // --- Amount: numeric, within range, at most 2 decimal places ---
    const numericAmount =
      typeof amount === 'number' ? amount : Number(amount);
    if (
      amount === '' ||
      amount === null ||
      amount === undefined ||
      Number.isNaN(numericAmount)
    ) {
      errors.amount = 'Amount is required and must be a number.';
    } else if (numericAmount < 0) {
      // Explicitly reject negatives with a dedicated message (Req 1.10).
      errors.amount = 'Amount cannot be negative.';
    } else if (numericAmount < TransactionManager.MIN_AMOUNT_DOLLARS) {
      errors.amount = 'Amount must be at least $0.01.';
    } else if (numericAmount > TransactionManager.MAX_AMOUNT_DOLLARS) {
      errors.amount = 'Amount must not exceed $999,999.99.';
    } else if (!TransactionManager.hasAtMostTwoDecimals(numericAmount)) {
      errors.amount = 'Amount can have at most 2 decimal places.';
    }

    // --- Category: must be one of the active (built-in or custom) values ---
    const validCategories = Array.isArray(activeCategories)
      ? activeCategories
      : TransactionManager.CATEGORIES;
    if (!validCategories.includes(category)) {
      errors.category = 'Please select a valid category.';
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors
    };
  }

  /**
   * Determine whether a numeric amount has at most two decimal places.
   *
   * Multiplying by 100 and comparing against the rounded value detects a
   * fractional cent (more than 2 decimals) while tolerating floating-point
   * representation error via a small epsilon.
   *
   * @param {number} amountDollars - Amount in dollars
   * @returns {boolean} true if the value has 2 or fewer decimal places
   */
  static hasAtMostTwoDecimals(amountDollars) {
    const cents = amountDollars * 100;
    return Math.abs(cents - Math.round(cents)) < 1e-9;
  }

  /**
   * Generate a unique transaction identifier.
   *
   * Combines the current timestamp with a random base-36 suffix, which is
   * sufficiently unique for a single-client application without an external
   * UUID dependency.
   *
   * @returns {string} Unique ID string
   */
  static generateId() {
    // Use String.prototype.slice() instead of the legacy/deprecated substr().
    // slice(2, 11) yields the same 9-character suffix (indices 2–10) as
    // substr(2, 9) and is the modern, universally-supported equivalent across
    // Chrome, Firefox, Edge, and Safari (Req 8.5).
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Add a new transaction after validating the supplied input.
   *
   * The amount arrives in dollars and is converted to an integer number of
   * cents for exact financial arithmetic. New transactions are inserted at the
   * front of the array so the collection stays newest-first.
   *
   * @param {string} itemName - Item description (will be trimmed)
   * @param {number} amountDollars - Amount in dollars
   * @param {string} category - Category value (Food, Transport, or Fun)
   * @returns {object|null} The created transaction, or null if validation fails
   */
  addTransaction(itemName, amountDollars, category) {
    // Reject invalid input up front; caller is responsible for showing errors.
    // Validate against the dynamic active list when a CategoryManager is wired.
    const validation = TransactionManager.validateTransaction(
      itemName,
      amountDollars,
      category,
      this.getActiveCategories()
    );
    if (!validation.valid) {
      return null;
    }

    // Convert dollars to integer cents. Math.round avoids floating-point drift
    // (e.g. 25.5 * 100 === 2550 reliably).
    const amountCents = Math.round(amountDollars * 100);

    const transaction = {
      id: TransactionManager.generateId(),
      itemName: itemName.trim(),
      amount: amountCents,
      category: category,
      timestamp: Date.now()
    };

    // Insert at the beginning so the list remains newest-first.
    this.transactions.unshift(transaction);

    // Persist the updated collection.
    this.storageManager.saveTransactions(this.transactions);

    return transaction;
  }

  /**
   * Delete a transaction by its unique ID.
   *
   * On a persistence failure the removed transaction is restored to its
   * original position so in-memory state stays consistent with storage.
   *
   * @param {string} id - ID of the transaction to delete
   * @returns {boolean} true if deleted and persisted, false if not found or
   *                    the save failed
   */
  deleteTransaction(id) {
    const index = this.transactions.findIndex((t) => t.id === id);

    // Nothing to delete if the ID is unknown.
    if (index === -1) {
      return false;
    }

    // Remove the transaction, retaining it so we can restore on save failure.
    const [removed] = this.transactions.splice(index, 1);

    const saved = this.storageManager.saveTransactions(this.transactions);
    if (!saved) {
      // Roll back the in-memory change to match the un-persisted state.
      this.transactions.splice(index, 0, removed);
      return false;
    }

    return true;
  }

  /**
   * Get all transactions as a defensive copy, sorted newest-first.
   *
   * Returning a copy prevents callers from mutating the manager's internal
   * array. The copy is sorted by timestamp descending so consumers always get
   * reverse-chronological order regardless of insertion history.
   *
   * @returns {Array} Sorted shallow copy of the transactions array
   */
  getTransactions() {
    return [...this.transactions].sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Find a single transaction by ID.
   *
   * @param {string} id - ID of the transaction to find
   * @returns {object|null} The matching transaction, or null if not found
   */
  getTransactionById(id) {
    const transaction = this.transactions.find((t) => t.id === id);
    return transaction || null;
  }

  /**
   * Calculate the total spending across all transactions, in cents.
   *
   * Transactions with invalid amounts (non-integer or negative) are excluded
   * defensively so a single corrupted record cannot poison the total. The
   * final value is rounded to guard against any accumulated imprecision.
   *
   * @returns {number} Total amount in cents
   */
  getTotalCents() {
    const total = this.transactions.reduce((sum, transaction) => {
      const amount = transaction.amount;

      // Skip amounts that are not valid non-negative integer cents.
      if (!Number.isInteger(amount) || amount < 0) {
        return sum;
      }

      return sum + amount;
    }, 0);

    return Math.round(total);
  }

  /**
   * Aggregate spending totals grouped by category.
   *
   * Always returns an entry for every known category (even when zero) so the
   * chart and other consumers have a stable, complete shape to work with.
   *
   * @returns {Array<{category: string, totalCents: number}>} Per-category totals
   */
  getCategoryTotals() {
    const categories = this.getActiveCategories();

    // Seed each active category at zero so absent categories still appear.
    const totalsByCategory = {};
    for (const category of categories) {
      totalsByCategory[category] = 0;
    }

    // Accumulate each transaction's amount into its category bucket.
    for (const transaction of this.transactions) {
      if (
        Object.prototype.hasOwnProperty.call(
          totalsByCategory,
          transaction.category
        ) &&
        Number.isInteger(transaction.amount) &&
        transaction.amount >= 0
      ) {
        totalsByCategory[transaction.category] += transaction.amount;
      }
    }

    return categories.map((category) => ({
      category,
      totalCents: totalsByCategory[category]
    }));
  }

  /**
   * Resolve the active category list from the injected CategoryManager, or the
   * static built-in list when none is wired. Centralizes the fallback so
   * totals and validation share one definition of "active".
   *
   * @returns {Array<string>} Active category names
   */
  getActiveCategories() {
    if (this.categoryManager) {
      return this.categoryManager.getActiveCategories();
    }
    return TransactionManager.CATEGORIES;
  }

  /**
   * Aggregate spending into per-calendar-month summaries, newest month first.
   *
   * Transactions are grouped by their LOCAL-time calendar month so the derived
   * key and the human label always agree with the user's own calendar. The
   * same defensive guard used by getTotalCents()/getCategoryTotals() excludes
   * amounts that are not non-negative integer cents, and transactions whose
   * category is not a known one are skipped (mirroring getCategoryTotals()).
   * Each month always reports every known category (seeded at zero) so the
   * view has a stable, complete shape.
   *
   * @returns {Array<{monthKey: string, label: string, totalCents: number,
   *   categoryTotals: Array<{category: string, totalCents: number}>}>}
   *   Monthly summaries sorted newest-first by month.
   */
  getMonthlySummaries() {
    // Resolve the active category list once so seeding and the category guard
    // both iterate the same dynamic set (built-ins + customs).
    const categories = this.getActiveCategories();

    // Keyed by "YYYY-MM"; each entry holds the running month total plus a
    // per-category cents map seeded with every active category at zero.
    const monthsByKey = {};

    for (const transaction of this.transactions) {
      const amount = transaction.amount;

      // Skip amounts that are not valid non-negative integer cents, and any
      // transaction whose category is not one we recognize.
      if (
        !Number.isInteger(amount) ||
        amount < 0 ||
        !categories.includes(transaction.category)
      ) {
        continue;
      }

      // Derive the local-time month using the Date object's local getters so
      // the key matches the label built from the same month below.
      const date = new Date(transaction.timestamp);
      const year = date.getFullYear();
      const month = date.getMonth(); // 0-based
      const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

      // Lazily create the month bucket with every category seeded to zero.
      if (!monthsByKey[monthKey]) {
        const categoryTotals = {};
        for (const category of categories) {
          categoryTotals[category] = 0;
        }

        monthsByKey[monthKey] = {
          monthKey,
          // Day 1 of the month yields a stable "October 2026"-style label.
          label: new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'long'
          }).format(new Date(year, month, 1)),
          totalCents: 0,
          categoryTotals
        };
      }

      const bucket = monthsByKey[monthKey];
      bucket.totalCents += amount;
      bucket.categoryTotals[transaction.category] += amount;
    }

    // Project each bucket into the public shape and sort months newest-first.
    // String comparison of the zero-padded "YYYY-MM" keys gives chronological
    // order, so a descending sort yields newest-first.
    return Object.values(monthsByKey)
      .sort((a, b) => (a.monthKey < b.monthKey ? 1 : a.monthKey > b.monthKey ? -1 : 0))
      .map((bucket) => ({
        monthKey: bucket.monthKey,
        label: bucket.label,
        totalCents: bucket.totalCents,
        categoryTotals: categories.map((category) => ({
          category,
          totalCents: bucket.categoryTotals[category]
        }))
      }));
  }

  /**
   * Get the number of transactions currently held in memory.
   *
   * @returns {number} Count of transactions
   */
  getTransactionCount() {
    return this.transactions.length;
  }
}

/**
 * UI Utility Functions
 *
 * Module-level helpers shared across UI components. These are standalone
 * functions (not class methods) so any component can call them directly.
 */

// Maximum displayable amount in cents ($999,999,999.99). Totals above this are
// shown with a trailing "+" to indicate an overflow of the display budget.
const MAX_DISPLAY_CENTS = 99999999999;

/**
 * Create a debounced version of a function (Req 7.4).
 *
 * The returned wrapper delays invoking `fn` until `delay` milliseconds have
 * passed since the last call, so a burst of rapid calls collapses into a single
 * invocation with the most recent arguments. Used to batch expensive chart
 * redraws when refreshes happen in quick succession.
 *
 * @param {Function} fn - The function to debounce.
 * @param {number} delay - Quiet period in milliseconds before `fn` runs.
 * @returns {Function} Debounced wrapper that preserves the latest arguments.
 */
function debounce(fn, delay) {
  let timeoutId = null;
  return function debounced(...args) {
    // Reset the timer on every call so only the final call in a burst fires.
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn.apply(this, args);
    }, delay);
  };
}

/**
 * Format an integer number of cents as a US-style currency string.
 *
 * Values are stored as integer cents for exact arithmetic, so the only
 * rounding needed here guards against a non-integer being passed in. Rounding
 * uses half-up (Math.round) to match the balance calculation (Req 5.7).
 *
 * @param {number} cents - Amount in cents (expected to be an integer)
 * @returns {string} Formatted currency string, e.g. "$1,234.56". Amounts above
 *                   $999,999,999.99 return "$999,999,999.99+" (Req 5.8).
 */
function formatCurrency(cents) {
  // Coerce to a number and default invalid input to zero so the display never
  // shows "NaN" to the user.
  let safeCents = Number(cents);
  if (!Number.isFinite(safeCents)) {
    safeCents = 0;
  }

  // Half-up round to whole cents in case a fractional cent slipped through.
  safeCents = Math.round(safeCents);

  // Overflow: cap the display and append "+" to signal the real value is higher.
  if (safeCents > MAX_DISPLAY_CENTS) {
    return '$999,999,999.99+';
  }

  // Convert cents to dollars for formatting.
  const dollars = safeCents / 100;

  // Intl.NumberFormat applies the comma thousands separator, period decimal
  // separator, and exactly 2 decimal places in one step.
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  return formatter.format(dollars);
}

/**
 * Display the global error banner with a message.
 *
 * The banner (id "global-error") carries the `is-hidden` utility class by
 * default, so showing it means removing that class. Visibility is driven by a
 * CSS class rather than an inline style to keep presentation in the stylesheet
 * (Req 9.6). An optional duration auto-dismisses the banner after the delay.
 *
 * @param {string} message - User-facing error message to display
 * @param {number} [duration] - Optional auto-dismiss delay in milliseconds
 * @returns {void}
 */
function showGlobalError(message, duration) {
  const banner = document.getElementById('global-error');
  const messageElement = document.getElementById('error-message');

  // Guard against missing DOM so a UI error never cascades into a crash.
  if (!banner || !messageElement) {
    console.error('Global error elements not found; message was:', message);
    return;
  }

  messageElement.textContent = message;

  // Reveal the banner by dropping the hidden utility class.
  banner.classList.remove('is-hidden');

  // Auto-dismiss after the caller-provided timeout, when supplied.
  if (typeof duration === 'number' && duration > 0) {
    setTimeout(dismissGlobalError, duration);
  }
}

/**
 * Hide the global error banner and clear its message text.
 *
 * @returns {void}
 */
function dismissGlobalError() {
  const banner = document.getElementById('global-error');
  const messageElement = document.getElementById('error-message');

  if (banner) {
    // Re-hide via the CSS utility class rather than an inline style (Req 9.6).
    banner.classList.add('is-hidden');
  }

  if (messageElement) {
    messageElement.textContent = '';
  }
}

/**
 * InputFormComponent
 *
 * Encapsulates the transaction input form: reading values, surfacing and
 * clearing validation errors, resetting state, and wiring the submit event.
 * The component owns only DOM concerns; business validation lives in
 * TransactionManager. It caches element references in the constructor so
 * repeated interactions avoid redundant DOM lookups.
 */
class InputFormComponent {
  // CSS class applied to inputs that currently fail validation (Req 10.8).
  static ERROR_CLASS = 'input-error';

  /**
   * @param {string} formElementId - The id of the <form> element to manage
   *        (e.g. "transaction-form").
   */
  constructor(formElementId) {
    // Reference to the form element itself; used for submit binding and reset.
    this.form = document.getElementById(formElementId);

    // Cache the three input/select fields the form exposes.
    this.itemNameInput = document.getElementById('item-name');
    this.amountInput = document.getElementById('amount');
    this.categorySelect = document.getElementById('category');

    // Cache the matching error-message spans keyed by field name so
    // showValidationErrors()/clearValidationErrors() can iterate uniformly.
    this.errorElements = {
      itemName: document.getElementById('item-name-error'),
      amount: document.getElementById('amount-error'),
      category: document.getElementById('category-error')
    };

    // Map field names to their input elements for the same uniform iteration.
    this.inputElements = {
      itemName: this.itemNameInput,
      amount: this.amountInput,
      category: this.categorySelect
    };

    // Cache the submit button so setDisabled() can toggle it quickly.
    this.submitButton = this.form
      ? this.form.querySelector('button[type="submit"]')
      : null;
  }

  /**
   * Read and normalize the current form field values.
   *
   * Item name is trimmed of surrounding whitespace and the amount is parsed as
   * a float (NaN when the field is blank or non-numeric, which downstream
   * validation will reject).
   *
   * @returns {{itemName: string, amount: number, category: string}}
   */
  getFormValues() {
    const itemName = this.itemNameInput ? this.itemNameInput.value.trim() : '';
    // parseFloat yields NaN for empty/invalid input; validation handles that.
    const amount = this.amountInput ? parseFloat(this.amountInput.value) : NaN;
    const category = this.categorySelect ? this.categorySelect.value : '';

    return { itemName, amount, category };
  }

  /**
   * Display per-field validation errors on the form.
   *
   * For each field present in the errors object, writes the message into its
   * error span, marks the input invalid for assistive technology, and applies
   * the visual error class. Fields absent from the object are left untouched.
   *
   * @param {{itemName?: string, amount?: string, category?: string}} errors
   *        Map of field names to user-facing error messages.
   * @returns {void}
   */
  showValidationErrors(errors) {
    if (!errors) {
      return;
    }

    for (const field of Object.keys(errors)) {
      const message = errors[field];
      const errorElement = this.errorElements[field];
      const inputElement = this.inputElements[field];

      // Surface the message text in the field's dedicated error span.
      if (errorElement) {
        errorElement.textContent = message;
      }

      // Flag the input as invalid and style it to match (Req 10.8).
      if (inputElement) {
        inputElement.setAttribute('aria-invalid', 'true');
        inputElement.classList.add(InputFormComponent.ERROR_CLASS);
      }
    }
  }

  /**
   * Clear all validation error state from the form.
   *
   * Empties every error span, removes the aria-invalid attribute, and strips
   * the visual error class so the form returns to a clean baseline.
   *
   * @returns {void}
   */
  clearValidationErrors() {
    for (const field of Object.keys(this.errorElements)) {
      const errorElement = this.errorElements[field];
      const inputElement = this.inputElements[field];

      if (errorElement) {
        errorElement.textContent = '';
      }

      if (inputElement) {
        // Remove the attribute entirely rather than setting it to "false",
        // which some assistive tech still treats as a validity signal.
        inputElement.removeAttribute('aria-invalid');
        inputElement.classList.remove(InputFormComponent.ERROR_CLASS);
      }
    }
  }

  /**
   * Reset the form to its initial empty state.
   *
   * Uses the native form.reset() to clear field values, then clears any
   * lingering validation error state.
   *
   * @returns {void}
   */
  clearForm() {
    if (this.form) {
      this.form.reset();
    }
    this.clearValidationErrors();
  }

  /**
   * Move keyboard focus to the first (item name) input.
   *
   * Called after a successful submit so the user can immediately type the next
   * entry without reaching for the mouse (Req 1.9).
   *
   * @returns {void}
   */
  focusFirstInput() {
    if (this.itemNameInput) {
      this.itemNameInput.focus();
    }
  }

  /**
   * Enable or disable the entire form.
   *
   * Toggles the disabled attribute on the submit button and every input so the
   * form can be locked during in-flight operations (Req 7.5).
   *
   * @param {boolean} disabled - true to disable, false to enable
   * @returns {void}
   */
  setDisabled(disabled) {
    if (this.submitButton) {
      this.submitButton.disabled = disabled;
    }

    for (const field of Object.keys(this.inputElements)) {
      const inputElement = this.inputElements[field];
      if (inputElement) {
        inputElement.disabled = disabled;
      }
    }
  }

  /**
   * Register a submit handler for the form.
   *
   * Binds a single submit listener that prevents the default page reload,
   * reads the current field values, and forwards them to the supplied handler
   * as positional arguments (itemName, amount, category).
   *
   * @param {(itemName: string, amount: number, category: string) => void} handler
   * @returns {void}
   */
  onSubmit(handler) {
    if (!this.form || typeof handler !== 'function') {
      return;
    }

    this.form.addEventListener('submit', (event) => {
      // Stop the browser from reloading the page on submit.
      event.preventDefault();

      const { itemName, amount, category } = this.getFormValues();
      handler(itemName, amount, category);
    });
  }
}

/**
 * TransactionListComponent
 *
 * Renders the list of transactions and manages its empty state. This is the
 * class skeleton only; rendering, add/remove, delete delegation, and empty
 * state toggling are added in later tasks (9.2–9.8).
 */
class TransactionListComponent {
  /**
   * @param {string} containerElementId - The id of the list container element
   *        (e.g. "transactions-container").
   * @param {(name: string) => string} [colorResolver] - Resolves a category
   *        name to its assigned hex color, used to set the badge background so
   *        arbitrary (custom) categories color correctly without per-name CSS.
   */
  constructor(containerElementId, colorResolver) {
    // Reference to the container that holds rendered transaction elements.
    this.container = document.getElementById(containerElementId);

    // Reference to the empty-state message shown when there are no transactions.
    this.emptyState = document.getElementById('empty-state');

    // Category -> color resolver for data-driven badge backgrounds.
    this.colorResolver =
      typeof colorResolver === 'function' ? colorResolver : null;
  }

  /**
   * Resolve a category's badge color via the injected resolver, falling back to
   * grey when no resolver is wired or the name is unknown.
   *
   * @param {string} name - Category name
   * @returns {string} Hex color
   */
  resolveColor(name) {
    if (this.colorResolver) {
      return this.colorResolver(name) || '#CCCCCC';
    }
    return '#CCCCCC';
  }

  /**
   * Build the DOM element for a single transaction.
   *
   * All user-provided values (item name, category, amount) are written via
   * textContent rather than innerHTML to prevent XSS from malicious input.
   * The data-id attribute on both the item and the delete button lets the
   * delegated delete handler recover the transaction id from a click.
   *
   * @param {{id: string, itemName: string, amount: number, category: string}} transaction
   * @returns {HTMLElement} The fully built .transaction-item element
   */
  createTransactionElement(transaction) {
    // Root card element, tagged with the transaction id for lookups.
    const item = document.createElement('div');
    item.className = 'transaction-item';
    item.dataset.id = transaction.id;

    // --- Info column: item name + category badge ---
    const info = document.createElement('div');
    info.className = 'transaction-info';

    const name = document.createElement('span');
    name.className = 'transaction-name';
    name.textContent = transaction.itemName;

    const category = document.createElement('span');
    // Shared badge class carries shape/typography; the background color is set
    // inline from the category's assigned color so arbitrary (custom) category
    // names color correctly without needing a per-name CSS class.
    category.className = 'transaction-category category-badge';
    category.textContent = transaction.category;
    category.style.backgroundColor = this.resolveColor(transaction.category);

    info.appendChild(name);
    info.appendChild(category);

    // --- Actions column: amount + delete button ---
    const actions = document.createElement('div');
    actions.className = 'transaction-actions';

    const amount = document.createElement('span');
    amount.className = 'transaction-amount';
    // Amount is stored in cents; formatCurrency handles the display formatting.
    amount.textContent = formatCurrency(transaction.amount);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn-delete';
    deleteButton.dataset.id = transaction.id;
    // Descriptive label names the item so screen-reader users know what the
    // button deletes. Set via setAttribute to keep user text safely escaped.
    deleteButton.setAttribute(
      'aria-label',
      `Delete ${transaction.itemName} transaction`
    );

    // The "×" glyph is decorative; hide it from assistive tech since the
    // aria-label already conveys the button's purpose.
    const deleteIcon = document.createElement('span');
    deleteIcon.setAttribute('aria-hidden', 'true');
    deleteIcon.textContent = '×';
    deleteButton.appendChild(deleteIcon);

    actions.appendChild(amount);
    actions.appendChild(deleteButton);

    item.appendChild(info);
    item.appendChild(actions);

    return item;
  }

  /**
   * Render the full list of transactions, replacing any existing items.
   *
   * The empty-state element lives inside the container, so items are removed
   * individually (rather than clearing innerHTML) to preserve the empty-state
   * node and its reference. A DocumentFragment batches the inserts into a
   * single reflow.
   *
   * @param {Array<object>} transactions - Transactions to display
   * @returns {void}
   */
  render(transactions) {
    if (!this.container) {
      return;
    }

    // Remove previously rendered items without touching the empty-state node.
    this.clearItems();

    // Nothing to show: reveal the empty state and stop.
    if (!Array.isArray(transactions) || transactions.length === 0) {
      this.showEmptyState();
      return;
    }

    // Build all elements off-DOM, then append once for a single reflow.
    const fragment = document.createDocumentFragment();
    for (const transaction of transactions) {
      fragment.appendChild(this.createTransactionElement(transaction));
    }

    this.container.appendChild(fragment);
    this.hideEmptyState();
  }

  /**
   * Remove all rendered transaction items from the container.
   *
   * Deliberately leaves the empty-state element in place so its reference
   * stays valid and show/hide continues to work after a re-render.
   *
   * @returns {void}
   */
  clearItems() {
    if (!this.container) {
      return;
    }

    const items = this.container.querySelectorAll('.transaction-item');
    items.forEach((item) => item.remove());
  }

  /**
   * Insert a single new transaction at the top of the list.
   *
   * Optimized path used after an add so the whole list need not re-render.
   * Newest transactions appear first, so the element is prepended.
   *
   * @param {object} transaction - The newly created transaction
   * @returns {void}
   */
  addTransaction(transaction) {
    if (!this.container) {
      return;
    }

    const element = this.createTransactionElement(transaction);
    // Prepend so the newest transaction sits at the top of the list.
    this.container.insertBefore(element, this.container.firstChild);
    this.hideEmptyState();
  }

  /**
   * Remove a single transaction element from the list by its id.
   *
   * Optimized path used after a delete. If no transaction items remain the
   * empty state is shown again.
   *
   * @param {string} transactionId - id of the transaction to remove
   * @returns {void}
   */
  removeTransaction(transactionId) {
    if (!this.container) {
      return;
    }

    // Match on the data-id attribute set in createTransactionElement().
    const element = this.container.querySelector(
      `.transaction-item[data-id="${transactionId}"]`
    );
    if (element) {
      element.remove();
    }

    // Fall back to the empty state once the last item is gone.
    if (this.container.querySelectorAll('.transaction-item').length === 0) {
      this.showEmptyState();
    }
  }

  /**
   * Register a single delegated click handler for delete buttons.
   *
   * Event delegation on the container means one listener covers every current
   * and future delete button, avoiding per-item bindings. The click target may
   * be the button itself or its inner "×" span, so closest() walks up to find
   * the button and read its data-id.
   *
   * @param {(transactionId: string) => void} handler - Called with the id to delete
   * @returns {void}
   */
  onDelete(handler) {
    if (!this.container || typeof handler !== 'function') {
      return;
    }

    this.container.addEventListener('click', (event) => {
      // closest() handles clicks on the button or its child icon span.
      const button = event.target.closest('.btn-delete');
      if (!button || !this.container.contains(button)) {
        return;
      }

      const transactionId = button.dataset.id;
      if (transactionId) {
        handler(transactionId);
      }
    });
  }

  /**
   * Show the empty-state message.
   *
   * Toggles the `is-hidden` CSS utility class rather than setting an inline
   * style, keeping presentation in the stylesheet (Req 9.6).
   *
   * @returns {void}
   */
  showEmptyState() {
    if (this.emptyState) {
      this.emptyState.classList.remove('is-hidden');
    }
  }

  /**
   * Hide the empty-state message.
   *
   * @returns {void}
   */
  hideEmptyState() {
    if (this.emptyState) {
      this.emptyState.classList.add('is-hidden');
    }
  }
}

/**
 * MonthlySummaryComponent
 *
 * Renders spending grouped by calendar month, newest month first, and manages
 * its empty state. Follows TransactionListComponent exactly: the constructor
 * caches DOM references by id, DOM is built with createElement + a
 * DocumentFragment (never innerHTML concatenation of transaction data), and the
 * empty state is toggled via the shared `is-hidden` utility class. All business
 * logic (grouping, totals, ordering) lives in TransactionManager; this class is
 * presentation only.
 */
class MonthlySummaryComponent {
  /**
   * @param {string} containerElementId - The id of the container that holds the
   *        rendered month cards (e.g. "monthly-summary-container").
   * @param {(name: string) => string} [colorResolver] - Resolves a category
   *        name to its assigned hex color, used to set each chip's background
   *        so custom categories color correctly without per-name CSS.
   */
  constructor(containerElementId, colorResolver) {
    // Container that holds the rendered month cards.
    this.container = document.getElementById(containerElementId);

    // Empty-state message shown when there are no transactions.
    this.emptyState = document.getElementById('monthly-summary-empty-state');

    // Category -> color resolver for data-driven chip backgrounds.
    this.colorResolver =
      typeof colorResolver === 'function' ? colorResolver : null;
  }

  /**
   * Resolve a category's chip color via the injected resolver, falling back to
   * grey when no resolver is wired or the name is unknown.
   *
   * @param {string} name - Category name
   * @returns {string} Hex color
   */
  resolveColor(name) {
    if (this.colorResolver) {
      return this.colorResolver(name) || '#CCCCCC';
    }
    return '#CCCCCC';
  }

  /**
   * Build the DOM element for a single month's summary.
   *
   * All values are written via textContent (never innerHTML) so nothing from a
   * transaction can be interpreted as markup. The month total and each category
   * breakdown amount are formatted through the shared formatCurrency() helper so
   * display matches the rest of the app. Each category chip uses the shared
   * `category-badge` class with its background color set inline from the
   * category's assigned color.
   *
   * @param {{monthKey: string, label: string, totalCents: number,
   *   categoryTotals: Array<{category: string, totalCents: number}>}} summary
   * @returns {HTMLElement} The fully built .monthly-summary-month element
   */
  createMonthElement(summary) {
    // Root card element, tagged with the month key for lookups/debugging.
    const card = document.createElement('div');
    card.className = 'monthly-summary-month';
    card.dataset.monthKey = summary.monthKey;

    // --- Header row: month label + month total ---
    const header = document.createElement('div');
    header.className = 'monthly-summary-header';

    const label = document.createElement('span');
    label.className = 'monthly-summary-label';
    label.textContent = summary.label;

    const total = document.createElement('span');
    total.className = 'monthly-summary-total';
    // Amounts are cents; formatCurrency handles the display formatting.
    total.textContent = formatCurrency(summary.totalCents);

    header.appendChild(label);
    header.appendChild(total);

    // --- Breakdown row: one color-coded chip per category ---
    const breakdown = document.createElement('div');
    breakdown.className = 'monthly-summary-breakdown';

    for (const entry of summary.categoryTotals) {
      const chip = document.createElement('span');
      // Shared badge class carries shape/typography; the background color is
      // set inline from the category's assigned color so custom categories
      // color correctly without a per-name CSS class.
      chip.className = 'monthly-category category-badge';
      chip.textContent = `${entry.category}: ${formatCurrency(entry.totalCents)}`;
      chip.style.backgroundColor = this.resolveColor(entry.category);
      breakdown.appendChild(chip);
    }

    card.appendChild(header);
    card.appendChild(breakdown);

    return card;
  }

  /**
   * Render the full set of monthly summaries, replacing any existing cards.
   *
   * The empty-state element lives inside the container, so month cards are
   * removed individually (rather than clearing innerHTML) to preserve the
   * empty-state node and its reference. A DocumentFragment batches the inserts
   * into a single reflow, mirroring TransactionListComponent.render().
   *
   * @param {Array<object>} summaries - Monthly summaries to display
   * @returns {void}
   */
  render(summaries) {
    if (!this.container) {
      return;
    }

    // Remove previously rendered month cards without touching the empty state.
    this.clearMonths();

    // Nothing to show: reveal the empty state and stop.
    if (!Array.isArray(summaries) || summaries.length === 0) {
      this.showEmptyState();
      return;
    }

    // Build all month cards off-DOM, then append once for a single reflow.
    const fragment = document.createDocumentFragment();
    for (const summary of summaries) {
      fragment.appendChild(this.createMonthElement(summary));
    }

    this.container.appendChild(fragment);
    this.hideEmptyState();
  }

  /**
   * Remove all rendered month cards from the container.
   *
   * Deliberately leaves the empty-state element in place so its reference stays
   * valid and show/hide continues to work after a re-render.
   *
   * @returns {void}
   */
  clearMonths() {
    if (!this.container) {
      return;
    }

    const months = this.container.querySelectorAll('.monthly-summary-month');
    months.forEach((month) => month.remove());
  }

  /**
   * Show the empty-state message.
   *
   * Toggles the `is-hidden` CSS utility class rather than setting an inline
   * style, keeping presentation in the stylesheet.
   *
   * @returns {void}
   */
  showEmptyState() {
    if (this.emptyState) {
      this.emptyState.classList.remove('is-hidden');
    }
  }

  /**
   * Hide the empty-state message.
   *
   * @returns {void}
   */
  hideEmptyState() {
    if (this.emptyState) {
      this.emptyState.classList.add('is-hidden');
    }
  }
}

/**
 * BalanceDisplayComponent
 *
 * Renders the running total of spending in the header balance area. This is
 * the class skeleton only; update(), showLoading(), and clear() are added in
 * later tasks (10.2–10.4).
 */
class BalanceDisplayComponent {
  /**
   * @param {string} displayElementId - The id of the balance display element
   *        (e.g. "balance-amount").
   */
  // Placeholder text shown while a balance update is in flight (Req 7.7).
  static LOADING_PLACEHOLDER = '…';

  // CSS class toggled on the display element during the loading state so the
  // placeholder can be styled distinctly from a real balance.
  static LOADING_CLASS = 'balance-loading';

  constructor(displayElementId) {
    // Reference to the element whose text content shows the formatted total.
    this.displayElement = document.getElementById(displayElementId);
  }

  /**
   * Update the displayed balance from a total in cents.
   *
   * The incoming total is already an integer number of cents; formatCurrency()
   * handles the dollar conversion, thousands separators, and overflow display.
   * Clears any lingering loading state so a real value replaces the placeholder.
   *
   * @param {number} totalCents - Total spending amount in cents
   * @returns {void}
   */
  update(totalCents) {
    if (!this.displayElement) {
      return;
    }

    // Leaving the loading state in case update() follows a showLoading() call.
    this.displayElement.classList.remove(BalanceDisplayComponent.LOADING_CLASS);
    this.displayElement.textContent = formatCurrency(totalCents);
  }

  /**
   * Show a loading placeholder while a balance refresh is pending.
   *
   * Keeps the UI responsive during async work by swapping in a lightweight
   * placeholder and tagging the element so styling can react (Req 7.7).
   *
   * @returns {void}
   */
  showLoading() {
    if (!this.displayElement) {
      return;
    }

    this.displayElement.classList.add(BalanceDisplayComponent.LOADING_CLASS);
    this.displayElement.textContent = BalanceDisplayComponent.LOADING_PLACEHOLDER;
  }

  /**
   * Reset the display to a zero balance.
   *
   * Used when all transactions have been removed so the header reflects an
   * empty state (Req 5.6). Routed through formatCurrency(0) so the zero value
   * matches the formatting of every other displayed amount.
   *
   * @returns {void}
   */
  clear() {
    if (!this.displayElement) {
      return;
    }

    this.displayElement.classList.remove(BalanceDisplayComponent.LOADING_CLASS);
    this.displayElement.textContent = formatCurrency(0);
  }
}

/**
 * ChartComponent
 *
 * Renders and updates the spending-by-category pie chart using Chart.js, and
 * toggles an empty-state message when there is no data to show. This is the
 * class skeleton only; createChartConfig(), initialize(), update(), destroy(),
 * showEmptyState(), hideEmptyState(), and isInitialized() are added in later
 * tasks (11.2–11.8).
 */
class ChartComponent {
  // Fallback slice color for an unresolved category (matches CategoryManager).
  static FALLBACK_COLOR = '#CCCCCC';

  /**
   * @param {string} canvasElementId - The id of the <canvas> element the chart
   *        renders into (e.g. "expense-chart").
   * @param {(name: string) => string} [colorResolver] - Resolves a category
   *        name to its assigned hex color so pie slices match the badges. When
   *        omitted, every slice falls back to grey.
   */
  constructor(canvasElementId, colorResolver) {
    // Reference to the canvas the Chart.js instance draws on.
    this.canvasElement = document.getElementById(canvasElementId);

    // Holds the active Chart.js instance once created; null until initialized.
    this.chartInstance = null;

    // Reference to the empty-state message shown when all categories are zero.
    this.emptyState = document.getElementById('chart-empty-state');

    // Resolver that maps a category name to its assigned color. Slices use this
    // so they stay in sync with the badge colors for arbitrary categories.
    this.colorResolver =
      typeof colorResolver === 'function' ? colorResolver : null;
  }

  /**
   * Resolve a category's slice color via the injected resolver, falling back to
   * grey when no resolver is wired or the name is unknown.
   *
   * @param {string} name - Category name
   * @returns {string} Hex color
   */
  resolveColor(name) {
    if (this.colorResolver) {
      return this.colorResolver(name) || ChartComponent.FALLBACK_COLOR;
    }
    return ChartComponent.FALLBACK_COLOR;
  }

  /**
   * Returns true when every category total is zero (or the list is empty),
   * which signals there is nothing to chart and the empty state should show.
   *
   * @param {Array<{category: string, totalCents: number}>} categoryTotals
   * @returns {boolean}
   */
  isAllZero(categoryTotals) {
    if (!Array.isArray(categoryTotals) || categoryTotals.length === 0) {
      return true;
    }
    return categoryTotals.every((entry) => (entry.totalCents || 0) === 0);
  }

  /**
   * Read theme-dependent chart colors from the active CSS custom properties.
   *
   * Using getComputedStyle on <html> keeps the CSS tokens the single source of
   * truth, so the chart tracks whatever the [data-theme] overrides resolve to.
   * The segment border uses the (alt) background color so slices separate from
   * one another and from the chart section in both themes.
   *
   * @returns {{text: string, border: string}} resolved color strings.
   */
  getThemeColors() {
    const styles = getComputedStyle(document.documentElement);
    const text = styles.getPropertyValue('--color-text').trim() || '#1a1a1a';
    const border =
      styles.getPropertyValue('--color-background-alt').trim() || '#ffffff';
    return { text, border };
  }

  /**
   * Builds the Chart.js configuration object for the spending pie chart.
   * Private helper used by initialize() (Req 6.3, 6.7, 6.8).
   *
   * @param {Array<{category: string, totalCents: number}>} categoryTotals
   * @returns {object} A Chart.js config suitable for `new Chart(ctx, config)`.
   */
  createChartConfig(categoryTotals) {
    // Pull the parallel label/data arrays Chart.js expects, and map each
    // category to its fixed color (falling back to grey for unknowns).
    const labels = categoryTotals.map((entry) => entry.category);
    const data = categoryTotals.map((entry) => entry.totalCents);
    const backgroundColor = categoryTotals.map((entry) =>
      this.resolveColor(entry.category)
    );

    // Read the active theme's colors at build time so a chart created while in
    // dark mode is correct immediately (Req: theme-aware at build time).
    const themeColors = this.getThemeColors();

    return {
      type: 'pie',
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor,
            // Borders use the theme surface color so adjacent slices stay
            // visually separated in both light and dark themes.
            borderColor: themeColors.border,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              // Legend text follows the theme so it stays readable on dark.
              color: themeColors.text,
            },
          },
          tooltip: {
            titleColor: themeColors.text,
            bodyColor: themeColors.text,
            callbacks: {
              // Show "<Category>: $12.34 (56.7%)" so the dollar amount and the
              // share of total spending are both visible on hover. We compute
              // the percentage here (rather than relying on the datalabels
              // plugin, which the CDN build does not include).
              label: (context) => {
                const cents = context.parsed || 0;
                const total = context.dataset.data.reduce(
                  (sum, value) => sum + (value || 0),
                  0
                );
                const percent = total > 0 ? (cents / total) * 100 : 0;
                return `${context.label}: ${formatCurrency(cents)} (${percent.toFixed(1)}%)`;
              },
            },
          },
        },
      },
    };
  }

  /**
   * Creates the Chart.js instance from the given category totals, or shows the
   * empty state when there is no spending to display (Req 6.1, 6.6).
   *
   * @param {Array<{category: string, totalCents: number}>} categoryTotals
   */
  initialize(categoryTotals) {
    // Nothing to chart yet: surface the empty-state message and bail out.
    if (this.isAllZero(categoryTotals)) {
      this.showEmptyState();
      return;
    }

    this.hideEmptyState();

    const ctx = this.canvasElement.getContext('2d');
    const config = this.createChartConfig(categoryTotals);
    this.chartInstance = new Chart(ctx, config);
  }

  /**
   * Refreshes the chart in place when data changes, creating or tearing down
   * the instance as needed to stay in sync with the data (Req 6.4, 6.5).
   *
   * @param {Array<{category: string, totalCents: number}>} categoryTotals
   */
  update(categoryTotals) {
    // All spending removed: drop the chart and show the empty state.
    if (this.isAllZero(categoryTotals)) {
      this.destroy();
      this.showEmptyState();
      return;
    }

    this.hideEmptyState();

    // No chart yet (e.g. first data after an empty start): build one.
    if (!this.chartInstance) {
      this.initialize(categoryTotals);
      return;
    }

    // Otherwise mutate the existing chart's data arrays in place and redraw
    // without animation ('none') for a snappy update.
    this.chartInstance.data.labels = categoryTotals.map((entry) => entry.category);
    this.chartInstance.data.datasets[0].data = categoryTotals.map(
      (entry) => entry.totalCents
    );
    this.chartInstance.data.datasets[0].backgroundColor = categoryTotals.map(
      (entry) => this.resolveColor(entry.category)
    );
    this.chartInstance.update('none');
  }

  /**
   * Re-apply theme-dependent colors (legend/tooltip text and segment borders)
   * to the live chart and redraw. Safe to call when no chart exists yet; the
   * next createChartConfig() will pick up the active theme on its own.
   *
   * @returns {void}
   */
  refreshTheme() {
    if (!this.chartInstance) {
      return;
    }

    const themeColors = this.getThemeColors();

    // Legend label color.
    this.chartInstance.options.plugins.legend.labels =
      this.chartInstance.options.plugins.legend.labels || {};
    this.chartInstance.options.plugins.legend.labels.color = themeColors.text;

    // Tooltip title/body text color.
    this.chartInstance.options.plugins.tooltip.titleColor = themeColors.text;
    this.chartInstance.options.plugins.tooltip.bodyColor = themeColors.text;

    // Segment border color (slice separators).
    this.chartInstance.data.datasets[0].borderColor = themeColors.border;

    this.chartInstance.update('none');
  }

  /**
   * Destroys the active Chart.js instance and releases the reference so the
   * canvas can be reused (Req 6.4, 6.5).
   */
  destroy() {
    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }
  }

  /**
   * Hides the canvas and reveals the "no data" message (Req 6.6).
   *
   * Visibility is driven by CSS classes rather than inline styles (Req 9.6):
   * the canvas uses the shared `is-hidden` utility, while the empty-state div
   * uses its existing `visible` class (CSS: #chart-empty-state.visible shows it
   * as a flex overlay, hidden otherwise).
   */
  showEmptyState() {
    if (this.canvasElement) {
      this.canvasElement.classList.add('is-hidden');
    }
    if (this.emptyState) {
      this.emptyState.classList.add('visible');
    }
  }

  /**
   * Reveals the canvas and hides the "no data" message (Req 6.1).
   */
  hideEmptyState() {
    if (this.canvasElement) {
      this.canvasElement.classList.remove('is-hidden');
    }
    if (this.emptyState) {
      this.emptyState.classList.remove('visible');
    }
  }

  /**
   * @returns {boolean} True once a chart instance exists, false otherwise (Req 6.1).
   */
  isInitialized() {
    return this.chartInstance !== null;
  }
}

/**
 * Coordinates the application's UI: owns the child components, wires up their
 * event handlers, and keeps every view in sync with the TransactionManager
 * after any data change (Req 3.1, 5.2, 6.1).
 */
class UIManager {
  /**
   * @param {TransactionManager} transactionManager - Data layer used for all
   *   transaction reads/writes and aggregate calculations.
   * @param {CategoryManager} categoryManager - Owns the active category list,
   *   colors, and add/delete logic. Drives the dropdown and manage UI.
   */
  constructor(transactionManager, categoryManager) {
    this.transactionManager = transactionManager;
    this.categoryManager = categoryManager;

    // Child components are created in initialize() (once the DOM is ready),
    // so they start out null here.
    this.inputForm = null;
    this.transactionList = null;
    this.monthlySummary = null;
    this.balanceDisplay = null;
    this.chartComponent = null;

    // Debounced chart update (Req 7.4). Rapid successive refreshes (e.g. a
    // burst of adds/deletes) collapse into a single chart redraw after 100ms of
    // quiet. The chart is the most expensive view to repaint, so only it is
    // debounced; the balance and list stay immediate so they feel instant.
    // chartComponent is still null here, so resolve it at call time.
    this.debouncedChartUpdate = debounce((categoryTotals) => {
      this.chartComponent.update(categoryTotals);
    }, 100);
  }

  /**
   * Creates the child components, binds their event handlers, wires the global
   * error banner's close button, and performs the first render (Req 3.1).
   *
   * @returns {void}
   */
  initialize() {
    // Shared category color resolver passed into the color-aware components so
    // badges and chart slices stay in sync with CategoryManager.
    const resolveColor = (name) => this.categoryManager.getCategoryColor(name);

    // Instantiate each child component against its DOM element ID.
    this.inputForm = new InputFormComponent('transaction-form');
    this.transactionList = new TransactionListComponent(
      'transactions-container',
      resolveColor
    );
    this.monthlySummary = new MonthlySummaryComponent(
      'monthly-summary-container',
      resolveColor
    );
    this.balanceDisplay = new BalanceDisplayComponent('balance-amount');
    this.chartComponent = new ChartComponent('expense-chart', resolveColor);

    // Route component events into our handlers. bind(this) preserves the
    // UIManager context when the handlers run from the components' listeners.
    this.inputForm.onSubmit(this.handleFormSubmit.bind(this));
    this.transactionList.onDelete(this.handleDeleteClick.bind(this));

    // Wire the global error banner's close button to dismiss the error.
    const errorCloseButton = document.querySelector('#global-error button');
    if (errorCloseButton) {
      errorCloseButton.addEventListener('click', () => this.dismissError());
    }

    // Cache the category UI elements and wire the inline add + manage flows.
    this.cacheCategoryElements();
    this.bindCategoryUI();

    // Re-render the dropdown and manage list on every category change from one
    // source of truth. refreshAll() is called by the add/delete handlers so
    // totals/chart/badges also update.
    this.categoryManager.onChange(() => {
      this.renderCategoryOptions();
      this.renderManageList();
    });

    // Initial dropdown + manage-list render from the active list.
    this.renderCategoryOptions();
    this.renderManageList();

    // Render the current state so the UI reflects any persisted data.
    this.refreshAll();
  }

  /**
   * Cache references to the category dropdown, inline add-category group, and
   * manage-categories panel so the handlers avoid repeated DOM lookups.
   *
   * @returns {void}
   */
  cacheCategoryElements() {
    this.categorySelect = document.getElementById('category');
    this.newCategoryGroup = document.getElementById('new-category-group');
    this.newCategoryInput = document.getElementById('new-category-name');
    this.newCategoryConfirm = document.getElementById('new-category-confirm');
    this.newCategoryCancel = document.getElementById('new-category-cancel');
    this.newCategoryError = document.getElementById('new-category-error');

    this.manageToggle = document.getElementById('category-manage-toggle');
    this.managePanel = document.getElementById('category-manage-panel');
    this.manageList = document.getElementById('category-manage-list');
    this.manageMessage = document.getElementById('category-manage-message');

    // Remembers the selection to restore to when the user cancels the add flow.
    this.previousCategoryValue = '';
  }

  /**
   * Bind the inline add-category flow and the manage-categories disclosure.
   *
   * @returns {void}
   */
  bindCategoryUI() {
    if (this.categorySelect) {
      // Selecting the sentinel reveals the inline input; any other selection
      // records the value so a later add-cancel can restore it.
      this.categorySelect.addEventListener('change', () => {
        if (this.categorySelect.value === CategoryManager.ADD_NEW_SENTINEL) {
          this.showAddCategoryInput();
        } else {
          this.previousCategoryValue = this.categorySelect.value;
        }
      });
    }

    if (this.newCategoryConfirm) {
      this.newCategoryConfirm.addEventListener('click', () =>
        this.confirmAddCategory()
      );
    }

    if (this.newCategoryCancel) {
      this.newCategoryCancel.addEventListener('click', () =>
        this.cancelAddCategory()
      );
    }

    if (this.newCategoryInput) {
      // Enter confirms, Escape cancels — keep the flow fully keyboard-operable.
      this.newCategoryInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.confirmAddCategory();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          this.cancelAddCategory();
        }
      });
    }

    if (this.manageToggle && this.managePanel) {
      this.manageToggle.addEventListener('click', () => {
        const isHidden = this.managePanel.classList.toggle('is-hidden');
        this.manageToggle.setAttribute('aria-expanded', isHidden ? 'false' : 'true');
      });
    }

    if (this.manageList) {
      // Delegated delete handler covers current and future delete buttons.
      this.manageList.addEventListener('click', (event) => {
        const button = event.target.closest('.btn-delete');
        if (!button || !this.manageList.contains(button)) {
          return;
        }
        const name = button.dataset.category;
        if (name) {
          this.handleDeleteCategory(name);
        }
      });
    }
  }

  /**
   * Render the category <select> options from the active list: the blank
   * placeholder first, every active category, then the "+ Add new category…"
   * sentinel last. Preserves the current selection when it still exists.
   *
   * @returns {void}
   */
  renderCategoryOptions() {
    if (!this.categorySelect) {
      return;
    }

    const previous = this.categorySelect.value;
    const active = this.categoryManager.getActiveCategories();

    // Rebuild options via DOM APIs (no innerHTML) so names stay safely escaped.
    this.categorySelect.textContent = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select category';
    this.categorySelect.appendChild(placeholder);

    for (const name of active) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      this.categorySelect.appendChild(option);
    }

    const addNew = document.createElement('option');
    addNew.value = CategoryManager.ADD_NEW_SENTINEL;
    addNew.textContent = '+ Add new category\u2026';
    this.categorySelect.appendChild(addNew);

    // Restore the prior selection if it is still a valid, non-sentinel value.
    if (
      previous &&
      previous !== CategoryManager.ADD_NEW_SENTINEL &&
      active.includes(previous)
    ) {
      this.categorySelect.value = previous;
    }
  }

  /**
   * Reveal the inline add-category input, clear it, and move focus to it.
   *
   * @returns {void}
   */
  showAddCategoryInput() {
    if (!this.newCategoryGroup || !this.newCategoryInput) {
      return;
    }
    if (this.newCategoryError) {
      this.newCategoryError.textContent = '';
    }
    this.newCategoryInput.value = '';
    this.newCategoryGroup.classList.remove('is-hidden');
    this.newCategoryInput.focus();
  }

  /**
   * Validate and add the typed category. On success it is persisted, selected,
   * and the inline input hidden; on failure an inline error is shown and the
   * input stays open for correction.
   *
   * @returns {void}
   */
  confirmAddCategory() {
    if (!this.newCategoryInput) {
      return;
    }

    const name = this.newCategoryInput.value;
    const result = this.categoryManager.addCategory(name);

    if (!result.ok) {
      if (this.newCategoryError) {
        this.newCategoryError.textContent = result.error;
      }
      this.newCategoryInput.setAttribute('aria-invalid', 'true');
      this.newCategoryInput.focus();
      return;
    }

    // onChange re-rendered the options; select the new category and close.
    this.hideAddCategoryInput();
    if (this.categorySelect) {
      this.categorySelect.value = result.name;
      this.previousCategoryValue = result.name;
    }

    // Reflect the new (zero-total) category in totals/chart immediately.
    this.refreshAll();
  }

  /**
   * Cancel the add flow: hide the input and restore the previous selection
   * (which is never the sentinel).
   *
   * @returns {void}
   */
  cancelAddCategory() {
    this.hideAddCategoryInput();
    if (this.categorySelect) {
      this.categorySelect.value =
        this.previousCategoryValue &&
        this.previousCategoryValue !== CategoryManager.ADD_NEW_SENTINEL
          ? this.previousCategoryValue
          : '';
    }
  }

  /**
   * Hide the inline add-category input and clear its error/invalid state.
   *
   * @returns {void}
   */
  hideAddCategoryInput() {
    if (this.newCategoryGroup) {
      this.newCategoryGroup.classList.add('is-hidden');
    }
    if (this.newCategoryError) {
      this.newCategoryError.textContent = '';
    }
    if (this.newCategoryInput) {
      this.newCategoryInput.removeAttribute('aria-invalid');
    }
  }

  /**
   * Render the manage-categories list: one row per CUSTOM category with a
   * delete button. Built-ins are never listed. Shows a hint when there are no
   * custom categories yet.
   *
   * @returns {void}
   */
  renderManageList() {
    if (!this.manageList) {
      return;
    }

    this.manageList.textContent = '';
    if (this.manageMessage) {
      this.manageMessage.textContent = '';
    }

    const customs = this.categoryManager.getCustomCategories();

    if (customs.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No custom categories yet.';
      this.manageList.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const category of customs) {
      const row = document.createElement('div');
      row.className = 'category-manage-row';

      const swatch = document.createElement('span');
      swatch.className = 'category-badge category-manage-swatch';
      swatch.textContent = category.name;
      swatch.style.backgroundColor = category.color;

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'btn-delete';
      deleteButton.dataset.category = category.name;
      deleteButton.setAttribute('aria-label', `Delete ${category.name} category`);

      const deleteIcon = document.createElement('span');
      deleteIcon.setAttribute('aria-hidden', 'true');
      deleteIcon.textContent = '\u00d7';
      deleteButton.appendChild(deleteIcon);

      row.appendChild(swatch);
      row.appendChild(deleteButton);
      fragment.appendChild(row);
    }

    this.manageList.appendChild(fragment);
  }

  /**
   * Handle a delete request for a custom category. Blocks deletion when any
   * transaction still uses the category; otherwise deletes, persists, and
   * refreshes the UI.
   *
   * @param {string} name - Custom category name to delete
   * @returns {void}
   */
  handleDeleteCategory(name) {
    // Build the set of categories currently in use from the transactions.
    const usedCategorySet = new Set(
      this.transactionManager.getTransactions().map((t) => t.category)
    );

    if (!this.categoryManager.isDeletable(name, usedCategorySet)) {
      if (this.manageMessage) {
        this.manageMessage.textContent = usedCategorySet.has(name)
          ? `Cannot delete "${name}" while transactions use it.`
          : `"${name}" cannot be deleted.`;
      }
      return;
    }

    const deleted = this.categoryManager.deleteCategory(name);
    if (!deleted) {
      this.showError('Could not delete the category. Please try again.');
      return;
    }

    // onChange re-rendered the dropdown/manage list; refresh totals/chart too.
    this.refreshAll();
  }

  /**
   * Handles a submitted transaction from the input form.
   * Full implementation added in task 12.3.
   *
   * @param {string} itemName
   * @param {number} amount
   * @param {string} category
   * @returns {void}
   */
  handleFormSubmit(itemName, amount, category) {
    // Start from a clean slate so stale messages from a prior attempt do not
    // linger alongside the new result.
    this.inputForm.clearValidationErrors();

    // Run the same validation the manager uses so we can surface field-level
    // errors before attempting to add (Req 1.8).
    const validation = TransactionManager.validateTransaction(
      itemName,
      amount,
      category,
      this.categoryManager.getActiveCategories()
    );
    if (!validation.valid) {
      this.inputForm.showValidationErrors(validation.errors);
      return;
    }

    // Attempt to add the transaction. A null result means the add was
    // unexpectedly rejected (validation already passed above), so treat it as
    // an unexpected failure rather than a field error.
    const added = this.transactionManager.addTransaction(
      itemName,
      amount,
      category
    );
    if (added === null) {
      this.showError('Could not add the transaction. Please try again.');
      return;
    }

    // addTransaction persists via saveTransactions internally; if that write
    // failed the transaction still lives in memory. Warn the user that it may
    // not survive a reload while still showing the newly added entry (Req 2.2).
    if (!StorageManager.isStorageAvailable()) {
      this.showError(
        'Transaction added, but it could not be saved. It may be lost when you reload.'
      );
    }

    // Success: reset the form, return focus for rapid entry (Req 1.9), and
    // re-render everything to reflect the new transaction.
    this.inputForm.clearForm();
    this.inputForm.focusFirstInput();
    this.refreshAll();
  }

  /**
   * Handles a delete request for a single transaction (Req 4.2, 4.3, 4.4, 4.6).
   *
   * @param {string} transactionId
   * @returns {void}
   */
  handleDeleteClick(transactionId) {
    // Look up the transaction first so we can name it in the confirm dialog and
    // bail quietly if the id is unknown (e.g. already removed in another tab).
    const transaction = this.transactionManager.getTransactionById(transactionId);
    if (!transaction) {
      return;
    }

    // Require explicit confirmation before a destructive delete (Req 4.2).
    const confirmed = window.confirm(
      `Delete "${transaction.itemName}" transaction for ${formatCurrency(
        transaction.amount
      )}?`
    );
    if (!confirmed) {
      // User cancelled: leave everything untouched (Req 4.3).
      return;
    }

    // A false return means the persistence step failed; the manager has already
    // rolled back the in-memory removal, so re-render to restore the visible
    // list and tell the user the delete did not take effect (Req 4.6).
    const deleted = this.transactionManager.deleteTransaction(transactionId);
    if (!deleted) {
      this.showError('Could not delete the transaction. Please try again.');
      this.refreshAll();
      return;
    }

    // Success: re-render so the removed transaction disappears and totals and
    // the chart update accordingly (Req 4.4).
    this.refreshAll();
  }

  /**
   * Re-renders every child component from the current data.
   * Full implementation added in task 12.5.
   *
   * @returns {void}
   */
  refreshAll() {
    // Pull the current data once and fan it out to each child component so the
    // list, balance, and chart stay in sync from a single source of truth
    // (Req 3.4, 3.5, 4.7, 4.8, 5.3, 5.4, 6.4, 6.5). Data reads happen here,
    // outside the rAF callback below, so the frame does only DOM writes.
    const transactions = this.transactionManager.getTransactions();
    const totalCents = this.transactionManager.getTotalCents();
    const categoryTotals = this.transactionManager.getCategoryTotals();
    const monthlySummaries = this.transactionManager.getMonthlySummaries();

    // Align the DOM-mutating work (full list render + balance update) to the
    // next animation frame so visual updates land in a single batched paint and
    // stay smooth (Req 7.1, 7.5). transactionList.render() builds all items in
    // a DocumentFragment and appends once, so even ~1000 transactions cost a
    // single reflow (Req 7.6); incremental add/removeTransaction stay O(1)-ish
    // (prepend / direct node removal) for the optimized paths.
    requestAnimationFrame(() => {
      this.transactionList.render(transactions);
      this.monthlySummary.render(monthlySummaries);
      this.balanceDisplay.update(totalCents);
    });

    // Chart redraw is the heaviest update, so run it through the debounced
    // wrapper (Req 7.4) to batch rapid successive refreshes into one redraw.
    this.debouncedChartUpdate(categoryTotals);
  }

  /**
   * Handles cross-tab storage changes for multi-tab synchronization.
   * Full implementation added in task 12.6.
   *
   * @param {StorageEvent} event
   * @returns {void}
   */
  handleStorageChange(event) {
    if (!event) {
      return;
    }

    // Another tab changed custom categories: reload them and re-render the
    // dropdown/manage list, then refresh totals/chart (Req 2.4).
    if (event.key === CategoryManager.STORAGE_KEY) {
      this.categoryManager.initialize();
      this.renderCategoryOptions();
      this.renderManageList();
      this.refreshAll();
      return;
    }

    // The storage event fires for every key in the origin; ignore any change
    // that is not our transaction data (Req 2.4).
    if (event.key !== StorageManager.STORAGE_KEY) {
      return;
    }

    // Reload the data another tab wrote, then re-render so this tab reflects
    // the latest state.
    this.transactionManager.initialize();
    this.refreshAll();
  }

  /**
   * Displays a global error message by delegating to the shared utility.
   *
   * @param {string} message - Error text to show.
   * @param {number} [duration] - Optional auto-dismiss duration in ms.
   * @returns {void}
   */
  showError(message, duration) {
    showGlobalError(message, duration);
  }

  /**
   * Dismisses the global error banner by delegating to the shared utility.
   *
   * @returns {void}
   */
  dismissError() {
    dismissGlobalError();
  }

  /**
   * Shows a loading indicator for async operations.
   * Full implementation added in task 12.9.
   *
   * @param {string} [message]
   * @returns {void}
   */
  showLoading(message) {
    // Lightweight loading state: there is no dedicated spinner element in the
    // markup and all transaction operations are synchronous, so we simply lock
    // the form to prevent re-entrant submits while work is in flight (Req 7.7).
    this.inputForm.setDisabled(true);
  }

  /**
   * Hides the loading indicator.
   * Full implementation added in task 12.9.
   *
   * @returns {void}
   */
  hideLoading() {
    // Counterpart to showLoading(): re-enable the form. Kept minimal since the
    // operations it guards complete synchronously (Req 7.7).
    this.inputForm.setDisabled(false);
  }
}

// ===========================================================================
// Application initialization and entry point (Task 13)
// ===========================================================================

// Module-scoped reference to the active UIManager. The storage event listener
// (task 13.3) needs to reach the running instance, so we hold onto it here once
// initApp() has wired everything up. Stays null if init fails or is halted.
let uiManager = null;

/**
 * Boots the application: verifies Local Storage, builds the data and UI
 * layers, and performs the first render (Req 8.7, 8.8).
 *
 * Loaded via `defer`, so the DOM is already parsed by the time this runs; any
 * failure is caught, logged, and surfaced to the user via the global error
 * banner rather than leaving the page in a half-initialized state.
 *
 * @returns {void}
 */
function initApp() {
  try {
    // Local Storage is the sole persistence mechanism. Without it there is no
    // point creating managers or accepting input, so halt early with the exact
    // message required by Req 8.7.
    if (!StorageManager.isStorageAvailable()) {
      showGlobalError('Local Storage is required for this application to function');

      // Lock the form so the user cannot enter data that can never be saved.
      const form = document.getElementById('transaction-form');
      if (form) {
        const controls = form.querySelectorAll('input, select, button');
        controls.forEach((control) => {
          control.disabled = true;
        });
      }

      // Theming does not depend on storage; the finally block below applies
      // the OS preference and binds the toggle (ThemeManager.saveTheme() is
      // guarded and no-ops when storage is blocked). The toggle lives in the
      // header, outside the locked form, so it stays usable.
      return;
    }

    // Build the data layer first: load persisted categories and transactions
    // before any UI exists so the initial render reflects the saved state.
    const categoryManager = new CategoryManager(StorageManager);
    categoryManager.initialize();

    const transactionManager = new TransactionManager(
      StorageManager,
      categoryManager
    );
    transactionManager.initialize();

    // Build the UI layer on top of the data layer and bind all event handlers.
    uiManager = new UIManager(transactionManager, categoryManager);
    uiManager.initialize();
  } catch (error) {
    // Any unexpected failure during boot leaves the app unusable; log the
    // details for debugging and show a friendly message to the user.
    console.error('Failed to initialize the application:', error);
    showGlobalError('Something went wrong while starting the application. Please reload the page.');
  } finally {
    // Theming is independent of the rest of the boot: initialize it even when
    // the main UI init above fails, so the dark/light toggle always works (it
    // applies the saved/OS theme and binds the toggle click). Guarded so a
    // theming failure can never mask or worsen a prior error. When the chart
    // exists, ThemeManager.init() also refreshes it to match the active theme.
    try {
      ThemeManager.init();
    } catch (themeError) {
      console.error('Theme initialization failed:', themeError);
    }
  }
}

// Run initApp as soon as the DOM is ready. With `defer` the document is
// normally already parsed, but guard with a readyState check so the entry point
// is safe regardless of how the script ends up being loaded.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

/**
 * Global safety net for uncaught runtime errors (Req 2.2, 8.7). Logs the
 * error for debugging and shows a single generic message so repeated errors
 * do not spam the user with banner updates.
 */
window.addEventListener('error', (event) => {
  console.error('Unexpected error:', event.error || event.message);
  showGlobalError('An unexpected error occurred. Some features may not work correctly.');
});

/**
 * Multi-tab synchronization (Req 2.4). Another tab on the same origin writing
 * to Local Storage fires a storage event here; forward it to the UIManager so
 * this tab reloads and re-renders the latest data.
 */
window.addEventListener('storage', (event) => {
  if (uiManager) {
    uiManager.handleStorageChange(event);
  }
});
