# Expense & Budget Visualizer

A client-side Expense & Budget Visualizer. Track expenses by category (Food, Transport, Fun), see a running total, and view a pie chart of your spending distribution. It is built with pure HTML/CSS/Vanilla JavaScript (ES6+) and uses Chart.js (loaded from a CDN) for the chart. Data persists in your browser's Local Storage, so there is no server and no build step.

## Features

- **Transaction entry with validation** — add an expense with an item name, amount, and category; invalid input shows a clear, specific error and is blocked.
- **Transaction list with delete + confirmation** — all transactions are shown newest-first; each has a delete control that asks for confirmation before removing the entry.
- **Real-time total** — the total spending updates immediately as transactions are added or deleted.
- **Pie chart** — spending distribution across categories, with a legend and per-segment percentages.
- **Local Storage persistence** — your data is saved automatically and restored when you reopen the app.
- **Multi-tab sync** — changes made in one browser tab are reflected in other open tabs.
- **Responsive, accessible UI** — works across screen sizes and is built to accessibility guidelines.

## Setup / Run

No build step is required.

Because the app loads Chart.js from a CDN and uses Local Storage, you can either:

1. Open `index.html` directly in your browser, or
2. **(Recommended)** Serve the folder with a simple static server. For example:

   ```bash
   python -m http.server 8000
   ```

   Then visit [http://localhost:8000](http://localhost:8000).

> **Note:** Chart.js is loaded from the jsDelivr CDN, so an internet connection is required for the chart to render.

## Project Structure

```
expense-budget-visualizer/
├── index.html          # Semantic HTML5 structure: balance header, input form,
│                       # transaction list, chart canvas, and global error banner.
│                       # Links the stylesheet and app script, loads Chart.js from CDN.
├── css/
│   └── styles.css      # All application styles: layout, form and list styling,
│                       # category color-coding, error states, chart section,
│                       # focus indicators, and responsive/accessible rules.
└── js/
    └── app.js          # All application logic: storage management, transaction
                        # management/validation, UI components (form, list, balance,
                        # chart), the UI coordinator, and app initialization.
```

## Local Storage Schema

- **Key:** `expense-tracker-transactions`
- **Value:** a JSON string of the form:

  ```json
  {
    "version": "1.0",
    "transactions": []
  }
  ```

Each `Transaction` has the following shape:

```ts
{
  id: string,          // unique identifier
  itemName: string,    // item description
  amount: number,      // amount in integer cents
  category: string,    // "Food" | "Transport" | "Fun"
  timestamp: number    // creation time in milliseconds since epoch
}
```

> Amounts are stored as **integer cents** (e.g. `$25.50` is stored as `2550`) to avoid floating-point rounding errors, and are formatted back to dollars for display.

## Browser Support

The app targets the latest versions of **Chrome, Firefox, Edge, and Safari**. Local Storage must be enabled for the app to function; if it is unavailable or disabled, the app shows an error and prevents data entry.

### Browser-specific notes

- **Safari private browsing** may restrict Local Storage. The app detects this and displays an error message when storage cannot be used.
- **Custom scrollbar styling** uses `-webkit-scrollbar` on Chromium-based browsers and Safari, and `scrollbar-width` / `scrollbar-color` on Firefox.

## Accessibility

The interface is built targeting **WCAG AA**, including:

- Labeled form inputs
- ARIA roles and live regions (e.g. the balance announces updates)
- Visible keyboard focus indicators
- Minimum 44×44px touch targets for interactive elements
- Sufficient color contrast for text and category colors

Full WCAG conformance cannot be confirmed by code alone — complete validation requires manual testing with assistive technologies and expert accessibility review.
