// Retainers data source, backed by Postgres (see docs/money-schema.md). Same shape as
// lib/money-subscriptions.js. contract_url holds a Dropbox shared link (file stays in Dropbox).
const { isDbConfigured, getSql } = require('./db');

const NOT_CONFIGURED_REASON =
  'POSTGRES_URL is not set yet. Create a Postgres database in the project’s Vercel Storage tab and connect it to ribahaus-os.';

function dateOnly(value) {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 10);
}

function mapRow(row) {
  return {
    id: row.id,
    clientNotionId: row.client_notion_id,
    clientName: row.client_name,
    monthlyFee: Number(row.monthly_fee),
    currency: row.currency,
    scope: row.scope,
    startDate: dateOnly(row.start_date),
    endDate: dateOnly(row.end_date),
    status: row.status,
    autoRenew: row.auto_renew,
    contractUrl: row.contract_url,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(new Date().toISOString().slice(0, 10));
  return Math.round((new Date(dateStr) - today) / 86400000);
}

async function getRetainers() {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const rows = await sql`SELECT * FROM retainers ORDER BY end_date ASC NULLS LAST, client_name ASC`;

  const retainers = rows.map(mapRow).map(function (r) {
    r.daysToEnd = r.status === 'active' ? daysUntil(r.endDate) : null;
    return r;
  });
  const active = retainers.filter(function (r) { return r.status === 'active'; });
  function renewingWithin(days) {
    return active.filter(function (r) { return r.daysToEnd !== null && r.daysToEnd >= 0 && r.daysToEnd <= days; }).length;
  }
  const stats = {
    totalCount: retainers.length,
    activeCount: active.length,
    monthlyRecurring: active.reduce(function (sum, r) { return sum + r.monthlyFee; }, 0),
    renewing30: renewingWithin(30),
    renewing60: renewingWithin(60),
    renewing90: renewingWithin(90),
    expiredActive: active.filter(function (r) { return r.daysToEnd !== null && r.daysToEnd < 0; }).length
  };

  return { connected: true, retainers: retainers, stats: stats };
}

async function createRetainer(input) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const rows = await sql`
    INSERT INTO retainers (client_notion_id, client_name, monthly_fee, currency, scope, start_date, end_date, status, auto_renew, contract_url, notes)
    VALUES (
      ${input.clientNotionId || null}, ${input.clientName}, ${input.monthlyFee}, ${input.currency || 'EGP'},
      ${input.scope || null}, ${input.startDate}, ${input.endDate || null}, ${input.status || 'active'},
      ${input.autoRenew === true}, ${input.contractUrl || null}, ${input.notes || null}
    )
    RETURNING *
  `;
  return { connected: true, retainer: mapRow(rows[0]) };
}

async function updateRetainer(id, patch) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();

  const existing = await sql`SELECT * FROM retainers WHERE id = ${id}`;
  if (!existing.length) return { connected: true, notFound: true };
  const current = existing[0];

  const next = {
    client_notion_id: patch.clientNotionId !== undefined ? patch.clientNotionId : current.client_notion_id,
    client_name: patch.clientName !== undefined ? patch.clientName : current.client_name,
    monthly_fee: patch.monthlyFee !== undefined ? patch.monthlyFee : current.monthly_fee,
    scope: patch.scope !== undefined ? patch.scope : current.scope,
    start_date: patch.startDate !== undefined ? patch.startDate : current.start_date,
    end_date: patch.endDate !== undefined ? patch.endDate : current.end_date,
    status: patch.status !== undefined ? patch.status : current.status,
    auto_renew: patch.autoRenew !== undefined ? patch.autoRenew === true : current.auto_renew,
    contract_url: patch.contractUrl !== undefined ? patch.contractUrl : current.contract_url,
    notes: patch.notes !== undefined ? patch.notes : current.notes
  };

  const rows = await sql`
    UPDATE retainers SET
      client_notion_id = ${next.client_notion_id},
      client_name = ${next.client_name},
      monthly_fee = ${next.monthly_fee},
      scope = ${next.scope},
      start_date = ${next.start_date},
      end_date = ${next.end_date},
      status = ${next.status},
      auto_renew = ${next.auto_renew},
      contract_url = ${next.contract_url},
      notes = ${next.notes},
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  return { connected: true, retainer: mapRow(rows[0]) };
}

module.exports = { getRetainers, createRetainer, updateRetainer };
