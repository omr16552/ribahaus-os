// Expenses data source, backed by Postgres (see docs/money-schema.md). Same shape as
// lib/money-invoices.js: connected/reason contract, mapRow helper, create + update.
const { isDbConfigured, getSql } = require('./db');

const NOT_CONFIGURED_REASON =
  'POSTGRES_URL is not set yet. Create a Postgres database in the project’s Vercel Storage tab and connect it to ribahaus-os.';

function mapRow(row) {
  return {
    id: row.id,
    vendor: row.vendor,
    category: row.category,
    amount: Number(row.amount),
    currency: row.currency,
    expenseDate: row.expense_date,
    driveFileId: row.drive_file_id,
    driveFileUrl: row.drive_file_url,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getExpenses() {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const rows = await sql`SELECT * FROM expenses ORDER BY expense_date DESC, created_at DESC`;

  const expenses = rows.map(mapRow);
  const byCategory = {};
  expenses.forEach(function (exp) {
    byCategory[exp.category] = (byCategory[exp.category] || 0) + exp.amount;
  });
  const stats = {
    totalCount: expenses.length,
    totalAmount: expenses.reduce(function (sum, exp) { return sum + exp.amount; }, 0),
    byCategory: byCategory
  };

  return { connected: true, expenses: expenses, stats: stats };
}

async function createExpense(input) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const rows = await sql`
    INSERT INTO expenses (vendor, category, amount, currency, expense_date, notes)
    VALUES (
      ${input.vendor}, ${input.category}, ${input.amount},
      ${input.currency || 'EGP'}, ${input.expenseDate}, ${input.notes || null}
    )
    RETURNING *
  `;
  return { connected: true, expense: mapRow(rows[0]) };
}

async function updateExpense(id, patch) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();

  const existing = await sql`SELECT * FROM expenses WHERE id = ${id}`;
  if (!existing.length) return { connected: true, notFound: true };
  const current = existing[0];

  const next = {
    vendor: patch.vendor !== undefined ? patch.vendor : current.vendor,
    category: patch.category !== undefined ? patch.category : current.category,
    amount: patch.amount !== undefined ? patch.amount : current.amount,
    expense_date: patch.expenseDate !== undefined ? patch.expenseDate : current.expense_date,
    drive_file_id: patch.driveFileId !== undefined ? patch.driveFileId : current.drive_file_id,
    drive_file_url: patch.driveFileUrl !== undefined ? patch.driveFileUrl : current.drive_file_url,
    notes: patch.notes !== undefined ? patch.notes : current.notes
  };

  const rows = await sql`
    UPDATE expenses SET
      vendor = ${next.vendor},
      category = ${next.category},
      amount = ${next.amount},
      expense_date = ${next.expense_date},
      drive_file_id = ${next.drive_file_id},
      drive_file_url = ${next.drive_file_url},
      notes = ${next.notes},
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  return { connected: true, expense: mapRow(rows[0]) };
}

module.exports = { getExpenses, createExpense, updateExpense };
