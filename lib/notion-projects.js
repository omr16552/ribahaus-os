// Minimal Projects data source (v2 revision brief: Projects as a first-class object,
// separate from Sales and Clients). Can be overridden via env without a code change.
const PROJECTS_DATABASE_ID = process.env.PROJECTS_DATABASE_ID || '4d882fd3-fd43-434b-ba67-5bb62063782d';

function getText(prop) {
  if (!prop) return null;
  if (prop.type === 'title') return (prop.title || []).map(function (t) { return t.plain_text; }).join('') || null;
  return null;
}

function getSelect(prop) {
  if (!prop || prop.type !== 'select' || !prop.select) return null;
  return prop.select.name;
}

function getDate(prop) {
  if (!prop || prop.type !== 'date' || !prop.date) return null;
  return prop.date.start || null;
}

function getPeople(prop) {
  if (!prop || prop.type !== 'people') return [];
  return (prop.people || []).map(function (p) { return p.name || p.id; });
}

async function getProjects() {
  const token = process.env.NOTION_API_KEY;
  if (!token) {
    return { connected: false, reason: 'NOTION_API_KEY is not set' };
  }

  const results = [];
  let cursor = undefined;
  let hasMore = true;

  while (hasMore) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const res = await fetch('https://api.notion.com/v1/databases/' + PROJECTS_DATABASE_ID + '/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      if (res.status === 404 || res.status === 403) {
        return {
          connected: false,
          reason: 'The Projects database has not been shared with the RibaHaus OS integration yet. In Notion, open the 🗂️ Projects database, click "..." > Connections, and add "RibaHaus OS — Reader".'
        };
      }
      const details = await res.text();
      throw new Error('Notion API error: ' + details);
    }

    const data = await res.json();
    for (const page of data.results || []) {
      const props = page.properties || {};
      results.push({
        id: page.id,
        url: page.url,
        name: getText(props['Name']) || '(untitled)',
        status: getSelect(props['Status']),
        owner: getPeople(props['Owner']),
        dueDate: getDate(props['Due Date']),
        added: page.created_time
      });
    }

    hasMore = !!data.has_more;
    cursor = data.next_cursor;
  }

  return { connected: true, total: results.length, projects: results };
}

module.exports = { getProjects, PROJECTS_DATABASE_ID };
