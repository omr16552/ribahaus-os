// Subscriptions data source, backed by Postgres (see docs/money-schema.md). Same shape as
// lib/money-invoices.js and lib/money-expenses.js.
const { isDbConfigured, getSql } = require('./db');

const NOT_CONFIGURED_REASON =
  'POSTGRES_URL is not set yet. Create a Postgres database in the project’s Vercel Storage tab and connect it to ribahaus-os.';

function mapRow(row) {
  return {
    id: row.id,
    name: row.name,
    vendor: row.vendor,
    amount: Number(row.amount),
    currency: row.currency,
    billingCycle: row.billing_cycle,
    nextRenewalDate: row.next_renewal_date,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Normalizes a subscription's cost to a monthly figure, so mixed billing cycles can be summed.
function monthlyAmount(sub) {
  if (sub.billingCycle === 'yearly') return sub.amount / 12;
  if (sub.billingCycle === 'quarterly') return sub.amount / 3;
  return sub.amount;
}

async function getSubscriptions() {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const rows = await sql`SELECT * FROM subscriptions ORDER BY next_renewal_date ASC NULLS LAST, name ASC`;

  const subscriptions = rows.map(mapRow);
  const active = subscriptions.filter(function (sub) { return sub.status === 'active'; });
  const stats = {
    totalCount: subscriptions.length,
    activeCount: active.length,
    monthlyTotal: active.reduce(function (sum, sub) { return sum + monthlyAmount(sub); }, 0)
  };

  return { connected: true, subscriptions: subscriptions, stats: stats };
}

async function createSubscription(input) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const rows = await sql`
    INSERT INTO subscriptions (name, vendor, amount, currency, billing_cycle, next_renewal_date, status, notes)
    VALUES (
      ${input.name}, ${input.vendor || null}, ${input.amount}, ${input.currency || 'EGP'},
      ${input.billingCycle}, ${input.nextRenewalDate || null}, ${input.status || 'active'}, ${input.notes || null}
    )
    RETURNING *
  `;
  return { connected: true, subscription: mapRow(rows[0]) };
}

async function updateSubscription(id, patch) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();

  const existing = await sql`SELECT * FROM subscriptions WHERE id = ${id}`;
  if (!existing.length) return { connected: true, notFound: true };
  const current = existing[0];

  const next = {
    name: patch.name !== undefined ? patch.name : current.name,
    vendor: patch.vendor !== undefined ? patch.vendor : current.vendor,
    amount: patch.amount !== undefined ? patch.amount : current.amount,
    billing_cycle: patch.billingCycle !== undefined ? patch.billingCycle : current.billing_cycle,
    next_renewal_date: patch.nextRenewalDate !== undefined ? patch.nextRenewalDate : current.next_renewal_date,
    status: patch.status !== undefined ? patch.status : current.status,
    notes: patch.notes !== undefined ? patch.notes : current.notes
  };

  const rows = await sql`
    UPDATE subscriptions SET
      name = ${next.name},
      vendor = ${next.vendor},
      amount = ${next.amount},
      billing_cycle = ${next.billing_cycle},
      next_renewal_date = ${next.next_renewal_date},
      status = ${next.status},
      notes = ${next.notes},
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  return { connected: true, subscription: mapRow(rows[0]) };
}

module.exports = { getSubscriptions, createSubscription, updateSubscription };
