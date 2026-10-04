// Finance rollup: monthly P&L, cost breakdown, payroll ledger, and cash outlook.
// Reads invoices, expenses, subscriptions, retainers and team_payments (see docs/money-schema.md).
//
// Basis, shown in the UI too:
//  - Income is cash: invoices marked paid, in the month they were paid (falls back to issue date).
//  - Team costs are by the month they are for (period_month), whether or not paid yet.
//  - Expenses are by expense date.
//  - Subscriptions are the current monthly run-rate (monthly / quarterly÷3 / yearly÷12), applied to every month shown.
const { isDbConfigured, getSql } = require('./db');
const { getTeamPayments } = require('./money-team');

const NOT_CONFIGURED_REASON =
  'POSTGRES_URL is not set yet. Create a Postgres database in the project’s Vercel Storage tab and connect it to ribahaus-os.';

function ymd(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function monthKey(dateStr) { return dateStr ? dateStr.slice(0, 7) : null; }

function utcDate(dateStr) { return new Date(dateStr + 'T00:00:00Z'); }

function addDays(dateStr, n) {
  const d = utcDate(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(dateStr, n) {
  const d = utcDate(dateStr);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

function monthsList(todayStr, count) {
  const first = todayStr.slice(0, 7) + '-01';
  const list = [];
  for (let i = count - 1; i >= 0; i--) list.push(addMonths(first, -i).slice(0, 7));
  return list;
}

function cycleMonths(cycle) { return cycle === 'yearly' ? 12 : cycle === 'quarterly' ? 3 : 1; }

function monthlyEquivalent(sub) {
  return Number(sub.amount) / cycleMonths(sub.billing_cycle);
}

function round2(n) { return Math.round(n * 100) / 100; }

async function getFinance(monthsParam) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();

  let count = parseInt(monthsParam, 10);
  if (!isFinite(count) || count < 1) count = 6;
  if (count > 24) count = 24;

  const today = new Date().toISOString().slice(0, 10);
  const months = monthsList(today, count);
  const startDate = months[0] + '-01';

  const paidInvoices = await sql`
    SELECT amount, COALESCE(paid_date, issue_date) AS income_date
    FROM invoices
    WHERE status = 'paid' AND COALESCE(paid_date, issue_date) >= ${startDate}::date
  `;
  const unpaidInvoices = await sql`
    SELECT invoice_number, client_name, amount, COALESCE(due_date, issue_date) AS due
    FROM invoices
    WHERE status IN ('sent', 'overdue')
  `;
  const expenseRows = await sql`
    SELECT category, amount, expense_date FROM expenses WHERE expense_date >= ${startDate}::date
  `;
  const subs = await sql`SELECT name, amount, billing_cycle, next_renewal_date FROM subscriptions WHERE status = 'active'`;
  const retainers = await sql`SELECT monthly_fee FROM retainers WHERE status = 'active'`;
  const teamResult = await getTeamPayments(startDate);
  const team = teamResult.payments;
  // Pending payments of any month still count toward the outlook, even before the window.
  const pendingAll = await sql`SELECT payee_name, payee_type, amount, period_month, pay_date FROM team_payments WHERE status = 'pending'`;

  const subscriptionMonthly = subs.reduce(function (sum, s) { return sum + monthlyEquivalent(s); }, 0);

  // ---- Monthly P&L ----
  const byMonth = {};
  months.forEach(function (m) {
    byMonth[m] = { month: m, income: 0, salaries: 0, freelancers: 0, bonuses: 0, expenses: 0, subscriptions: round2(subscriptionMonthly) };
  });
  paidInvoices.forEach(function (r) {
    const k = monthKey(ymd(r.income_date));
    if (byMonth[k]) byMonth[k].income += Number(r.amount);
  });
  team.forEach(function (p) {
    const k = monthKey(p.periodMonth);
    if (!byMonth[k]) return;
    if (p.payeeType === 'salary') byMonth[k].salaries += p.amount;
    else if (p.payeeType === 'freelancer') byMonth[k].freelancers += p.amount;
    else byMonth[k].bonuses += p.amount;
  });
  const expenseByCategory = {};
  expenseRows.forEach(function (r) {
    const k = monthKey(ymd(r.expense_date));
    if (!byMonth[k]) return;
    byMonth[k].expenses += Number(r.amount);
    expenseByCategory[r.category] = (expenseByCategory[r.category] || 0) + Number(r.amount);
  });

  const pnl = months.map(function (m) {
    const row = byMonth[m];
    row.totalCosts = round2(row.salaries + row.freelancers + row.bonuses + row.expenses + row.subscriptions);
    row.income = round2(row.income);
    row.net = round2(row.income - row.totalCosts);
    return row;
  });
  const totals = pnl.reduce(function (t, r) {
    ['income', 'salaries', 'freelancers', 'bonuses', 'expenses', 'subscriptions', 'totalCosts', 'net'].forEach(function (k) { t[k] += r[k]; });
    return t;
  }, { income: 0, salaries: 0, freelancers: 0, bonuses: 0, expenses: 0, subscriptions: 0, totalCosts: 0, net: 0 });
  Object.keys(totals).forEach(function (k) { totals[k] = round2(totals[k]); });
  totals.margin = totals.income > 0 ? Math.round((totals.net / totals.income) * 1000) / 10 : null;
  totals.avgMonthlyCosts = round2(totals.totalCosts / months.length);

  // ---- Cost breakdown (whole window) ----
  const costLines = [
    { label: 'Salaries', amount: totals.salaries },
    { label: 'Freelancers', amount: totals.freelancers },
    { label: 'Bonuses', amount: totals.bonuses },
    { label: 'Subscriptions', amount: totals.subscriptions }
  ];
  Object.keys(expenseByCategory).forEach(function (c) { costLines.push({ label: c, amount: round2(expenseByCategory[c]) }); });
  const costTotal = costLines.reduce(function (s, l) { return s + l.amount; }, 0);
  const categories = costLines
    .filter(function (l) { return l.amount > 0; })
    .map(function (l) { return { label: l.label, amount: round2(l.amount), share: costTotal > 0 ? Math.round((l.amount / costTotal) * 1000) / 10 : 0 }; })
    .sort(function (a, b) { return b.amount - a.amount; });

  // ---- Cash outlook (next 30 / 60 / 90 days) ----
  const horizon = addDays(today, 90);
  const upcoming = [];
  unpaidInvoices.forEach(function (r) {
    upcoming.push({ type: 'invoice', direction: 'in', label: r.invoice_number + ' · ' + r.client_name, date: ymd(r.due), amount: Number(r.amount) });
  });
  pendingAll.forEach(function (p) {
    const due = ymd(p.pay_date) || ymd(p.period_month);
    upcoming.push({ type: 'team', direction: 'out', label: p.payee_name + ' (' + p.payee_type + ')', date: due, amount: Number(p.amount) });
  });
  subs.forEach(function (s) {
    if (!s.next_renewal_date) return;
    let d = ymd(s.next_renewal_date);
    const step = cycleMonths(s.billing_cycle);
    let guard = 0;
    while (d < today && guard++ < 600) d = addMonths(d, step);
    guard = 0;
    while (d <= horizon && guard++ < 600) {
      upcoming.push({ type: 'subscription', direction: 'out', label: s.name + ' renewal', date: d, amount: Number(s.amount) });
      d = addMonths(d, step);
    }
  });
  function windowTotals(days) {
    const end = addDays(today, days);
    let receivable = 0;
    let payable = 0;
    upcoming.forEach(function (u) {
      if (u.date > end) return;
      if (u.direction === 'in') receivable += u.amount; else payable += u.amount;
    });
    return { days: days, receivable: round2(receivable), payable: round2(payable), net: round2(receivable - payable) };
  }
  const outlook = {
    windows: [windowTotals(30), windowTotals(60), windowTotals(90)],
    retainerMonthly: round2(retainers.reduce(function (s, r) { return s + Number(r.monthly_fee); }, 0)),
    upcoming: upcoming
      .filter(function (u) { return u.date <= horizon; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
      .slice(0, 40)
      .map(function (u) { u.overdue = u.date < today; return u; })
  };

  // ---- Ledger ----
  const pendingTotal = team.filter(function (p) { return p.status === 'pending'; }).reduce(function (s, p) { return s + p.amount; }, 0);
  const ledger = {
    payments: team,
    pendingCount: team.filter(function (p) { return p.status === 'pending'; }).length,
    pendingTotal: round2(pendingTotal)
  };

  return {
    connected: true,
    window: { months: months, today: today },
    pnl: pnl,
    totals: totals,
    categories: categories,
    outlook: outlook,
    ledger: ledger,
    subscriptionMonthly: round2(subscriptionMonthly)
  };
}

module.exports = { getFinance };
