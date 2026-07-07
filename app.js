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

  // Calendar UI state (not persisted)
  let calMode = "month"; // "month" | "week"
  let calWeekRef = new Date();
  calWeekRef.setHours(0, 0, 0, 0);
  let dayModalDate = null; // date the day-detail modal is currently showing

  function makeDefaultState() {
    return {
      currency: "USD",
      categories: DEFAULT_CATEGORIES.map((c, i) => ({ id: "cat-" + (i + 1), ...c })),
      transactions: [],
      recurring: [],
      updatedAt: new Date().toISOString(),
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
      // Treat existing local data as current so it isn't clobbered on first sync.
      parsed.updatedAt = parsed.updatedAt || new Date().toISOString();
      return parsed;
    } catch {
      return makeDefaultState();
    }
  }

  // When true, we're writing data pulled from Drive, so don't bump the
  // timestamp or push it straight back up.
  let applyingRemote = false;

  function saveState() {
    if (!applyingRemote) state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (!applyingRemote && typeof scheduleSync === "function") scheduleSync();
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
    renderTrends();
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

    const cardHtml = (r) => {
      const cat = categoryById(r.categoryId);
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
        <div class="spent"><span>${fmt(r.amount)}</span><span>${recurrenceLabel(r)}</span></div>
        <div class="meta">${
          cat ? escapeHtml(cat.name) : "Uncategorized"
        } · Next: ${formatDateFull(nextDue(r))}</div>
      </div>`;
    };

    const groups = [
      ["expense", "Expenses"],
      ["income", "Income"],
      ["investment", "Investments"],
    ];
    const monthlySum = (items) => items.reduce((s, r) => s + monthlyEquivalent(r), 0);

    list.innerHTML = groups
      .map(([type, label]) => {
        const items = rules.filter((r) => (r.type || "expense") === type);
        if (!items.length) return "";
        let body;
        if (type === "expense") {
          // Break expenses down by category, largest monthly cost first.
          const byCat = {};
          items.forEach((r) => (byCat[r.categoryId] = byCat[r.categoryId] || []).push(r));
          body = Object.entries(byCat)
            .map(([cid, catItems]) => ({
              cat: categoryById(cid),
              catItems,
              monthly: monthlySum(catItems),
            }))
            .sort((a, b) => b.monthly - a.monthly)
            .map(
              (g) =>
                `<div class="subgroup-heading"><span>${
                  g.cat
                    ? `<span class="cat-dot" style="background:${g.cat.color}"></span>${escapeHtml(
                        g.cat.name
                      )}`
                    : "Uncategorized"
                }</span><span>≈ ${fmt(g.monthly)}/mo</span></div>` +
                g.catItems.map(cardHtml).join("")
            )
            .join("");
        } else {
          body = items.map(cardHtml).join("");
        }
        return (
          `<div class="group-heading">${label}<span class="group-total">≈ ${fmt(
            monthlySum(items)
          )}/mo</span></div>` + body
        );
      })
      .join("");
  }

  // Rough per-month cost of a rule, for the group totals.
  function monthlyEquivalent(r) {
    const perDay = { days: 1, weeks: 7, months: 30.44 }[r.unit] * r.interval;
    return r.amount * (30.44 / perDay);
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

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Map of date -> entries within [start, end] (Date objects), merging real
  // transactions with projected future recurring occurrences (after today).
  function calendarItemsBetween(start, end) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startS = fmtDateObj(start);
    const endS = fmtDateObj(end);

    const byDate = {};
    const push = (ds, item) => (byDate[ds] = byDate[ds] || []).push(item);

    state.transactions.forEach((t) => {
      if (t.date >= startS && t.date <= endS) {
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
      occurrencesInRange(r, start, end).forEach((ds) => {
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

  function startOfWeek(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - x.getDay()); // back to Sunday
    return x;
  }

  // Totals across a byDate map (used for calendar period summaries).
  function summarize(byDate) {
    let income = 0,
      expense = 0,
      investment = 0;
    Object.values(byDate).forEach((list) =>
      list.forEach((it) => {
        if (it.type === "income") income += it.amount;
        else if (it.type === "investment") investment += it.amount;
        else expense += it.amount;
      })
    );
    return { income, expense, investment, net: income - expense - investment };
  }

  function calSummaryHtml(s) {
    return (
      `<span class="cs-item">Income <b class="amount-income">${fmt(s.income)}</b></span>` +
      `<span class="cs-item">Expenses <b class="amount-expense">${fmt(s.expense)}</b></span>` +
      (s.investment > 0
        ? `<span class="cs-item">Invested <b class="amount-investment">${fmt(s.investment)}</b></span>`
        : "") +
      `<span class="cs-item">Net <b class="${
        s.net >= 0 ? "amount-income" : "amount-expense"
      }">${fmt(s.net)}</b></span>`
    );
  }

  function renderCalendar() {
    if (calMode === "week") renderWeek();
    else renderMonth();
    $("#calendar-grid").hidden = calMode !== "month";
    $("#calendar-week").hidden = calMode !== "week";
    $$("[data-cal-mode]").forEach((b) =>
      b.classList.toggle("active", b.dataset.calMode === calMode)
    );
  }

  function renderMonth() {
    const key = currentMonth();
    $("#calendar-label").textContent = monthLabel(key);
    const [y, m] = key.split("-").map(Number);
    const byDate = calendarItemsBetween(new Date(y, m - 1, 1), new Date(y, m, 0));
    $("#calendar-summary").innerHTML = calSummaryHtml(summarize(byDate));
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
      }" data-cal-date="${ds}">
        <div class="cal-day">${day}</div>
        <div class="cal-chips">${chips}${more}</div>
      </div>`);
    }
    while (cells.length % 7 !== 0) cells.push(`<div class="cal-cell empty"></div>`);

    const weekdays = WEEKDAYS.map((d) => `<div class="cal-weekday">${d}</div>`).join("");
    $("#calendar-grid").innerHTML = weekdays + cells.join("");
  }

  function renderWeek() {
    const start = startOfWeek(calWeekRef);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    const end = days[6];
    $("#calendar-label").textContent = `${formatDateFull(start)} – ${formatDateFull(end)}`;

    const byDate = calendarItemsBetween(start, end);
    $("#calendar-summary").innerHTML = calSummaryHtml(summarize(byDate));
    const today = todayStr();

    $("#calendar-week").innerHTML = days
      .map((d) => {
        const ds = fmtDateObj(d);
        const items = byDate[ds] || [];
        const head = `${WEEKDAYS[d.getDay()]} ${d.getDate()}`;
        const entries = items.length
          ? items
              .map((it) => {
                const cls =
                  it.type === "income"
                    ? "income"
                    : it.type === "investment"
                    ? "investment"
                    : "expense";
                const sign = it.type === "income" ? "+" : "-";
                const cat = categoryById(it.categoryId);
                return `<div class="week-entry ${cls}${it.projected ? " projected" : ""}">
                  <span class="cat-dot" style="background:${cat ? cat.color : "#94a3b8"}"></span>
                  <span class="we-desc">${it.recurring ? "🔁 " : ""}${escapeHtml(
                  it.description
                )}</span>
                  <span class="we-amt">${sign}${fmtShort(it.amount)}</span>
                </div>`;
              })
              .join("")
          : `<div class="week-empty">—</div>`;
        return `<div class="week-day${ds === today ? " today" : ""}" data-cal-date="${ds}">
          <div class="week-day-head">${head}</div>
          <div class="week-entries">${entries}</div>
        </div>`;
      })
      .join("");
  }

  function openDayModal(ds) {
    dayModalDate = ds;
    const dayObj = parseDate(ds);
    const items = calendarItemsBetween(dayObj, dayObj)[ds] || [];
    $("#day-modal-title").textContent = formatDateFull(dayObj);

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

  // ---- Trends ---------------------------------------------------------------

  function continuousMonths(startK, endK) {
    const out = [];
    let [y, m] = startK.split("-").map(Number);
    const [ey, em] = endK.split("-").map(Number);
    while (y < ey || (y === ey && m <= em)) {
      out.push(`${y}-${String(m).padStart(2, "0")}`);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
      if (out.length > 600) break;
    }
    return out;
  }

  function shortMonthLabel(key) {
    const [y, m] = key.split("-").map(Number);
    const mon = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
    return m === 1 ? `${mon} '${String(y).slice(2)}` : mon;
  }

  function renderTrends() {
    const range = parseInt($("#trend-range").value, 10);
    const buckets = {};
    state.transactions.forEach((t) => {
      const k = monthKey(t.date);
      const b = buckets[k] || (buckets[k] = { income: 0, expense: 0, investment: 0 });
      if (t.type === "income") b.income += t.amount;
      else if (t.type === "investment") b.investment += t.amount;
      else b.expense += t.amount;
    });

    const present = Object.keys(buckets).sort();
    const chart = $("#trend-chart");
    const summary = $("#trend-summary");
    if (!present.length) {
      chart.innerHTML = `<div class="empty-state">No data yet. Add transactions to see trends.</div>`;
      summary.innerHTML = "";
      return;
    }

    let months = continuousMonths(present[0], present[present.length - 1]);
    if (range > 0 && months.length > range) months = months.slice(-range);

    const data = months.map((k) => {
      const b = buckets[k] || { income: 0, expense: 0, investment: 0 };
      return { k, ...b, net: b.income - b.expense - b.investment };
    });

    // Period totals
    const tot = data.reduce(
      (a, d) => ({
        income: a.income + d.income,
        expense: a.expense + d.expense,
        investment: a.investment + d.investment,
      }),
      { income: 0, expense: 0, investment: 0 }
    );
    const net = tot.income - tot.expense - tot.investment;
    const avgSavings = tot.income > 0 ? Math.round(((tot.income - tot.expense) / tot.income) * 100) : 0;
    summary.innerHTML = `
      <div class="card stat"><div class="stat-label">Total Income</div><div class="stat-value income">${fmt(tot.income)}</div></div>
      <div class="card stat"><div class="stat-label">Total Expenses</div><div class="stat-value expense">${fmt(tot.expense)}</div></div>
      <div class="card stat"><div class="stat-label">Total Invested</div><div class="stat-value investment">${fmt(tot.investment)}</div></div>
      <div class="card stat"><div class="stat-label">Net</div><div class="stat-value ${net >= 0 ? "income" : "expense"}">${fmt(net)}</div></div>
      <div class="card stat"><div class="stat-label">Avg Savings Rate</div><div class="stat-value">${avgSavings}%</div></div>`;

    chart.innerHTML = buildTrendSvg(data);
  }

  function buildTrendSvg(data) {
    const n = data.length;
    const groupW = 72;
    const w = Math.max(n * groupW + 50, 560);
    const h = 300;
    const padL = 52,
      padR = 14,
      padT = 16,
      padB = 52;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const maxVal = Math.max(1, ...data.flatMap((d) => [d.income, d.expense, d.investment, d.net]));
    const minVal = Math.min(0, ...data.map((d) => d.net));
    const span = maxVal - minVal || 1;
    const yToPx = (v) => padT + plotH * (1 - (v - minVal) / span);
    const zeroY = yToPx(0);
    const groupInner = plotW / n;
    const bw = Math.min(13, groupInner / 4.5);

    // gridlines / axis labels at 0, max, and (if present) min
    const ticks = [0, maxVal];
    if (minVal < 0) ticks.push(minVal);
    const gridlines = ticks
      .map((v) => {
        const y = yToPx(v);
        const cls = v === 0 ? "trend-zero" : "trend-grid";
        return `<line class="${cls}" x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" />
          <text class="trend-axis-label" x="${padL - 6}" y="${y + 3}" text-anchor="end">${fmtShort(
          v
        )}</text>`;
      })
      .join("");

    let bars = "";
    let netPts = [];
    data.forEach((d, i) => {
      const center = padL + groupInner * (i + 0.5);
      const x0 = center - 1.5 * bw;
      const series = [
        ["income", d.income],
        ["expense", d.expense],
        ["investment", d.investment],
      ];
      series.forEach(([cls, val], j) => {
        if (val <= 0) return;
        const top = yToPx(val);
        const x = x0 + j * bw;
        bars += `<rect class="trend-bar ${cls}" x="${x}" y="${top}" width="${
          bw - 1.5
        }" height="${Math.max(0, zeroY - top)}" rx="1.5"><title>${shortMonthLabel(d.k)} ${cls}: ${fmt(
          val
        )}</title></rect>`;
      });
      netPts.push([center, yToPx(d.net)]);
      bars += `<text class="trend-month-label" x="${center}" y="${h - padB + 18}" text-anchor="middle">${shortMonthLabel(
        d.k
      )}</text>`;
    });

    const netLine =
      netPts.length > 1
        ? `<polyline class="trend-net-line" points="${netPts.map((p) => p.join(",")).join(" ")}" />`
        : "";
    const netDots = netPts
      .map(
        ([x, y], i) =>
          `<circle class="trend-net-dot" cx="${x}" cy="${y}" r="3"><title>${shortMonthLabel(
            data[i].k
          )} net: ${fmt(data[i].net)}</title></circle>`
      )
      .join("");

    return `<svg class="trend-chart-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Monthly trends chart">
      ${gridlines}${bars}${netLine}${netDots}
    </svg>`;
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
      <td class="td-date">${formatDate(t.date)}</td>
      <td class="td-desc">${escapeHtml(t.description)}${
        t.recurringId ? `<span class="recur-badge" title="From a recurring item">🔁</span>` : ""
      }</td>
      <td class="td-cat">${cat ? `<span class="cat-pill"><span class="cat-dot" style="background:${cat.color}"></span>${escapeHtml(cat.name)}</span>` : "—"}</td>
      <td class="num td-amt ${amtCls}">${sign}${fmt(t.amount)}</td>
      ${
        withActions
          ? `<td class="td-act"><div class="row-actions">
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
    txCat.innerHTML =
      relevant.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("") +
      `<option value="__new__">＋ New category…</option>`;
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
      recCat.innerHTML =
        recRelevant.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("") +
        `<option value="__new__">＋ New category…</option>`;
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

  function openTxModal(tx, presetDate) {
    $("#tx-modal-title").textContent = tx ? "Edit Transaction" : "Add Transaction";
    $("#tx-id").value = tx ? tx.id : "";
    const type = tx ? tx.type : "expense";
    $(`input[name='tx-type'][value='${type}']`).checked = true;
    $("#tx-amount").value = tx ? tx.amount : "";
    $("#tx-description").value = tx ? tx.description : "";
    $("#tx-date").value = tx ? tx.date : presetDate || new Date().toISOString().slice(0, 10);
    populateCategorySelects();
    if (tx) $("#tx-category").value = tx.categoryId;
    openModal("tx-modal");
    $("#tx-amount").focus();
  }

  // Which category select (if any) asked to create a new category inline,
  // so we can auto-select the result: "tx" | "rec" | null.
  let newCatTarget = null;

  function openCatModal(cat, presetType) {
    newCatTarget = null;
    $("#cat-modal-title").textContent = cat ? "Edit Category" : "Add Category";
    $("#cat-id").value = cat ? cat.id : "";
    const type = cat ? catType(cat) : presetType || "expense";
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

    // mobile drawer toggle
    const sidebar = $(".sidebar");
    const menuToggle = $("#menu-toggle");
    const setMenu = (open) => {
      sidebar.classList.toggle("open", open);
      menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
    };
    menuToggle.addEventListener("click", () => setMenu(!sidebar.classList.contains("open")));

    // nav
    $$(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".nav-item").forEach((b) => b.classList.remove("active"));
        $$(".view").forEach((v) => v.classList.remove("active"));
        btn.classList.add("active");
        $("#view-" + btn.dataset.view).classList.add("active");
        setMenu(false); // collapse the drawer after choosing a tab on mobile
        window.scrollTo(0, 0);
      });
    });

    $("#month-filter").addEventListener("change", renderAll);

    // calendar navigation (month or week depending on mode)
    const shiftMonth = (delta) => {
      const [y, m] = currentMonth().split("-").map(Number);
      const d = new Date(y, m - 1 + delta, 1);
      $("#month-filter").value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      renderAll();
    };
    const shiftWeek = (delta) => {
      calWeekRef.setDate(calWeekRef.getDate() + delta * 7);
      renderCalendar();
    };
    $("#cal-prev").addEventListener("click", () => (calMode === "week" ? shiftWeek(-1) : shiftMonth(-1)));
    $("#cal-next").addEventListener("click", () => (calMode === "week" ? shiftWeek(1) : shiftMonth(1)));
    $("#cal-today").addEventListener("click", () => {
      if (calMode === "week") {
        calWeekRef = new Date();
        calWeekRef.setHours(0, 0, 0, 0);
        renderCalendar();
      } else {
        $("#month-filter").value = new Date().toISOString().slice(0, 7);
        renderAll();
      }
    });
    $$("[data-cal-mode]").forEach((b) =>
      b.addEventListener("click", () => {
        calMode = b.dataset.calMode;
        renderCalendar();
      })
    );
    $("#trend-range").addEventListener("change", renderTrends);
    $("#day-add-btn").addEventListener("click", () => {
      const date = dayModalDate;
      closeModal("day-modal");
      openTxModal(null, date);
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

    // Close only the button's own modal, so e.g. cancelling the inline
    // "new category" dialog doesn't also close the transaction form under it.
    $$("[data-close-modal]").forEach((b) =>
      b.addEventListener("click", () => {
        const bd = b.closest(".modal-backdrop");
        if (bd) bd.hidden = true;
      })
    );
    $$(".modal-backdrop").forEach((bd) =>
      bd.addEventListener("click", (e) => {
        if (e.target === bd) bd.hidden = true;
      })
    );
    // Escape closes just the topmost open modal (last in DOM paints on top).
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const open = $$(".modal-backdrop").filter((m) => !m.hidden);
        if (open.length) open[open.length - 1].hidden = true;
      }
    });

    // "+ New category…" inside the category dropdowns opens the category
    // creator preset to the matching type, then auto-selects the result.
    const wireInlineNewCategory = (selectSel, target, typeGetter) => {
      $(selectSel).addEventListener("change", (e) => {
        if (e.target.value !== "__new__") return;
        e.target.selectedIndex = 0;
        openCatModal(null, typeGetter());
        newCatTarget = target;
      });
    };
    wireInlineNewCategory(
      "#tx-category",
      "tx",
      () => ($("input[name='tx-type']:checked") || {}).value || "expense"
    );
    wireInlineNewCategory(
      "#rec-category",
      "rec",
      () => ($("input[name='rec-type']:checked") || {}).value || "expense"
    );

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
      if (!data.categoryId || data.categoryId === "__new__")
        return toast("Pick a category (or create one with ＋ New category).");
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
      let newId = null;
      if (id) {
        Object.assign(categoryById(id), data);
        toast("Category updated.");
      } else {
        newId = uid("cat");
        state.categories.push({ id: newId, ...data });
        toast("Category added.");
      }
      saveState();
      closeModal("cat-modal");
      renderAll();
      // If this came from "+ New category…" in a form, select it there.
      if (newId && newCatTarget) {
        const sel = $(newCatTarget === "rec" ? "#rec-category" : "#tx-category");
        if ([...sel.options].some((o) => o.value === newId)) sel.value = newId;
      }
      newCatTarget = null;
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
      if (!data.categoryId || data.categoryId === "__new__")
        return toast("Pick a category (or create one with ＋ New category).");
      if (!data.startDate) return toast("Pick a start date.");
      if (id) {
        const rule = state.recurring.find((x) => x.id === id);
        const detailsChanged =
          rule.amount !== data.amount ||
          rule.description !== data.description ||
          rule.categoryId !== data.categoryId ||
          rule.type !== data.type;
        Object.assign(rule, data);
        // Already-created transactions keep their old values unless the user
        // opts in — e.g. fixing a wrong rent amount should fix past months too.
        const existing = state.transactions.filter((t) => t.recurringId === id);
        if (detailsChanged && existing.length) {
          const applyPast = confirm(
            `Also update the ${existing.length} transaction${
              existing.length === 1 ? "" : "s"
            } already created by this item (e.g. on the calendar)?\n\nOK = update them to the new details\nCancel = keep them as they are (changes apply to future ones only)`
          );
          if (applyPast) {
            existing.forEach((t) => {
              t.amount = data.amount;
              t.description = data.description;
              t.categoryId = data.categoryId;
              t.type = data.type;
            });
          }
        }
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

    // settings: automatic Google Drive sync
    $("#gdrive-save-cid").addEventListener("click", () => {
      const val = $("#gdrive-cid").value.trim();
      localStorage.setItem(GDRIVE_CID_KEY, val);
      gdriveTokenClient = null; // re-init with the new client id
      renderGdriveStatus();
      toast(val ? "Client ID saved. Now tap Connect." : "Client ID cleared.");
    });
    $("#gdrive-connect").addEventListener("click", gdriveConnect);
    $("#gdrive-sync-now").addEventListener("click", () => syncNow(true));
    $("#gdrive-disconnect").addEventListener("click", gdriveDisconnect);

    // settings: manual backup
    $("#backup-btn").addEventListener("click", backupData);
    $("#export-csv-btn").addEventListener("click", exportCsv);
    $("#import-btn").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", importJson);
    renderSyncStatus();
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
    gdriveInit();
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

  const BACKUP_FILENAME = "budget-backup.json";
  const BACKUP_AT_KEY = "budget-backup-at";
  const RESTORE_AT_KEY = "budget-restore-at";

  // Back up via the native share sheet when available (iOS/Android: lets you
  // pick "Save to Files → Google Drive/iCloud" or AirDrop), else download.
  async function backupData() {
    const json = JSON.stringify(state, null, 2);
    if (navigator.canShare) {
      try {
        const file = new File([json], BACKUP_FILENAME, { type: "application/json" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: "Budget backup" });
          markBackup();
          return;
        }
      } catch (err) {
        if (err && err.name === "AbortError") return; // user cancelled the share sheet
        // otherwise fall through to a normal download
      }
    }
    download(BACKUP_FILENAME, json, "application/json");
    markBackup();
  }

  function markBackup() {
    localStorage.setItem(BACKUP_AT_KEY, new Date().toISOString());
    renderSyncStatus();
    toast("Backed up. Save it to Google Drive to sync.");
  }
  function markRestore() {
    localStorage.setItem(RESTORE_AT_KEY, new Date().toISOString());
    renderSyncStatus();
  }

  function relativeTime(iso) {
    if (!iso) return "never";
    const then = new Date(iso);
    const mins = Math.round((Date.now() - then.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    const days = Math.round(hrs / 24);
    if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;
    return then.toLocaleDateString();
  }

  function renderSyncStatus() {
    const b = $("#last-backup");
    const r = $("#last-restore");
    if (b) b.textContent = relativeTime(localStorage.getItem(BACKUP_AT_KEY));
    if (r) r.textContent = relativeTime(localStorage.getItem(RESTORE_AT_KEY));
  }

  // ---- Google Drive auto-sync ----------------------------------------------
  // Fully client-side: Google Identity Services for sign-in + the Drive REST
  // API with the drive.file scope (this app can only see the one file it
  // creates). Data lives in the user's own Drive; nothing touches our servers.

  const GDRIVE_CID_KEY = "budget-gdrive-client-id";
  const GDRIVE_CONNECTED_KEY = "budget-gdrive-connected";
  const GDRIVE_SYNCED_AT_KEY = "budget-gdrive-synced-at";
  const GDRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
  const GDRIVE_FILENAME = "budget-sync.json";

  let gdriveTokenClient = null;
  let gdriveToken = null; // { access_token, expiresAt }
  let gdriveFileId = null;
  let gdriveSyncing = false;
  let syncTimer = null;
  let pendingTokenResolve = null;
  let pendingTokenReject = null;

  const gdriveClientId = () => (localStorage.getItem(GDRIVE_CID_KEY) || "").trim();
  const gdriveConnected = () => localStorage.getItem(GDRIVE_CONNECTED_KEY) === "1";

  function gdriveReady() {
    return typeof google !== "undefined" && google.accounts && google.accounts.oauth2;
  }

  function initTokenClient() {
    if (gdriveTokenClient) return gdriveTokenClient;
    if (!gdriveReady() || !gdriveClientId()) return null;
    gdriveTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: gdriveClientId(),
      scope: GDRIVE_SCOPE,
      callback: (resp) => {
        if (resp && resp.access_token) {
          gdriveToken = {
            access_token: resp.access_token,
            expiresAt: Date.now() + (resp.expires_in ? resp.expires_in * 1000 : 3600000) - 60000,
          };
          if (pendingTokenResolve) pendingTokenResolve(gdriveToken.access_token);
        } else if (pendingTokenReject) {
          pendingTokenReject(new Error("No access token"));
        }
        pendingTokenResolve = pendingTokenReject = null;
      },
      error_callback: (err) => {
        if (pendingTokenReject) pendingTokenReject(err);
        pendingTokenResolve = pendingTokenReject = null;
      },
    });
    return gdriveTokenClient;
  }

  function getAccessToken(interactive) {
    return new Promise((resolve, reject) => {
      if (gdriveToken && gdriveToken.expiresAt > Date.now()) return resolve(gdriveToken.access_token);
      const client = initTokenClient();
      if (!client) return reject(new Error("Google sign-in not ready"));
      pendingTokenResolve = resolve;
      pendingTokenReject = reject;
      try {
        client.requestAccessToken({ prompt: interactive ? "" : "none" });
      } catch (e) {
        pendingTokenResolve = pendingTokenReject = null;
        reject(e);
      }
    });
  }

  async function driveFindFile(token) {
    const q = encodeURIComponent(`name='${GDRIVE_FILENAME}' and trashed=false`);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id)`,
      { headers: { Authorization: "Bearer " + token } }
    );
    if (!res.ok) throw new Error("Drive list " + res.status);
    const data = await res.json();
    return data.files && data.files[0] ? data.files[0].id : null;
  }

  async function driveDownload(token, id) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) throw new Error("Drive download " + res.status);
    return res.json();
  }

  async function driveUpload(token, id, contentObj) {
    const body = JSON.stringify(contentObj);
    if (id) {
      const res = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,
        { method: "PATCH", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body }
      );
      if (!res.ok) throw new Error("Drive update " + res.status);
      return id;
    }
    const boundary = "budgetsync" + Date.now();
    const metadata = { name: GDRIVE_FILENAME, mimeType: "application/json" };
    const multipart =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`,
      {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipart,
      }
    );
    if (!res.ok) throw new Error("Drive create " + res.status);
    return (await res.json()).id;
  }

  function chooseNewer(localState, remoteState) {
    const lTx = (localState.transactions || []).length;
    const rTx = (remoteState.transactions || []).length;
    // A fresh/empty device must adopt populated data rather than overwrite it,
    // regardless of timestamps (protects against wiping data on first connect).
    if (lTx === 0 && rTx > 0) return "remote";
    if (rTx === 0 && lTx > 0) return "local";
    const lt = Date.parse(localState.updatedAt || 0) || 0;
    const rt = Date.parse(remoteState.updatedAt || 0) || 0;
    if (rt > lt) return "remote";
    if (lt > rt) return "local";
    return rTx > lTx ? "remote" : "local";
  }

  function applyRemoteState(remote) {
    applyingRemote = true;
    state = {
      currency: remote.currency || "USD",
      categories: remote.categories || [],
      transactions: remote.transactions || [],
      recurring: remote.recurring || [],
      updatedAt: remote.updatedAt || new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    applyingRemote = false;
    $("#currency-select").value = state.currency;
    generateRecurringTransactions();
    renderAll();
  }

  // Pull remote, reconcile by newest, push if local wins. interactive=true may
  // show the Google sign-in popup; false stays silent (for background syncs).
  async function syncNow(interactive) {
    if (!gdriveClientId() || gdriveSyncing) return;
    gdriveSyncing = true;
    setGdriveStatus("Syncing…");
    try {
      const token = await getAccessToken(interactive);
      if (!gdriveFileId) gdriveFileId = await driveFindFile(token);
      let remote = null;
      if (gdriveFileId) {
        try {
          remote = await driveDownload(token, gdriveFileId);
        } catch {}
      }
      if (remote && remote.categories && remote.transactions) {
        if (chooseNewer(state, remote) === "remote") applyRemoteState(remote);
        else gdriveFileId = await driveUpload(token, gdriveFileId, state);
      } else {
        gdriveFileId = await driveUpload(token, gdriveFileId, state);
      }
      localStorage.setItem(GDRIVE_CONNECTED_KEY, "1");
      localStorage.setItem(GDRIVE_SYNCED_AT_KEY, new Date().toISOString());
      setGdriveStatus("Connected");
    } catch (e) {
      setGdriveStatus(gdriveConnected() ? "Reconnect needed" : "Not connected");
      if (interactive) toast("Google Drive: " + (e.message || "sign-in failed"));
    } finally {
      gdriveSyncing = false;
      renderGdriveStatus();
    }
  }

  // Debounced background upload after local edits.
  function scheduleSync() {
    if (!gdriveConnected() || !gdriveClientId()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushLocalQuietly, 2000);
  }

  async function pushLocalQuietly() {
    if (!gdriveConnected() || gdriveSyncing) return;
    try {
      const token = await getAccessToken(false);
      if (!gdriveFileId) gdriveFileId = await driveFindFile(token);
      gdriveFileId = await driveUpload(token, gdriveFileId, state);
      localStorage.setItem(GDRIVE_SYNCED_AT_KEY, new Date().toISOString());
      setGdriveStatus("Connected");
    } catch {
      setGdriveStatus("Reconnect needed");
    }
    renderGdriveStatus();
  }

  function gdriveConnect() {
    if (!gdriveClientId()) return toast("Paste your Google Client ID and tap Save ID first.");
    if (!gdriveReady()) return toast("Google sign-in is still loading — try again in a moment.");
    syncNow(true);
  }

  function gdriveDisconnect() {
    const tok = gdriveToken && gdriveToken.access_token;
    if (tok && gdriveReady() && google.accounts.oauth2.revoke) {
      try {
        google.accounts.oauth2.revoke(tok);
      } catch {}
    }
    gdriveToken = null;
    gdriveFileId = null;
    localStorage.removeItem(GDRIVE_CONNECTED_KEY);
    setGdriveStatus("Not connected");
    renderGdriveStatus();
    toast("Disconnected from Google Drive.");
  }

  function setGdriveStatus(text) {
    const el = $("#gdrive-status");
    if (el) el.textContent = text;
  }

  function renderGdriveStatus() {
    const connected = gdriveConnected();
    const cid = gdriveClientId();
    const cidInput = $("#gdrive-cid");
    if (cidInput && document.activeElement !== cidInput) cidInput.value = cid;
    $("#gdrive-connect").hidden = connected;
    $("#gdrive-sync-now").hidden = !connected;
    $("#gdrive-disconnect").hidden = !connected;
    const syncedWrap = $("#gdrive-synced-wrap");
    if (syncedWrap) {
      syncedWrap.hidden = !connected;
      $("#gdrive-synced").textContent = relativeTime(localStorage.getItem(GDRIVE_SYNCED_AT_KEY));
    }
  }

  function waitForGoogle(cb, tries) {
    tries = tries || 0;
    if (gdriveReady()) return cb();
    if (tries > 40) return; // ~10s
    setTimeout(() => waitForGoogle(cb, tries + 1), 250);
  }

  function gdriveInit() {
    renderGdriveStatus();
    if (gdriveConnected() && gdriveClientId()) {
      setGdriveStatus("Connecting…");
      waitForGoogle(() => syncNow(false));
    }
    // Pull latest when returning to the app (e.g. after editing another device)
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && gdriveConnected()) syncNow(false);
    });
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
        const txN = parsed.transactions.length;
        const catN = parsed.categories.length;
        if (
          !confirm(
            `Restore this backup?\n\nIt contains ${txN} transaction${txN === 1 ? "" : "s"} and ${catN} categor${
              catN === 1 ? "y" : "ies"
            }, and will replace everything currently on this device.`
          )
        ) {
          e.target.value = "";
          return;
        }
        state = {
          currency: parsed.currency || "USD",
          categories: parsed.categories,
          transactions: parsed.transactions,
          recurring: parsed.recurring || [],
        };
        saveState();
        markRestore();
        $("#currency-select").value = state.currency;
        generateRecurringTransactions();
        renderAll();
        toast("Restored from backup.");
      } catch {
        toast("Could not restore: not a valid backup file.");
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
