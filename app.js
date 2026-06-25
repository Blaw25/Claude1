/* Budget — a dependency-free personal finance app.
   All state lives in localStorage; everything renders from the `state` object. */

(() => {
  "use strict";

  const STORAGE_KEY = "budget-app-v1";

  const CURRENCIES = [
    { code: "USD", symbol: "$" },
    { code: "EUR", symbol: "€" },
    { code: "GBP", symbol: "£" },
    { code: "JPY", symbol: "¥" },
    { code: "INR", symbol: "₹" },
    { code: "CAD", symbol: "C$" },
    { code: "AUD", symbol: "A$" },
    { code: "BRL", symbol: "R$" },
  ];

  const DEFAULT_CATEGORIES = [
    { name: "Salary", budget: 0, color: "#34d399", type: "income" },
    { name: "Housing", budget: 1200, color: "#6366f1" },
    { name: "Groceries", budget: 500, color: "#f59e0b" },
    { name: "Dining Out", budget: 200, color: "#ec4899" },
    { name: "Transport", budget: 150, color: "#06b6d4" },
    { name: "Utilities", budget: 250, color: "#8b5cf6" },
    { name: "Entertainment", budget: 120, color: "#f43f5e" },
    { name: "Health", budget: 100, color: "#10b981" },
    { name: "Other", budget: 0, color: "#94a3b8" },
    { name: "Investments", budget: 0, color: "#60a5fa", type: "investment" },
  ];

  // ---- State ----------------------------------------------------------------

  let state = loadState();

  function makeDefaultState() {
    return {
      currency: "USD",
      categories: DEFAULT_CATEGORIES.map((c, i) => ({ id: "cat-" + (i + 1), ...c })),
      transactions: [],
      recurring: [],
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return makeDefaultState();
      const parsed = JSON.parse(raw);
      // basic shape guard
      if (!parsed.categories || !parsed.transactions) return makeDefaultState();
      parsed.currency = parsed.currency || "USD";
      parsed.recurring = parsed.recurring || [];
      return parsed;
    } catch {
      return makeDefaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // ---- Helpers --------------------------------------------------------------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const uid = (prefix) =>
    prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function currencySymbol() {
    return (CURRENCIES.find((c) => c.code === state.currency) || CURRENCIES[0]).symbol;
  }

  function fmt(amount) {
    const sym = currencySymbol();
    const n = Math.abs(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return (amount < 0 ? "-" : "") + sym + n;
  }

  function monthKey(dateStr) {
    return dateStr.slice(0, 7); // YYYY-MM
  }

  function currentMonth() {
    return $("#month-filter").value || new Date().toISOString().slice(0, 7);
  }

  function categoryById(id) {
    return state.categories.find((c) => c.id === id);
  }

  // Categories created before the type field existed are expenses.
  function catType(c) {
    return c && c.type ? c.type : "expense";
  }

  // ---- Dates & recurrence ---------------------------------------------------

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  }

  function parseDate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function fmtDateObj(dt) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
      dt.getDate()
    ).padStart(2, "0")}`;
  }

  // Advance a date by interval units, clamping to month length for months
  // (e.g. Jan 31 + 1 month -> Feb 28).
  function addInterval(dt, interval, unit) {
    const y = dt.getFullYear(),
      m = dt.getMonth(),
      d = dt.getDate();
    if (unit === "days") return new Date(y, m, d + interval);
    if (unit === "weeks") return new Date(y, m, d + interval * 7);
    const total = m + interval;
    const ny = y + Math.floor(total / 12);
    const nm = ((total % 12) + 12) % 12;
    const daysInMonth = new Date(ny, nm + 1, 0).getDate();
    return new Date(ny, nm, Math.min(d, daysInMonth));
  }

  function recurrenceLabel(r) {
    if (r.frequency === "weekly") return "Weekly";
    if (r.frequency === "monthly") return "Monthly";
    const unit = r.interval === 1 ? r.unit.replace(/s$/, "") : r.unit;
    return `Every ${r.interval} ${unit}`;
  }

  function formatDateFull(dt) {
    return dt.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  // All occurrence dates of a rule within [start, end] (Date objects).
  function occurrencesInRange(r, start, end) {
    const out = [];
    let dt = parseDate(r.startDate);
    let guard = 0;
    while (dt <= end && guard < 6000) {
      if (dt >= start) out.push(fmtDateObj(dt));
      dt = addInterval(dt, r.interval, r.unit);
      guard++;
    }
    return out;
  }

  // The next occurrence strictly after today.
  function nextDue(r) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let dt = parseDate(r.startDate);
    let guard = 0;
    while (dt <= today && guard < 5000) {
      dt = addInterval(dt, r.interval, r.unit);
      guard++;
    }
    return dt;
  }

  // Create concrete transactions for each recurring rule from its start date
  // up to today. De-duped by (rule, date) so it is safe to run repeatedly.
  function generateRecurringTransactions() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let added = 0;
    (state.recurring || []).forEach((r) => {
      const existing = new Set(
        state.transactions.filter((t) => t.recurringId === r.id).map((t) => t.date)
      );
      let dt = parseDate(r.startDate);
      let guard = 0;
      while (dt <= today && guard < 2000) {
        const ds = fmtDateObj(dt);
        if (!existing.has(ds)) {
          state.transactions.push({
            id: uid("tx"),
            type: r.type,
            amount: r.amount,
            description: r.description,
            categoryId: r.categoryId,
            date: ds,
            recurringId: r.id,
          });
          existing.add(ds);
          added++;
        }
        dt = addInterval(dt, r.interval, r.unit);
        guard++;
      }
    });
    if (added) saveState();
    return added;
  }

  function monthLabel(key) {
    const [y, m] = key.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }

  function txForMonth(key) {
    return state.transactions.filter((t) => monthKey(t.date) === key);
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2400);
  }

  // ---- Rendering ------------------------------------------------------------

  function renderAll() {
    renderDashboard();
    renderTransactions();
    renderCalendar();
    renderBudgets();
    renderRecurring();
    populateCategorySelects();
  }

  function renderRecurring() {
    const list = $("#recurring-list");
    const empty = $("#recurring-empty");
    const rules = state.recurring || [];
    if (!rules.length) {
      list.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.innerHTML = rules
      .map((r) => {
        const cat = categoryById(r.categoryId);
        const typeWord =
          r.type === "income" ? "Income" : r.type === "investment" ? "Investment" : "Expense";
        return `<div class="budget-card">
          <div class="budget-card-head">
            <div class="budget-card-title"><span class="cat-dot" style="background:${
              cat ? cat.color : "#94a3b8"
            }"></span>${escapeHtml(r.description)}</div>
            <div class="row-actions">
              <button class="icon-btn" data-edit-rec="${r.id}" title="Edit">✏️</button>
              <button class="icon-btn" data-del-rec="${r.id}" title="Delete">🗑️</button>
            </div>
          </div>
          <div class="spent"><span>${fmt(r.amount)} · ${typeWord}</span><span>${recurrenceLabel(
          r
        )}</span></div>
          <div class="meta">${
            cat ? escapeHtml(cat.name) : "Uncategorized"
          } · Next: ${formatDateFull(nextDue(r))}</div>
        </div>`;
      })
      .join("");
  }

  function renderDashboard() {
    const key = currentMonth();
    const tx = txForMonth(key);
    $("#dashboard-period-label").textContent = monthLabel(key);

    const income = tx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const expenses = tx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const invested = tx.filter((t) => t.type === "investment").reduce((s, t) => s + t.amount, 0);
    // Net is the cash left over after both spending and investing.
    const net = income - expenses - invested;
    // Savings rate counts everything not spent (leftover cash + invested).
    const savings = income > 0 ? Math.round(((income - expenses) / income) * 100) : 0;

    $("#stat-income").textContent = fmt(income);
    $("#stat-expenses").textContent = fmt(expenses);
    $("#stat-invested").textContent = fmt(invested);
    const netEl = $("#stat-net");
    netEl.textContent = fmt(net);
    netEl.className = "stat-value " + (net >= 0 ? "income" : "expense");
    $("#stat-savings").textContent = savings + "%";

    renderCategoryChart(tx);
    renderBudgetStatus(tx);
    renderRecent(tx);
    renderUpcoming();
  }

  // Recurring items due within the next 7 days. Hidden when nothing is due.
  function renderUpcoming() {
    const card = $("#upcoming-card");
    const list = $("#upcoming-list");
    const totalEl = $("#upcoming-total");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 7);

    const items = (state.recurring || [])
      .map((r) => ({ r, due: nextDue(r) }))
      .filter((x) => x.due > today && x.due <= horizon)
      .sort((a, b) => a.due - b.due);

    if (!items.length) {
      card.hidden = true;
      return;
    }
    card.hidden = false;

    let outflow = 0;
    list.innerHTML = items
      .map(({ r, due }) => {
        const cat = categoryById(r.categoryId);
        const sign = r.type === "income" ? "+" : "-";
        const amtCls =
          r.type === "income"
            ? "amount-income"
            : r.type === "investment"
            ? "amount-investment"
            : "amount-expense";
        if (r.type !== "income") outflow += r.amount;
        const days = Math.round((due - today) / 86400000);
        const rel = days === 1 ? "Tomorrow" : `in ${days} days`;
        const soon = days <= 2 ? "up-soon" : "";
        return `<div class="upcoming-row">
          <span class="cat-dot" style="background:${cat ? cat.color : "#94a3b8"}"></span>
          <span>${escapeHtml(r.description)}</span>
          <span class="up-when ${soon}">${rel} · ${formatDateFull(due)}</span>
          <span class="up-amt ${amtCls}">${sign}${fmt(r.amount)}</span>
        </div>`;
      })
      .join("");

    totalEl.textContent = outflow > 0 ? `${fmt(outflow)} due` : "";
  }

  // Compact amount for calendar chips (no decimals to save space).
  function fmtShort(amount) {
    return currencySymbol() + Math.round(amount).toLocaleString();
  }

  // Map of date -> entries for a month, merging real transactions with
  // projected future recurring occurrences (those after today).
  function calendarItemsForMonth(key) {
    const [y, m] = key.split("-").map(Number);
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const byDate = {};
    const push = (ds, item) => (byDate[ds] = byDate[ds] || []).push(item);

    state.transactions.forEach((t) => {
      if (monthKey(t.date) === key) {
        push(t.date, {
          type: t.type,
          amount: t.amount,
          description: t.description,
          categoryId: t.categoryId,
          recurring: !!t.recurringId,
          projected: false,
        });
      }
    });

    (state.recurring || []).forEach((r) => {
      occurrencesInRange(r, monthStart, monthEnd).forEach((ds) => {
        if (parseDate(ds) > today) {
          push(ds, {
            type: r.type,
            amount: r.amount,
            description: r.description,
            categoryId: r.categoryId,
            recurring: true,
            projected: true,
          });
        }
      });
    });

    return byDate;
  }

  function renderCalendar() {
    const key = currentMonth();
    $("#calendar-label").textContent = monthLabel(key);
    const [y, m] = key.split("-").map(Number);
    const byDate = calendarItemsForMonth(key);
    const startWeekday = new Date(y, m - 1, 1).getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const today = todayStr();

    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push(`<div class="cal-cell empty"></div>`);

    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${key}-${String(day).padStart(2, "0")}`;
      const items = byDate[ds] || [];
      const chips = items
        .slice(0, 3)
        .map((it) => {
          const cls =
            it.type === "income" ? "income" : it.type === "investment" ? "investment" : "expense";
          const sign = it.type === "income" ? "+" : "-";
          return `<span class="cal-chip ${cls}${it.projected ? " projected" : ""}">${
            it.recurring ? "🔁" : ""
          }${sign}${fmtShort(it.amount)}</span>`;
        })
        .join("");
      const more = items.length > 3 ? `<span class="cal-more">+${items.length - 3} more</span>` : "";
      cells.push(`<div class="cal-cell${ds === today ? " today" : ""}${
        items.length ? " has-items" : ""
      }"${items.length ? ` data-cal-date="${ds}"` : ""}>
        <div class="cal-day">${day}</div>
        <div class="cal-chips">${chips}${more}</div>
      </div>`);
    }
    while (cells.length % 7 !== 0) cells.push(`<div class="cal-cell empty"></div>`);

    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
      .map((d) => `<div class="cal-weekday">${d}</div>`)
      .join("");
    $("#calendar-grid").innerHTML = weekdays + cells.join("");
  }

  function openDayModal(ds) {
    const items = calendarItemsForMonth(monthKey(ds))[ds] || [];
    const dateObj = parseDate(ds);
    $("#day-modal-title").textContent = formatDateFull(dateObj);

    let net = 0;
    const rows = items
      .map((it) => {
        const cat = categoryById(it.categoryId);
        const sign = it.type === "income" ? "+" : "-";
        const amtCls =
          it.type === "income"
            ? "amount-income"
            : it.type === "investment"
            ? "amount-investment"
            : "amount-expense";
        net += it.type === "income" ? it.amount : -it.amount;
        const tags =
          (it.recurring ? `<span class="tag">🔁 recurring</span>` : "") +
          (it.projected ? `<span class="tag">upcoming</span>` : "");
        return `<div class="day-row">
          <span class="cat-dot" style="background:${cat ? cat.color : "#94a3b8"}"></span>
          <span>${escapeHtml(it.description)}${tags}<div class="day-sub">${
          cat ? escapeHtml(cat.name) : "Uncategorized"
        }</div></span>
          <span class="${amtCls}">${sign}${fmt(it.amount)}</span>
        </div>`;
      })
      .join("");

    $("#day-modal-body").innerHTML =
      (rows || `<div class="empty-state">No entries.</div>`) +
      (items.length
        ? `<div class="day-total"><span>Net</span><span class="${
            net >= 0 ? "amount-income" : "amount-expense"
          }">${net >= 0 ? "+" : "-"}${fmt(Math.abs(net))}</span></div>`
        : "");
    openModal("day-modal");
  }

  function renderCategoryChart(tx) {
    const wrap = $("#category-chart");
    const spend = {};
    tx.filter((t) => t.type === "expense").forEach((t) => {
      spend[t.categoryId] = (spend[t.categoryId] || 0) + t.amount;
    });
    const rows = Object.entries(spend)
      .map(([id, amt]) => ({ cat: categoryById(id), amt }))
      .filter((r) => r.cat)
      .sort((a, b) => b.amt - a.amt);

    if (!rows.length) {
      wrap.innerHTML = `<div class="empty-state">No expenses recorded this period.</div>`;
      return;
    }

    const max = Math.max(...rows.map((r) => r.amt));
    wrap.innerHTML = rows
      .map((r) => {
        const pct = max > 0 ? (r.amt / max) * 100 : 0;
        return `<div class="chart-row">
          <span class="chart-label">${escapeHtml(r.cat.name)}</span>
          <span class="chart-bar-track"><span class="chart-bar-fill" style="width:${pct}%;background:${r.cat.color}"></span></span>
          <span class="chart-amount">${fmt(r.amt)}</span>
        </div>`;
      })
      .join("");
  }

  function renderBudgetStatus(tx) {
    const list = $("#budget-status-list");
    const budgeted = state.categories.filter((c) => c.budget > 0 && catType(c) === "expense");
    if (!budgeted.length) {
      list.innerHTML = `<div class="empty-state">No budgets set. Add limits on the Budgets tab.</div>`;
      return;
    }
    const spendByCat = {};
    tx.filter((t) => t.type === "expense").forEach((t) => {
      spendByCat[t.categoryId] = (spendByCat[t.categoryId] || 0) + t.amount;
    });

    list.innerHTML = budgeted
      .map((c) => {
        const spent = spendByCat[c.id] || 0;
        const pct = Math.min((spent / c.budget) * 100, 100);
        const cls = spent > c.budget ? "over" : spent > c.budget * 0.85 ? "warn" : "";
        return `<div class="budget-status-item">
          <div class="bs-head">
            <span>${escapeHtml(c.name)}</span>
            <span>${fmt(spent)} / ${fmt(c.budget)}</span>
          </div>
          <div class="bs-track"><div class="bs-fill ${cls}" style="width:${pct}%"></div></div>
        </div>`;
      })
      .join("");
  }

  function renderRecent(tx) {
    const wrap = $("#recent-transactions");
    const recent = [...tx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
    if (!recent.length) {
      wrap.innerHTML = `<div class="empty-state">No transactions yet this period.</div>`;
      return;
    }
    wrap.innerHTML = `<table class="tx-table"><tbody>${recent
      .map((t) => txRowHtml(t, false))
      .join("")}</tbody></table>`;
  }

  function txRowHtml(t, withActions = true) {
    const cat = categoryById(t.categoryId);
    const sign = t.type === "income" ? "+" : "-";
    const amtCls =
      t.type === "income"
        ? "amount-income"
        : t.type === "investment"
        ? "amount-investment"
        : "amount-expense";
    return `<tr>
      <td>${formatDate(t.date)}</td>
      <td>${escapeHtml(t.description)}${
        t.recurringId ? `<span class="recur-badge" title="From a recurring item">🔁</span>` : ""
      }</td>
      <td>${cat ? `<span class="cat-pill"><span class="cat-dot" style="background:${cat.color}"></span>${escapeHtml(cat.name)}</span>` : "—"}</td>
      <td class="num ${amtCls}">${sign}${fmt(t.amount)}</td>
      ${
        withActions
          ? `<td><div class="row-actions">
               <button class="icon-btn" data-edit-tx="${t.id}" title="Edit">✏️</button>
               <button class="icon-btn" data-del-tx="${t.id}" title="Delete">🗑️</button>
             </div></td>`
          : ""
      }
    </tr>`;
  }

  function renderTransactions() {
    const key = currentMonth();
    const search = $("#tx-search").value.trim().toLowerCase();
    const typeFilter = $("#tx-type-filter").value;
    const catFilter = $("#tx-category-filter").value;

    let tx = txForMonth(key).sort((a, b) => b.date.localeCompare(a.date));
    if (typeFilter !== "all") tx = tx.filter((t) => t.type === typeFilter);
    if (catFilter !== "all") tx = tx.filter((t) => t.categoryId === catFilter);
    if (search)
      tx = tx.filter((t) => t.description.toLowerCase().includes(search));

    const tbody = $("#tx-tbody");
    const empty = $("#tx-empty");
    if (!tx.length) {
      tbody.innerHTML = "";
      empty.hidden = false;
    } else {
      empty.hidden = true;
      tbody.innerHTML = tx.map((t) => txRowHtml(t, true)).join("");
    }
  }

  function renderBudgets() {
    const key = currentMonth();
    const tx = txForMonth(key);
    const spendByCat = {};
    const incomeByCat = {};
    const investByCat = {};
    const buckets = { expense: spendByCat, income: incomeByCat, investment: investByCat };
    tx.forEach((t) => {
      const bucket = buckets[t.type] || spendByCat;
      bucket[t.categoryId] = (bucket[t.categoryId] || 0) + t.amount;
    });

    const list = $("#budgets-list");
    list.innerHTML = state.categories
      .map((c) => {
        const spent = spendByCat[c.id] || 0;
        const hasBudget = c.budget > 0;
        const pct = hasBudget ? Math.min((spent / c.budget) * 100, 100) : 0;
        const cls = spent > c.budget ? "over" : spent > c.budget * 0.85 ? "warn" : "";
        const remaining = c.budget - spent;
        const head = `<div class="budget-card-head">
            <div class="budget-card-title"><span class="cat-dot" style="background:${c.color}"></span>${escapeHtml(c.name)}</div>
            <div class="row-actions">
              <button class="icon-btn" data-edit-cat="${c.id}" title="Edit">✏️</button>
              <button class="icon-btn" data-del-cat="${c.id}" title="Delete">🗑️</button>
            </div>
          </div>`;
        if (catType(c) === "income") {
          const received = incomeByCat[c.id] || 0;
          return `<div class="budget-card">${head}
            <div class="spent"><span>${fmt(received)} received</span><span>Income</span></div>
          </div>`;
        }
        if (catType(c) === "investment") {
          const contributed = investByCat[c.id] || 0;
          return `<div class="budget-card">${head}
            <div class="spent"><span>${fmt(contributed)} invested</span><span>Investment</span></div>
          </div>`;
        }
        return `<div class="budget-card">
          ${head}
          ${
            hasBudget
              ? `<div class="bs-track"><div class="bs-fill ${cls}" style="width:${pct}%"></div></div>
                 <div class="spent"><span>${fmt(spent)} spent</span><span>${
                   remaining >= 0 ? fmt(remaining) + " left" : fmt(-remaining) + " over"
                 }</span></div>`
              : `<div class="spent"><span>${fmt(spent)} spent</span><span>No limit set</span></div>`
          }
        </div>`;
      })
      .join("");
  }

  function populateCategorySelects() {
    const txCat = $("#tx-category");
    const filterCat = $("#tx-category-filter");
    const selectedType = ($("input[name='tx-type']:checked") || {}).value || "expense";

    // Transaction modal: show only categories whose type matches the chosen
    // transaction type (expense / income / investment).
    const relevant = state.categories.filter((c) => catType(c) === selectedType);
    const prev = txCat.value;
    txCat.innerHTML = relevant
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      .join("");
    if (relevant.some((c) => c.id === prev)) txCat.value = prev;

    const prevFilter = filterCat.value;
    filterCat.innerHTML =
      `<option value="all">All categories</option>` +
      state.categories
        .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
        .join("");
    filterCat.value = prevFilter && [...filterCat.options].some((o) => o.value === prevFilter) ? prevFilter : "all";

    // Recurring modal: same type-matched category list as the transaction form.
    const recCat = $("#rec-category");
    if (recCat) {
      const recType = ($("input[name='rec-type']:checked") || {}).value || "expense";
      const recRelevant = state.categories.filter((c) => catType(c) === recType);
      const prevRec = recCat.value;
      recCat.innerHTML = recRelevant
        .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
        .join("");
      if (recRelevant.some((c) => c.id === prevRec)) recCat.value = prevRec;
    }
  }

  // ---- Utilities ------------------------------------------------------------

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // ---- Modals ---------------------------------------------------------------

  function openModal(id) {
    $("#" + id).hidden = false;
  }
  function closeModal(id) {
    $("#" + id).hidden = true;
  }

  function openTxModal(tx) {
    $("#tx-modal-title").textContent = tx ? "Edit Transaction" : "Add Transaction";
    $("#tx-id").value = tx ? tx.id : "";
    const type = tx ? tx.type : "expense";
    $(`input[name='tx-type'][value='${type}']`).checked = true;
    $("#tx-amount").value = tx ? tx.amount : "";
    $("#tx-description").value = tx ? tx.description : "";
    $("#tx-date").value = tx ? tx.date : new Date().toISOString().slice(0, 10);
    populateCategorySelects();
    if (tx) $("#tx-category").value = tx.categoryId;
    openModal("tx-modal");
    $("#tx-amount").focus();
  }

  function openCatModal(cat) {
    $("#cat-modal-title").textContent = cat ? "Edit Category" : "Add Category";
    $("#cat-id").value = cat ? cat.id : "";
    const type = cat ? catType(cat) : "expense";
    $(`input[name='cat-type'][value='${type}']`).checked = true;
    $("#cat-name").value = cat ? cat.name : "";
    $("#cat-budget").value = cat ? cat.budget : 0;
    $("#cat-color").value = cat ? cat.color : "#6366f1";
    updateCatBudgetVisibility();
    openModal("cat-modal");
    $("#cat-name").focus();
  }

  // Budgets only apply to spending, so hide the limit field for
  // income and investment categories.
  function updateCatBudgetVisibility() {
    const type = ($("input[name='cat-type']:checked") || {}).value || "expense";
    $("#cat-budget-field").style.display = type === "expense" ? "" : "none";
  }

  function openRecModal(rule) {
    $("#rec-modal-title").textContent = rule ? "Edit Recurring" : "Add Recurring";
    $("#rec-id").value = rule ? rule.id : "";
    const type = rule ? rule.type : "expense";
    $(`input[name='rec-type'][value='${type}']`).checked = true;
    $("#rec-amount").value = rule ? rule.amount : "";
    $("#rec-description").value = rule ? rule.description : "";
    $("#rec-frequency").value = rule ? rule.frequency : "monthly";
    $("#rec-interval").value = rule ? rule.interval : 2;
    $("#rec-unit").value = rule ? rule.unit : "weeks";
    $("#rec-start").value = rule ? rule.startDate : todayStr();
    populateCategorySelects();
    if (rule) $("#rec-category").value = rule.categoryId;
    updateRecCustomVisibility();
    openModal("rec-modal");
    $("#rec-amount").focus();
  }

  function updateRecCustomVisibility() {
    $("#rec-custom-fields").hidden = $("#rec-frequency").value !== "custom";
  }

  // ---- Event wiring ---------------------------------------------------------

  function init() {
    // month filter default
    $("#month-filter").value = new Date().toISOString().slice(0, 7);

    // currency select
    const curSel = $("#currency-select");
    curSel.innerHTML = CURRENCIES.map(
      (c) => `<option value="${c.code}">${c.code} (${c.symbol})</option>`
    ).join("");
    curSel.value = state.currency;
    curSel.addEventListener("change", () => {
      state.currency = curSel.value;
      saveState();
      renderAll();
    });

    // nav
    $$(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".nav-item").forEach((b) => b.classList.remove("active"));
        $$(".view").forEach((v) => v.classList.remove("active"));
        btn.classList.add("active");
        $("#view-" + btn.dataset.view).classList.add("active");
      });
    });

    $("#month-filter").addEventListener("change", renderAll);

    // calendar month navigation
    const shiftMonth = (delta) => {
      const [y, m] = currentMonth().split("-").map(Number);
      const d = new Date(y, m - 1 + delta, 1);
      $("#month-filter").value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      renderAll();
    };
    $("#cal-prev").addEventListener("click", () => shiftMonth(-1));
    $("#cal-next").addEventListener("click", () => shiftMonth(1));
    $("#cal-today").addEventListener("click", () => {
      $("#month-filter").value = new Date().toISOString().slice(0, 7);
      renderAll();
    });

    // transaction filters
    $("#tx-search").addEventListener("input", renderTransactions);
    $("#tx-type-filter").addEventListener("change", renderTransactions);
    $("#tx-category-filter").addEventListener("change", renderTransactions);

    // add buttons
    $("#add-transaction-btn").addEventListener("click", () => openTxModal(null));
    $("#add-category-btn").addEventListener("click", () => openCatModal(null));
    $("#add-recurring-btn").addEventListener("click", () => openRecModal(null));

    // type toggle re-populates category list
    $$("input[name='tx-type']").forEach((r) =>
      r.addEventListener("change", populateCategorySelects)
    );

    // category type toggle hides the budget field for income categories
    $$("input[name='cat-type']").forEach((r) =>
      r.addEventListener("change", updateCatBudgetVisibility)
    );

    // recurring modal: type changes the category list; frequency shows custom fields
    $$("input[name='rec-type']").forEach((r) =>
      r.addEventListener("change", populateCategorySelects)
    );
    $("#rec-frequency").addEventListener("change", updateRecCustomVisibility);

    const closeAllModals = () => {
      closeModal("tx-modal");
      closeModal("cat-modal");
      closeModal("rec-modal");
      closeModal("day-modal");
    };

    // modal close buttons + backdrop click
    $$("[data-close-modal]").forEach((b) => b.addEventListener("click", closeAllModals));
    $$(".modal-backdrop").forEach((bd) =>
      bd.addEventListener("click", (e) => {
        if (e.target === bd) bd.hidden = true;
      })
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAllModals();
    });

    // transaction form
    $("#tx-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const id = $("#tx-id").value;
      const data = {
        type: $("input[name='tx-type']:checked").value,
        amount: parseFloat($("#tx-amount").value) || 0,
        description: $("#tx-description").value.trim(),
        categoryId: $("#tx-category").value,
        date: $("#tx-date").value,
      };
      if (data.amount <= 0) return toast("Amount must be greater than zero.");
      if (id) {
        const t = state.transactions.find((x) => x.id === id);
        Object.assign(t, data);
        toast("Transaction updated.");
      } else {
        state.transactions.push({ id: uid("tx"), ...data });
        toast("Transaction added.");
      }
      saveState();
      closeModal("tx-modal");
      renderAll();
    });

    // category form
    $("#cat-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const id = $("#cat-id").value;
      const type = $("input[name='cat-type']:checked").value;
      const data = {
        name: $("#cat-name").value.trim(),
        budget: type === "expense" ? parseFloat($("#cat-budget").value) || 0 : 0,
        color: $("#cat-color").value,
        type,
      };
      if (!data.name) return toast("Category needs a name.");
      if (id) {
        Object.assign(categoryById(id), data);
        toast("Category updated.");
      } else {
        state.categories.push({ id: uid("cat"), ...data });
        toast("Category added.");
      }
      saveState();
      closeModal("cat-modal");
      renderAll();
    });

    // recurring form
    $("#rec-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const id = $("#rec-id").value;
      const frequency = $("#rec-frequency").value;
      let interval = 1,
        unit = "months";
      if (frequency === "weekly") {
        interval = 1;
        unit = "weeks";
      } else if (frequency === "monthly") {
        interval = 1;
        unit = "months";
      } else {
        interval = Math.max(1, parseInt($("#rec-interval").value, 10) || 1);
        unit = $("#rec-unit").value;
      }
      const data = {
        type: $("input[name='rec-type']:checked").value,
        amount: parseFloat($("#rec-amount").value) || 0,
        description: $("#rec-description").value.trim(),
        categoryId: $("#rec-category").value,
        frequency,
        interval,
        unit,
        startDate: $("#rec-start").value,
      };
      if (data.amount <= 0) return toast("Amount must be greater than zero.");
      if (!data.description) return toast("Add a description.");
      if (!data.categoryId) return toast("Pick a category.");
      if (!data.startDate) return toast("Pick a start date.");
      if (id) {
        Object.assign(state.recurring.find((x) => x.id === id), data);
        toast("Recurring item updated.");
      } else {
        state.recurring.push({ id: uid("rec"), ...data });
        toast("Recurring item added.");
      }
      saveState();
      generateRecurringTransactions();
      closeModal("rec-modal");
      renderAll();
    });

    // delegated clicks for edit/delete
    document.body.addEventListener("click", (e) => {
      const editTx = e.target.closest("[data-edit-tx]");
      const delTx = e.target.closest("[data-del-tx]");
      const editCat = e.target.closest("[data-edit-cat]");
      const delCat = e.target.closest("[data-del-cat]");
      const editRec = e.target.closest("[data-edit-rec]");
      const delRec = e.target.closest("[data-del-rec]");
      const calDay = e.target.closest("[data-cal-date]");

      if (editTx) {
        const t = state.transactions.find((x) => x.id === editTx.dataset.editTx);
        if (t) openTxModal(t);
      } else if (delTx) {
        if (confirm("Delete this transaction?")) {
          state.transactions = state.transactions.filter((x) => x.id !== delTx.dataset.delTx);
          saveState();
          renderAll();
          toast("Transaction deleted.");
        }
      } else if (editCat) {
        const c = categoryById(editCat.dataset.editCat);
        if (c) openCatModal(c);
      } else if (delCat) {
        const id = delCat.dataset.delCat;
        const used = state.transactions.some((t) => t.categoryId === id);
        if (used) {
          return toast("Can't delete a category that has transactions.");
        }
        if (confirm("Delete this category?")) {
          state.categories = state.categories.filter((c) => c.id !== id);
          saveState();
          renderAll();
          toast("Category deleted.");
        }
      } else if (editRec) {
        const r = state.recurring.find((x) => x.id === editRec.dataset.editRec);
        if (r) openRecModal(r);
      } else if (delRec) {
        const id = delRec.dataset.delRec;
        const count = state.transactions.filter((t) => t.recurringId === id).length;
        if (
          confirm(
            `Delete this recurring item? The ${count} transaction(s) it already created will be kept.`
          )
        ) {
          state.recurring = state.recurring.filter((r) => r.id !== id);
          saveState();
          renderAll();
          toast("Recurring item deleted.");
        }
      } else if (calDay) {
        openDayModal(calDay.dataset.calDate);
      }
    });

    // settings: data management
    $("#export-json-btn").addEventListener("click", exportJson);
    $("#export-csv-btn").addEventListener("click", exportCsv);
    $("#import-btn").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", importJson);
    $("#seed-btn").addEventListener("click", seedSampleData);
    $("#clear-btn").addEventListener("click", () => {
      if (confirm("This erases all transactions and categories. Continue?")) {
        state = makeDefaultState();
        saveState();
        renderAll();
        toast("All data cleared.");
      }
    });

    generateRecurringTransactions();
    renderAll();
  }

  // ---- Import / export ------------------------------------------------------

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportJson() {
    download("budget-data.json", JSON.stringify(state, null, 2), "application/json");
    toast("Exported JSON.");
  }

  function exportCsv() {
    const header = ["Date", "Type", "Description", "Category", "Amount"];
    const rows = state.transactions
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((t) => {
        const cat = categoryById(t.categoryId);
        return [
          t.date,
          t.type,
          `"${(t.description || "").replace(/"/g, '""')}"`,
          `"${cat ? cat.name : ""}"`,
          t.amount.toFixed(2),
        ].join(",");
      });
    download("budget-transactions.csv", [header.join(","), ...rows].join("\n"), "text/csv");
    toast("Exported CSV.");
  }

  function importJson(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.categories || !parsed.transactions) throw new Error("bad shape");
        state = {
          currency: parsed.currency || "USD",
          categories: parsed.categories,
          transactions: parsed.transactions,
          recurring: parsed.recurring || [],
        };
        saveState();
        $("#currency-select").value = state.currency;
        generateRecurringTransactions();
        renderAll();
        toast("Data imported.");
      } catch {
        toast("Could not import: invalid file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function seedSampleData() {
    if (!confirm("Load sample data? This replaces your current data.")) return;
    state = makeDefaultState();
    const today = new Date();
    const key = today.toISOString().slice(0, 7);
    const day = (d) => `${key}-${String(d).padStart(2, "0")}`;
    const byName = (n) => state.categories.find((c) => c.name === n).id;

    const samples = [
      ["income", 4200, "Monthly salary", "Salary", 1],
      ["expense", 1200, "Rent", "Housing", 1],
      ["expense", 86.4, "Weekly groceries", "Groceries", 3],
      ["expense", 52.1, "Restaurant dinner", "Dining Out", 5],
      ["expense", 45, "Gas", "Transport", 6],
      ["expense", 130, "Electric bill", "Utilities", 8],
      ["expense", 15.99, "Streaming subscription", "Entertainment", 9],
      ["expense", 92.3, "Groceries", "Groceries", 12],
      ["expense", 38, "Lunch with friends", "Dining Out", 14],
      ["expense", 60, "Pharmacy", "Health", 15],
      ["income", 350, "Freelance project", "Salary", 18],
      ["expense", 74.2, "Groceries", "Groceries", 20],
      ["expense", 28.5, "Movie night", "Entertainment", 22],
      ["investment", 500, "401(k) contribution", "Investments", 1],
      ["investment", 200, "Index fund", "Investments", 15],
    ];
    state.transactions = samples.map(([type, amount, description, cat, d]) => ({
      id: uid("tx"),
      type,
      amount,
      description,
      categoryId: byName(cat),
      date: day(d),
    }));
    saveState();
    renderAll();
    toast("Sample data loaded.");
  }

  // ---- Go -------------------------------------------------------------------

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
