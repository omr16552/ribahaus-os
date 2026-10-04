// Proposals data source, backed by Postgres (see docs/money-schema.md). Same shape as
// lib/money-retainers.js. file_url holds a Dropbox shared link (file stays in Dropbox).
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
    title: row.title,
    clientNotionId: row.client_notion_id,
    clientName: row.client_name,
    value: Number(row.value),
    currency: row.currency,
    status: row.status,
    sentDate: dateOnly(row.sent_date),
    validUntil: dateOnly(row.valid_until),
    fileUrl: row.file_url,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getProposals() {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const rows = await sql`SELECT * FROM proposals ORDER BY created_at DESC`;

  const proposals = rows.map(mapRow);
  function sumValue(list) { return list.reduce(function (sum, p) { return sum + p.value; }, 0); }
  const open = proposals.filter(function (p) { return p.status === 'draft' || p.status === 'sent'; });
  const accepted = proposals.filter(function (p) { return p.status === 'accepted'; });
  const lost = proposals.filter(function (p) { return p.status === 'lost'; });
  const decided = accepted.length + lost.length;
  const stats = {
    totalCount: proposals.length,
    openCount: open.length,
    openValue: sumValue(open),
    acceptedValue: sumValue(accepted),
    winRate: decided ? Math.round((accepted.length / decided) * 100) : null
  };

  return { connected: true, proposals: proposals, stats: stats };
}

async function createProposal(input) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const rows = await sql`
    INSERT INTO proposals (title, client_notion_id, client_name, value, currency, status, sent_date, valid_until, file_url, notes)
    VALUES (
      ${input.title}, ${input.clientNotionId || null}, ${input.clientName}, ${input.value}, ${input.currency || 'EGP'},
      ${input.status || 'draft'}, ${input.sentDate || null}, ${input.validUntil || null},
      ${input.fileUrl || null}, ${input.notes || null}
    )
    RETURNING *
  `;
  return { connected: true, proposal: mapRow(rows[0]) };
}

async function updateProposal(id, patch) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();

  const existing = await sql`SELECT * FROM proposals WHERE id = ${id}`;
  if (!existing.length) return { connected: true, notFound: true };
  const current = existing[0];

  const next = {
    title: patch.title !== undefined ? patch.title : current.title,
    client_notion_id: patch.clientNotionId !== undefined ? patch.clientNotionId : current.client_notion_id,
    client_name: patch.clientName !== undefined ? patch.clientName : current.client_name,
    value: patch.value !== undefined ? patch.value : current.value,
    status: patch.status !== undefined ? patch.status : current.status,
    sent_date: patch.sentDate !== undefined ? patch.sentDate : current.sent_date,
    valid_until: patch.validUntil !== undefined ? patch.validUntil : current.valid_until,
    file_url: patch.fileUrl !== undefined ? patch.fileUrl : current.file_url,
    notes: patch.notes !== undefined ? patch.notes : current.notes
  };

  const rows = await sql`
    UPDATE proposals SET
      title = ${next.title},
      client_notion_id = ${next.client_notion_id},
      client_name = ${next.client_name},
      value = ${next.value},
      status = ${next.status},
      sent_date = ${next.sent_date},
      valid_until = ${next.valid_until},
      file_url = ${next.file_url},
      notes = ${next.notes},
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  return { connected: true, proposal: mapRow(rows[0]) };
}

module.exports = { getProposals, createProposal, updateProposal };
