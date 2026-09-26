// Ad Spend data source, backed by Postgres (see docs/money-schema.md). Same shape as
// lib/money-invoices.js / lib/money-expenses.js / lib/money-subscriptions.js.
const { isDbConfigured, getSql } = require('./db');

const NOT_CONFIGURED_REASON =
  'POSTGRES_URL is not set yet. Create a Postgres database in the project’s Vercel Storage tab and connect it to ribahaus-os.';

function mapRow(row) {
  return {
    id: row.id,
    clientNotionId: row.client_notion_id,
    clientName: row.client_name,
    campaignName: row.campaign_name,
    platform: row.platform,
    spendAmount: Number(row.spend_amount),
    currency: row.currency,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getAdSpend() {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const rows = await sql`SELECT * FROM ad_spend ORDER BY period_start DESC, created_at DESC`;

  const adSpend = rows.map(mapRow);
  const byPlatform = {};
  adSpend.forEach(function (entry) {
    byPlatform[entry.platform] = (byPlatform[entry.platform] || 0) + entry.spendAmount;
  });
  const stats = {
    totalCount: adSpend.length,
    totalSpend: adSpend.reduce(function (sum, entry) { return sum + entry.spendAmount; }, 0),
    byPlatform: byPlatform
  };

  return { connected: true, adSpend: adSpend, stats: stats };
}

async function createAdSpend(input) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const rows = await sql`
    INSERT INTO ad_spend (client_notion_id, client_name, campaign_name, platform, spend_amount, currency, period_start, period_end, notes)
    VALUES (
      ${input.clientNotionId || null}, ${input.clientName || null}, ${input.campaignName}, ${input.platform},
      ${input.spendAmount}, ${input.currency || 'EGP'}, ${input.periodStart}, ${input.periodEnd}, ${input.notes || null}
    )
    RETURNING *
  `;
  return { connected: true, adSpend: mapRow(rows[0]) };
}

async function updateAdSpend(id, patch) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();

  const existing = await sql`SELECT * FROM ad_spend WHERE id = ${id}`;
  if (!existing.length) return { connected: true, notFound: true };
  const current = existing[0];

  const next = {
    client_notion_id: patch.clientNotionId !== undefined ? patch.clientNotionId : current.client_notion_id,
    client_name: patch.clientName !== undefined ? patch.clientName : current.client_name,
    campaign_name: patch.campaignName !== undefined ? patch.campaignName : current.campaign_name,
    platform: patch.platform !== undefined ? patch.platform : current.platform,
    spend_amount: patch.spendAmount !== undefined ? patch.spendAmount : current.spend_amount,
    period_start: patch.periodStart !== undefined ? patch.periodStart : current.period_start,
    period_end: patch.periodEnd !== undefined ? patch.periodEnd : current.period_end,
    notes: patch.notes !== undefined ? patch.notes : current.notes
  };

  const rows = await sql`
    UPDATE ad_spend SET
      client_notion_id = ${next.client_notion_id},
      client_name = ${next.client_name},
      campaign_name = ${next.campaign_name},
      platform = ${next.platform},
      spend_amount = ${next.spend_amount},
      period_start = ${next.period_start},
      period_end = ${next.period_end},
      notes = ${next.notes},
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  return { connected: true, adSpend: mapRow(rows[0]) };
}

module.exports = { getAdSpend, createAdSpend, updateAdSpend };
