// Invoices data source, backed by Postgres (see docs/money-schema.md for the table design).
// First of the Money-layer sections to get wired up, per the rollout order in that doc:
// Invoices has the clearest manual workflow (issue, send, mark paid) of the five new tables.
const { isDbConfigured, getSql } = require('./db');

const NOT_CONFIGURED_REASON =
  'POSTGRES_URL is not set yet. Create a Postgres database in the project’s Vercel Storage tab and connect it to ribahaus-os.';

function mapRow(row) {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    clientNotionId: row.client_notion_id,
    clientName: row.client_name,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    paidDate: row.paid_date,
    driveFileId: row.drive_file_id,
    driveFileUrl: row.drive_file_url,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getInvoices() {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const rows = await sql`SELECT * FROM invoices ORDER BY issue_date DESC, created_at DESC`;

  const invoices = rows.map(mapRow);
  const stats = {
    totalCount: invoices.length,
    outstandingAmount: invoices
      .filter(function (inv) { return inv.status === 'sent' || inv.status === 'overdue'; })
      .reduce(function (sum, inv) { return sum + inv.amount; }, 0),
    paidAmount: invoices
      .filter(function (inv) { return inv.status === 'paid'; })
      .reduce(function (sum, inv) { return sum + inv.amount; }, 0),
    overdueCount: invoices.filter(function (inv) { return inv.status === 'overdue'; }).length
  };

  return { connected: true, invoices: invoices, stats: stats };
}

async function createInvoice(input) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const rows = await sql`
    INSERT INTO invoices (
      invoice_number, client_notion_id, client_name, amount, currency,
      status, issue_date, due_date, drive_file_url, notes
    ) VALUES (
      ${input.invoiceNumber}, ${input.clientNotionId || null}, ${input.clientName},
      ${input.amount}, ${input.currency || 'EGP'}, ${input.status || 'draft'},
      ${input.issueDate}, ${input.dueDate || null}, ${input.fileUrl || null}, ${input.notes || null}
    )
    RETURNING *
  `;
  return { connected: true, invoice: mapRow(rows[0]) };
}

async function updateInvoice(id, patch) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();

  const existing = await sql`SELECT * FROM invoices WHERE id = ${id}`;
  if (!existing.length) return { connected: true, notFound: true };
  const current = existing[0];

  const next = {
    status: patch.status !== undefined ? patch.status : current.status,
    paid_date: patch.paidDate !== undefined ? patch.paidDate : current.paid_date,
    due_date: patch.dueDate !== undefined ? patch.dueDate : current.due_date,
    drive_file_id: patch.driveFileId !== undefined ? patch.driveFileId : current.drive_file_id,
    drive_file_url: patch.driveFileUrl !== undefined ? patch.driveFileUrl : current.drive_file_url,
    notes: patch.notes !== undefined ? patch.notes : current.notes
  };

  const rows = await sql`
    UPDATE invoices SET
      status = ${next.status},
      paid_date = ${next.paid_date},
      due_date = ${next.due_date},
      drive_file_id = ${next.drive_file_id},
      drive_file_url = ${next.drive_file_url},
      notes = ${next.notes},
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  return { connected: true, invoice: mapRow(rows[0]) };
}

module.exports = { getInvoices, createInvoice, updateInvoice };
