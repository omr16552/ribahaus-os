// Team payments (salaries, freelancers, bonuses), backed by Postgres (see docs/money-schema.md).
// One row per payment per month. file_url holds a Dropbox shared link (payslip or freelancer invoice).
const { isDbConfigured, getSql } = require('./db');

const NOT_CONFIGURED_REASON =
  'POSTGRES_URL is not set yet. Create a Postgres database in the project’s Vercel Storage tab and connect it to ribahaus-os.';

const PAYEE_TYPES = ['salary', 'freelancer', 'bonus'];
const STATUSES = ['pending', 'paid'];

function ymd(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

// Accepts 'YYYY-MM' or 'YYYY-MM-DD'; returns the first day of that month or null if invalid.
function normalizeMonth(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(0[1-9]|1[0-2])(-\d{2})?$/.exec(value.trim());
  return m ? m[1] + '-' + m[2] + '-01' : null;
}

function mapRow(row) {
  return {
    id: row.id,
    payeeName: row.payee_name,
    payeeType: row.payee_type,
    role: row.role,
    amount: Number(row.amount),
    currency: row.currency,
    periodMonth: ymd(row.period_month),
    payDate: ymd(row.pay_date),
    status: row.status,
    fileUrl: row.file_url,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getTeamPayments(sinceDate) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const rows = sinceDate
    ? await sql`SELECT * FROM team_payments WHERE period_month >= ${sinceDate}::date ORDER BY period_month DESC, payee_type ASC, payee_name ASC`
    : await sql`SELECT * FROM team_payments ORDER BY period_month DESC, payee_type ASC, payee_name ASC`;
  return { connected: true, payments: rows.map(mapRow) };
}

async function createTeamPayment(input) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const periodMonth = normalizeMonth(input.periodMonth);
  if (!periodMonth) return { connected: true, invalid: 'periodMonth must look like 2026-10.' };
  const payeeType = input.payeeType || 'salary';
  if (PAYEE_TYPES.indexOf(payeeType) === -1) return { connected: true, invalid: 'payeeType must be salary, freelancer, or bonus.' };
  const status = input.status || 'pending';
  if (STATUSES.indexOf(status) === -1) return { connected: true, invalid: 'status must be pending or paid.' };
  const sql = getSql();
  const rows = await sql`
    INSERT INTO team_payments (payee_name, payee_type, role, amount, currency, period_month, pay_date, status, file_url, notes)
    VALUES (
      ${input.payeeName}, ${payeeType}, ${input.role || null}, ${input.amount}, ${input.currency || 'EGP'},
      ${periodMonth}, ${input.payDate || null}, ${status}, ${input.fileUrl || null}, ${input.notes || null}
    )
    RETURNING *
  `;
  return { connected: true, payment: mapRow(rows[0]) };
}

async function updateTeamPayment(id, patch) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const existing = await sql`SELECT * FROM team_payments WHERE id = ${id}`;
  if (!existing.length) return { connected: true, notFound: true };
  const current = existing[0];

  let periodMonth = current.period_month;
  if (patch.periodMonth !== undefined) {
    periodMonth = normalizeMonth(patch.periodMonth);
    if (!periodMonth) return { connected: true, invalid: 'periodMonth must look like 2026-10.' };
  }
  if (patch.payeeType !== undefined && PAYEE_TYPES.indexOf(patch.payeeType) === -1) return { connected: true, invalid: 'payeeType must be salary, freelancer, or bonus.' };
  if (patch.status !== undefined && STATUSES.indexOf(patch.status) === -1) return { connected: true, invalid: 'status must be pending or paid.' };

  const next = {
    payee_name: patch.payeeName !== undefined ? patch.payeeName : current.payee_name,
    payee_type: patch.payeeType !== undefined ? patch.payeeType : current.payee_type,
    role: patch.role !== undefined ? patch.role : current.role,
    amount: patch.amount !== undefined ? patch.amount : current.amount,
    pay_date: patch.payDate !== undefined ? patch.payDate : current.pay_date,
    status: patch.status !== undefined ? patch.status : current.status,
    file_url: patch.fileUrl !== undefined ? patch.fileUrl : current.file_url,
    notes: patch.notes !== undefined ? patch.notes : current.notes
  };
  // Marking a payment paid without a date stamps today.
  if (next.status === 'paid' && !next.pay_date) next.pay_date = new Date().toISOString().slice(0, 10);

  const rows = await sql`
    UPDATE team_payments SET
      payee_name = ${next.payee_name},
      payee_type = ${next.payee_type},
      role = ${next.role},
      amount = ${next.amount},
      period_month = ${periodMonth},
      pay_date = ${next.pay_date},
      status = ${next.status},
      file_url = ${next.file_url},
      notes = ${next.notes},
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  return { connected: true, payment: mapRow(rows[0]) };
}

// Copies last month's salary rows into a new month as pending (skips anyone already there).
async function copySalaries(fromMonth, toMonth) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const from = normalizeMonth(fromMonth);
  const to = normalizeMonth(toMonth);
  if (!from || !to) return { connected: true, invalid: 'from and to must look like 2026-09 and 2026-10.' };
  if (from === to) return { connected: true, invalid: 'from and to must be different months.' };
  const sql = getSql();
  const source = await sql`SELECT * FROM team_payments WHERE payee_type = 'salary' AND period_month = ${from}::date`;
  const already = await sql`SELECT payee_name FROM team_payments WHERE payee_type = 'salary' AND period_month = ${to}::date`;
  const have = {};
  already.forEach(function (r) { have[r.payee_name] = true; });
  const created = [];
  for (const row of source) {
    if (have[row.payee_name]) continue;
    const inserted = await sql`
      INSERT INTO team_payments (payee_name, payee_type, role, amount, currency, period_month, status)
      VALUES (${row.payee_name}, 'salary', ${row.role}, ${row.amount}, ${row.currency}, ${to}, 'pending')
      RETURNING *
    `;
    created.push(mapRow(inserted[0]));
  }
  return { connected: true, created: created, skipped: source.length - created.length };
}

module.exports = { getTeamPayments, createTeamPayment, updateTeamPayment, copySalaries, normalizeMonth };
