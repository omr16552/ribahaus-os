// Notion Tasks dashboard (read-only). Sales, Clients and Projects now live in Postgres; Notion is
// only used for tasks. Which Notion databases the dashboard reads is a setting (app_settings key
// 'tasks_sources', a list of database ids) chosen on the Tasks page. Notion databases must be
// shared with the "RibaHaus OS — Reader" integration (database menu > Connections) to be listed.
const { isDbConfigured, getSql } = require('./db');

const NOTION_VERSION = '2022-06-28';
const SETTINGS_KEY = 'tasks_sources';
const MAX_SOURCES = 5;
const MAX_ROWS_PER_SOURCE = 200;

function notionHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'Notion-Version': NOTION_VERSION };
}

function plain(richText) {
  return (richText || []).map(function (t) { return t.plain_text; }).join('');
}

async function notionFetch(token, path, options) {
  const res = await fetch('https://api.notion.com/v1' + path, Object.assign({ headers: notionHeaders(token) }, options || {}));
  if (!res.ok) {
    const err = new Error('Notion API ' + res.status);
    err.status = res.status;
    err.details = await res.text();
    throw err;
  }
  return res.json();
}

async function getSelectedIds() {
  if (!isDbConfigured()) return [];
  const sql = getSql();
  const rows = await sql`SELECT value FROM app_settings WHERE key = ${SETTINGS_KEY}`;
  if (!rows.length) return [];
  const value = rows[0].value;
  return Array.isArray(value && value.ids) ? value.ids : [];
}

