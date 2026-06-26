# 💰 Budget — Personal Finance App

A clean, dependency-free personal budgeting app that runs entirely in your browser. No build step, no server, no account, no tracking — your financial data never leaves your device.

## Features

- **Dashboard** — income, expenses, amount invested, net, and savings rate at a glance, plus a spending-by-category breakdown and live budget status. When recurring items are due within the next 7 days, an "Upcoming This Week" alert appears at the top with the total amount due.
- **Transactions** — add, edit, and delete income, expense, and investment entries. Search and filter by type or category.
- **Calendar** — **Month** and **Week** views showing past and upcoming activity: variable expenses, paydays (income), investments, and recurring items, color-coded by type. Each view shows a **period total** (income, expenses, invested, net) for the visible month or week. Future recurring occurrences appear as projected (dashed) entries. Navigate with ‹ / › / Today, and **tap any day** to see a detailed breakdown (with that day's net) or add a new transaction pre-dated to that day. On narrow screens the month view collapses entries into colored dots and the week view becomes a readable day-by-day agenda.
- **Trends** — a month-over-month chart of income, expenses, and investments (grouped bars) with a **net line** across months, plus period totals and average savings rate. Choose a range of the last 6, 12, or 24 months, or all time.
- **Investments** — track money moved into investments separately from spending, so it doesn't distort your expense totals or budgets (it's saving, not consumption).
- **Recurring items** — set up fixed expenses (rent, subscriptions), recurring income (salary), or automatic contributions that repeat **weekly**, **monthly**, or on a **custom** schedule (every N days/weeks/months). The app automatically creates the transactions up to today and shows when each item is next due. Recurring-generated transactions are marked with a 🔁 in the list.
- **Budgets** — set a monthly spending limit per category and watch progress bars turn amber, then red, as you approach and exceed each limit.
- **Monthly periods** — pick any month to view that period's transactions, totals, and budget progress.
- **Categories** — fully customizable with names, colors, and budget limits.
- **Multi-currency** — choose from common currency symbols.
- **Automatic Google Drive sync** — optional one-time setup that keeps every device in sync through **your own** Google Drive: the app loads your latest data on open and saves quietly as you edit. Runs entirely in your browser via Google sign-in and the `drive.file` scope, so it can only touch the single `budget-sync.json` file it creates — your other Drive files stay private, and nothing goes to any third-party server. Conflicts resolve by most-recently-edited (last write wins).
- **Manual backup** — your data stays on the device by default. **Settings → Back Up** saves a backup file (on a phone this opens the share sheet, so you can Save to Google Drive/iCloud Drive or AirDrop it), and **Restore from File** loads it on another device. Export to CSV for spreadsheets too.
- **Sample data** — one click loads realistic example data so you can explore before entering your own.

The app opens on the **Calendar** as its home screen. On phones the navigation collapses into a **☰ menu** in the top bar that opens the full list of tabs (and the period picker); on wider screens the full sidebar is always visible.

## Usage

No installation required. Just open `index.html` in any modern browser:

```bash
# from the project directory
open index.html        # macOS
xdg-open index.html    # Linux
start index.html       # Windows
```

Or serve it locally:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

### Getting started

1. Open the app and click **Settings → Load Sample Data** to see it in action, or
2. Go to **Transactions → + Add Transaction** to record your first entry.
3. Set monthly limits under **Budgets** to track your spending against goals.

## Data & privacy

All data is kept in your browser's `localStorage` under the key `budget-app-v1`. Nothing is sent anywhere. Clearing your browser data will erase it, so use **Settings → Export JSON** for backups.

## Tech

Plain HTML, CSS, and vanilla JavaScript — no frameworks or dependencies. The entire app is three files: `index.html`, `styles.css`, and `app.js`.
