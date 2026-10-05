// Projects data source, backed by Postgres (see docs/money-schema.md). A project can point at a
// client (a deal row) by exact name, or just carry a free-text client name.
const { isDbConfigured, getSql } = require('./db');

const NOT_CONFIGURED_REASON =
  'POSTGRES_URL is not set yet. Create a Postgres database in the project’s Vercel Storage tab and connect it to ribahaus-os.';

const STATUSES = ['Not Started', 'In Progress', 'Review', 'Done', 'On Hold'];

function ymd(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function blank(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function mapRow(row) {
  return {
    id: row.id,
    name: row.name,
    clientId: row.client_id,
    clientName: row.client_name,
    status: row.status,
    owner: row.owner,
    dueDate: ymd(row.due_date),
    notes: row.notes,
    added: row.created_at,
    updatedAt: row.updated_at
  };
}

function validate(input) {
  if (input.status !== undefined && blank(input.status) && STATUSES.indexOf(input.status) === -1) return 'status must be one of: ' + STATUSES.join(', ') + '.';
  if (blank(input.dueDate) && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.dueDate).trim())) return 'dueDate must look like 2026-10-31.';
  return null;
}

// Links to a client when a deal with exactly this name exists (case-insensitive).
async function resolveClientId(sql, clientName) {
  if (!clientName) return null;
  const rows = await sql`SELECT id FROM deals WHERE lower(name) = lower(${clientName}) ORDER BY created_at ASC LIMIT 1`;
  return rows.length ? rows[0].id : null;
}

async function getProjects() {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const rows = await sql`SELECT * FROM projects ORDER BY due_date ASC NULLS LAST, created_at DESC`;
  const projects = rows.map(mapRow);
  return { connected: true, total: projects.length, projects: projects };
}

async function createProject(input) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const name = blank(input.name);
  if (!name) return { connected: true, invalid: 'name is required.' };
  const invalid = validate(input);
  if (invalid) return { connected: true, invalid: invalid };
  const sql = getSql();
  const clientName = blank(input.clientName);
  const clientId = await resolveClientId(sql, clientName);
  const rows = await sql`
    INSERT INTO projects (name, client_id, client_name, status, owner, due_date, notes)
    VALUES (${name}, ${clientId}, ${clientName}, ${blank(input.status) || 'Not Started'}, ${blank(input.owner)}, ${blank(input.dueDate)}, ${blank(input.notes)})
    RETURNING *
  `;
  return { connected: true, project: mapRow(rows[0]) };
}

async function updateProject(id, patch) {
  if (!isDbConfigured()) return { connected: false, reason: NOT_CONFIGURED_REASON };
  const sql = getSql();
  const existing = await sql`SELECT * FROM projects WHERE id = ${id}`;
  if (!existing.length) return { connected: true, notFound: true };
  if (patch.name !== undefined && !blank(patch.name)) return { connected: true, invalid: 'name cannot be empty.' };
  const invalid = validate(patch);
  if (invalid) return { connected: true, invalid: invalid };
  const cur = existing[0];
  const has = function (k) { return patch[k] !== undefined; };

  const clientName = has('clientName') ? blank(patch.clientName) : cur.client_name;
  const clientId = has('clientName') ? await resolveClientId(sql, clientName) : cur.client_id;
  const rows = await sql`
    UPDATE projects SET
      name = ${has('name') ? blank(patch.name) : cur.name},
      client_id = ${clientId},
      client_name = ${clientName},
      status = ${has('status') && blank(patch.status) ? patch.status : cur.status},
      owner = ${has('owner') ? blank(patch.owner) : cur.owner},
      due_date = ${has('dueDate') ? blank(patch.dueDate) : cur.due_date},
      notes = ${has('notes') ? blank(patch.notes) : cur.notes},
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  return { connected: true, project: mapRow(rows[0]) };
}

module.exports = { getProjects, createProject, updateProject, STATUSES };