async function saveSelectedIds(ids) {
  if (!isDbConfigured()) return { connected: false, reason: 'POSTGRES_URL is not set yet.' };
  if (!Array.isArray(ids)) return { connected: true, invalid: 'sourceIds must be a list of Notion database ids.' };
  const clean = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{32,36}$/i.test(id.trim())) return { connected: true, invalid: 'Each source id must be a Notion database id.' };
    if (clean.indexOf(id.trim()) === -1) clean.push(id.trim());
  }
  if (clean.length > MAX_SOURCES) return { connected: true, invalid: 'Pick at most ' + MAX_SOURCES + ' sources.' };
  const sql = getSql();
  const value = JSON.stringify({ ids: clean });
  await sql`
    INSERT INTO app_settings (key, value) VALUES (${SETTINGS_KEY}, ${value}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  return { connected: true, ids: clean };
}

// Databases the integration can see (the choices offered in the source picker).
async function listSources() {
  const token = process.env.NOTION_API_KEY;
  if (!token) return { connected: false, reason: 'NOTION_API_KEY is not set' };
  const found = [];
  let cursor;
  let more = true;
  let guard = 0;
  while (more && guard < 5) {
    guard++;
    const body = { filter: { property: 'object', value: 'database' }, page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const data = await notionFetch(token, '/search', { method: 'POST', body: JSON.stringify(body) });
    for (const db of data.results || []) {
      const title = plain(db.title) || '(untitled)';
      found.push({ id: db.id, title: title, url: db.url, lastEdited: db.last_edited_time });
    }
    more = !!data.has_more;
    cursor = data.next_cursor;
  }
  found.sort(function (a, b) { return a.title.localeCompare(b.title); });
  const selected = await getSelectedIds();
  return { connected: true, sources: found, selected: selected };
}

function findProps(schema) {
  const props = Object.keys(schema || {}).map(function (name) { return Object.assign({ name: name }, schema[name]); });
  const first = function (pred) { for (const p of props) if (pred(p)) return p; return null; };
  const title = first(function (p) { return p.type === 'title'; });
  const status = first(function (p) { return p.type === 'status'; }) ||
    first(function (p) { return p.type === 'select' && /status|stage|state/i.test(p.name); });
  const due = first(function (p) { return p.type === 'date' && /due|deadline/i.test(p.name); }) ||
    first(function (p) { return p.type === 'date'; });
  const people = first(function (p) { return p.type === 'people' && /assign|owner|responsible/i.test(p.name); }) ||
    first(function (p) { return p.type === 'people'; });
  const priority = first(function (p) { return (p.type === 'select' || p.type === 'status') && /priority/i.test(p.name); });
  return { title: title, status: status, due: due, people: people, priority: priority };
}

function statusGroupLookup(statusProp) {
  // For Notion "status" properties, groups map option ids to to_do / in_progress / complete.
  const byName = {};
  if (statusProp && statusProp.type === 'status' && statusProp.status) {
    const groups = statusProp.status.groups || [];
    const options = statusProp.status.options || [];
    const groupByOptionId = {};
    for (const g of groups) for (const id of g.option_ids || []) groupByOptionId[id] = g.name;
    for (const o of options) {
      const g = groupByOptionId[o.id];
      byName[o.name] = g === 'Complete' || g === 'complete' ? 'done' : (g === 'In progress' || g === 'in_progress') ? 'in_progress' : 'todo';
    }
  }
  return byName;
}

function groupFromName(name) {
  if (!name) return 'todo';
  if (/done|complete|finished|closed|shipped|delivered/i.test(name)) return 'done';
  if (/progress|doing|review|working|active|started/i.test(name)) return 'in_progress';
  return 'todo';
}

function pageValue(prop) {
  if (!prop) return null;
  if (prop.type === 'status') return prop.status ? prop.status.name : null;
  if (prop.type === 'select') return prop.select ? prop.select.name : null;
  return null;
}

async function readSource(token, id) {
  const db = await notionFetch(token, '/databases/' + id);
  const sourceTitle = plain(db.title) || '(untitled)';
  const p = findProps(db.properties);
  if (!p.title) throw Object.assign(new Error('Database has no title property'), { status: 0 });
  const lookup = statusGroupLookup(p.status);

  const tasks = [];
  let cursor;
  let more = true;
  while (more && tasks.length < MAX_ROWS_PER_SOURCE) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const data = await notionFetch(token, '/databases/' + id + '/query', { method: 'POST', body: JSON.stringify(body) });
    for (const page of data.results || []) {
      const props = page.properties || {};
      const statusName = p.status ? pageValue(props[p.status.name]) : null;
      const dueProp = p.due ? props[p.due.name] : null;
      const peopleProp = p.people ? props[p.people.name] : null;
      tasks.push({
        id: page.id,
        url: page.url,
        name: plain((props[p.title.name] || {}).title) || '(untitled)',
        status: statusName,
        statusGroup: statusName ? (lookup[statusName] || groupFromName(statusName)) : 'todo',
        due: dueProp && dueProp.date ? dueProp.date.start : null,
        assignees: peopleProp && peopleProp.people ? peopleProp.people.map(function (x) { return x.name || 'Someone'; }) : [],
        priority: p.priority ? pageValue(props[p.priority.name]) : null,
        source: { id: id, title: sourceTitle },
        edited: page.last_edited_time
      });
    }
    more = !!data.has_more;
    cursor = data.next_cursor;
  }
  return { id: id, title: sourceTitle, tasks: tasks, mapped: { status: p.status && p.status.name, due: p.due && p.due.name, people: p.people && p.people.name, priority: p.priority && p.priority.name } };
}

function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

async function getTasks() {
  const token = process.env.NOTION_API_KEY;
  if (!token) return { connected: false, reason: 'NOTION_API_KEY is not set' };
  const ids = await getSelectedIds();
  if (!ids.length) return { connected: true, selected: [], sources: [], tasks: [], errors: [], stats: null, needsSource: true };

  const sources = [];
  const errors = [];
  let tasks = [];
  for (const id of ids) {
    try {
      const src = await readSource(token, id);
      sources.push({ id: src.id, title: src.title, count: src.tasks.length, mapped: src.mapped });
      tasks = tasks.concat(src.tasks);
    } catch (err) {
      const shared = err.status === 404 || err.status === 403;
      errors.push({ id: id, message: shared ? 'Not shared with the RibaHaus OS integration. In Notion, open the database, click "..." > Connections, and add "RibaHaus OS — Reader".' : (err.message || 'Could not read this database.') });
    }
  }

  const today = dayStart(new Date());
  const soonEnd = today + 7 * 86400000;
  const stats = { total: tasks.length, open: 0, inProgress: 0, done: 0, overdue: 0, dueSoon: 0 };
  for (const t of tasks) {
    if (t.statusGroup === 'done') { stats.done++; continue; }
    stats.open++;
    if (t.statusGroup === 'in_progress') stats.inProgress++;
    if (t.due) {
      const due = new Date(t.due.slice(0, 10) + 'T00:00:00').getTime();
      if (due < today) { stats.overdue++; t.overdue = true; }
      else if (due <= soonEnd) stats.dueSoon++;
    }
  }
  tasks.sort(function (a, b) {
    if ((a.statusGroup === 'done') !== (b.statusGroup === 'done')) return a.statusGroup === 'done' ? 1 : -1;
    if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
    if (a.due) return -1;
    if (b.due) return 1;
    return 0;
  });
  return { connected: true, selected: ids, sources: sources, tasks: tasks, errors: errors, stats: stats };
}

module.exports = { getTasks, listSources, saveSelectedIds, getSelectedIds, findProps };
