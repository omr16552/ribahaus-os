// Sales + Clients data source, backed by Postgres (see docs/money-schema.md). One row per deal;
// a deal becomes a client when its status is 'Closed'. Sales Stage, Client Lifecycle and
// Engagement Type stay three separate dimensions (v2 brief), exactly as they were in Notion.
const { isDbConfigured, getSql } = require('./db');

const NOT_CONFIGURED_REASON =
  'POSTGRES_URL is not set yet. Create a Postgres database in the project’s Vercel Storage tab and connect it to ribahaus-os.';

const STATUSES = ['DREAM', 'Lead', 'Qualified', 'Proposal', 'Negotiation', 'Closed', 'Lost'];
const LIFECYCLES = ['Onboarding', 'Active', 'Renewal Due', 'Dormant', 'Offboarded'];
const ENGAGEMENTS = ['Retainer', 'Project-Based', 'One-Off'];
const PRIORITIES = ['Low', 'Medium', 'High'];

function ymd(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function salesStage(status) {
  if (status === 'Lost') return 'closed_lost';
  if (status === 'Closed') return 'closed_won';
  if (status === 'Negotiation') return 'negotiation';
  if (status === 'Proposal') return 'proposal';
  if (status === 'Qualified') return 'qualified';
  return 'lead'; // DREAM, Lead
}

// Only closed-won deals are clients; a closed deal with no lifecycle yet shows as onboarding.
function clientLifecycleStage(status, lifecycle) {
  if (status !== 'Closed') return null;
  if (lifecycle === 'Active') return 'active';
  if (lifecycle === 'Renewal Due') return 'renewal_due';
  if (lifecycle === 'Dormant') return 'dormant';
  if (lifecycle === 'Offboarded') return 'offboarded';
  return 'onboarding';
}

function mapRow(row) {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    status: row.status,
    salesStage: salesStage(row.status),
    clientLifecycle: row.client_lifecycle,
    clientLifecycleStage: clientLifecycleStage(row.status, row.client_lifecycle),
    engagementType: row.engagement_type,
    priority: row.priority,
    industry: row.industry,
    estimatedValue: row.estimated_value === null || row.estimated_value === undefined ? null : Number(row.estimated_value),
    email: row.email,
    phone: row.phone,
    socials: row.socials_url,
    leadSource: row.lead_source,
    phases: row.phases,
    expectedClose: ymd(row.expected_close),
    owner: row.owner,
    notes: row.notes,
    added: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getSalesCRM() {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const rows = await sql`SELECT * FROM deals ORDER BY created_at DESC`;
  const results = rows.map(mapRow);

  const salesPipeline = { lead: [], qualified: [], proposal: [], negotiation: [], closed_won: [], closed_lost: [] };
  for (const row of results) (salesPipeline[row.salesStage] || salesPipeline.lead).push(row);

  const clients = { onboarding: [], active: [], renewal_due: [], dormant: [], offboarded: [] };
  for (const row of results) {
    if (row.clientLifecycleStage) (clients[row.clientLifecycleStage] || clients.onboarding).push(row);
  }

  const openPipelineValue = salesPipeline.lead.concat(salesPipeline.qualified, salesPipeline.proposal, salesPipeline.negotiation)
    .reduce(function (sum, r) { return sum + (r.estimatedValue || 0); }, 0);
  const won = salesPipeline.closed_won.length;
  const lost = salesPipeline.closed_lost.length;
  const winRate = (won + lost) > 0 ? Math.round((won / (won + lost)) * 100) : null;
  const activeClientCount = clients.active.length + clients.renewal_due.length + clients.onboarding.length;
  const retainerCount = results.filter(function (r) {
    return r.engagementType === 'Retainer' && (r.clientLifecycleStage === 'active' || r.clientLifecycleStage === 'renewal_due');
  }).length;

  return {
    connected: true,
    total: results.length,
    salesPipeline: salesPipeline,
    clients: clients,
    stats: {
      openPipelineValue: openPipelineValue,
      leadCount: salesPipeline.lead.length,
      qualifiedCount: salesPipeline.qualified.length,
      proposalCount: salesPipeline.proposal.length,
      negotiationCount: salesPipeline.negotiation.length,
      closedWonCount: won,
      closedLostCount: lost,
      winRate: winRate,
      activeClientCount: activeClientCount,
      renewalDueCount: clients.renewal_due.length,
      retainerCount: retainerCount
    }
  };
}

function blank(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

// Validates the fields present in `input`; returns an error message or null.
function validate(input) {
  if (input.status !== undefined && input.status !== null && input.status !== '' && STATUSES.indexOf(input.status) === -1) return 'status must be one of: ' + STATUSES.join(', ') + '.';
  if (blank(input.clientLifecycle) && LIFECYCLES.indexOf(input.clientLifecycle) === -1) return 'clientLifecycle must be one of: ' + LIFECYCLES.join(', ') + '.';
  if (blank(input.engagementType) && ENGAGEMENTS.indexOf(input.engagementType) === -1) return 'engagementType must be one of: ' + ENGAGEMENTS.join(', ') + '.';
  if (blank(input.priority) && PRIORITIES.indexOf(input.priority) === -1) return 'priority must be one of: ' + PRIORITIES.join(', ') + '.';
  if (input.estimatedValue !== undefined && input.estimatedValue !== null && input.estimatedValue !== '') {
    const n = Number(input.estimatedValue);
    if (!isFinite(n) || n < 0) return 'estimatedValue must be a positive number.';
  }
  if (blank(input.expectedClose) && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.expectedClose).trim())) return 'expectedClose must look like 2026-10-31.';
  if (blank(input.socials) && !/^https?:\/\//i.test(String(input.socials).trim())) return 'socials must start with http:// or https://';
  return null;
}

async function createDeal(input) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const name = blank(input.name);
  if (!name) return { connected: true, invalid: 'name is required.' };
  const invalid = validate(input);
  if (invalid) return { connected: true, invalid: invalid };
  const sql = getSql();
  const value = blank(input.estimatedValue);
  const rows = await sql`
    INSERT INTO deals (name, company, status, client_lifecycle, engagement_type, priority, industry, estimated_value,
      email, phone, socials_url, lead_source, phases, expected_close, owner, notes)
    VALUES (
      ${name}, ${blank(input.company)}, ${blank(input.status) || 'Lead'}, ${blank(input.clientLifecycle)}, ${blank(input.engagementType)},
      ${blank(input.priority)}, ${blank(input.industry)}, ${value === null ? null : Number(value)},
      ${blank(input.email)}, ${blank(input.phone)}, ${blank(input.socials)}, ${blank(input.leadSource)}, ${blank(input.phases)},
      ${blank(input.expectedClose)}, ${blank(input.owner)}, ${blank(input.notes)}
    )
    RETURNING *
  `;
  return { connected: true, deal: mapRow(rows[0]) };
}

async function updateDeal(id, patch) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const existing = await sql`SELECT * FROM deals WHERE id = ${id}`;
  if (!existing.length) return { connected: true, notFound: true };
  if (patch.name !== undefined && !blank(patch.name)) return { connected: true, invalid: 'name cannot be empty.' };
  const invalid = validate(patch);
  if (invalid) return { connected: true, invalid: invalid };
  const cur = existing[0];
  const has = function (k) { return patch[k] !== undefined; };
  const pick = function (k, col) { return has(k) ? blank(patch[k]) : cur[col]; };

  const next = {
    name: has('name') ? blank(patch.name) : cur.name,
    company: pick('company', 'company'),
    status: has('status') && blank(patch.status) ? patch.status : cur.status,
    client_lifecycle: pick('clientLifecycle', 'client_lifecycle'),
    engagement_type: pick('engagementType', 'engagement_type'),
    priority: pick('priority', 'priority'),
    industry: pick('industry', 'industry'),
    estimated_value: has('estimatedValue') ? (blank(patch.estimatedValue) === null ? null : Number(patch.estimatedValue)) : cur.estimated_value,
    email: pick('email', 'email'),
    phone: pick('phone', 'phone'),
    socials_url: pick('socials', 'socials_url'),
    lead_source: pick('leadSource', 'lead_source'),
    phases: pick('phases', 'phases'),
    expected_close: has('expectedClose') ? blank(patch.expectedClose) : cur.expected_close,
    owner: pick('owner', 'owner'),
    notes: pick('notes', 'notes')
  };

  const rows = await sql`
    UPDATE deals SET
      name = ${next.name}, company = ${next.company}, status = ${next.status},
      client_lifecycle = ${next.client_lifecycle}, engagement_type = ${next.engagement_type},
      priority = ${next.priority}, industry = ${next.industry}, estimated_value = ${next.estimated_value},
      email = ${next.email}, phone = ${next.phone}, socials_url = ${next.socials_url},
      lead_source = ${next.lead_source}, phases = ${next.phases}, expected_close = ${next.expected_close},
      owner = ${next.owner}, notes = ${next.notes}, updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  return { connected: true, deal: mapRow(rows[0]) };
}

module.exports = { getSalesCRM, createDeal, updateDeal, STATUSES, LIFECYCLES, ENGAGEMENTS, PRIORITIES };
