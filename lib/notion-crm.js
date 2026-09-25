const SALES_CRM_DATABASE_ID = '15b14383-c251-81c4-87de-cb77c7f935b5';

function getText(prop) {
  if (!prop) return null;
  if (prop.type === 'title') return (prop.title || []).map(function (t) { return t.plain_text; }).join('') || null;
  if (prop.type === 'rich_text') return (prop.rich_text || []).map(function (t) { return t.plain_text; }).join('') || null;
  return null;
}

function getSelect(prop) {
  if (!prop || prop.type !== 'select' || !prop.select) return null;
  return prop.select.name;
}

function getStatus(prop) {
  if (!prop || prop.type !== 'status' || !prop.status) return null;
  return prop.status.name;
}

function getNumber(prop) {
  if (!prop || prop.type !== 'number') return null;
  return typeof prop.number === 'number' ? prop.number : null;
}

function getEmail(prop) {
  if (!prop || prop.type !== 'email') return null;
  return prop.email || null;
}

function getUrl(prop) {
  if (!prop || prop.type !== 'url') return null;
  return prop.url || null;
}

function getDate(prop) {
  if (!prop || prop.type !== 'date' || !prop.date) return null;
  return prop.date.start || null;
}

// Groups a raw Notion "Status" value into one of the dashboard's pipeline stages.
function pipelineStage(status, clientStage) {
  if (status === 'Lost') return 'lost';
  if (status === 'DREAM' || status === 'Lead') return 'lead';
  if (status === 'Qualified' || status === 'Proposal' || status === 'Negotiation') return 'proposal';
  if (status === 'Closed') {
    if (clientStage === 'Retainer' || clientStage === 'Renewal Due') return 'retainer';
    return 'active_client';
  }
  return 'lead';
}

async function getSalesCRM() {
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

    const res = await fetch('https://api.notion.com/v1/databases/' + SALES_CRM_DATABASE_ID + '/query', {
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
          reason: 'The Sales CRM database has not been shared with the RibaHaus OS integration yet. In Notion, open the Sales CRM database, click "..." > Connections, and add "RibaHaus OS — Reader".'
        };
      }
      const details = await res.text();
      throw new Error('Notion API error: ' + details);
    }

    const data = await res.json();
    for (const page of data.results || []) {
      const props = page.properties || {};
      const status = getStatus(props['Status']);
      const clientStage = getSelect(props['Client Stage']);
      results.push({
        id: page.id,
        url: page.url,
        name: getText(props['Name']) || '(untitled)',
        company: getText(props['Company']),
        status: status,
        clientStage: clientStage,
        stage: pipelineStage(status, clientStage),
        priority: getSelect(props['Priority']),
        industry: getSelect(props['Industry']),
        estimatedValue: getNumber(props['Estimated Value']),
        email: getEmail(props['Email']),
        socials: getUrl(props['Socials or website']),
        expectedClose: getDate(props['Expected Close']),
        added: page.created_time
      });
    }

    hasMore = !!data.has_more;
    cursor = data.next_cursor;
  }

  const stages = { lead: [], proposal: [], active_client: [], retainer: [], lost: [] };
  for (const row of results) {
    (stages[row.stage] || stages.lead).push(row);
  }

  const openValue = results
    .filter(function (r) { return r.stage === 'lead' || r.stage === 'proposal'; })
    .reduce(function (sum, r) { return sum + (r.estimatedValue || 0); }, 0);

  const closedCount = stages.active_client.length + stages.retainer.length;
  const lostCount = stages.lost.length;
  const winRate = (closedCount + lostCount) > 0 ? Math.round((closedCount / (closedCount + lostCount)) * 100) : null;

  return {
    connected: true,
    total: results.length,
    stages: stages,
    stats: {
      openPipelineValue: openValue,
      leadCount: stages.lead.length,
      proposalCount: stages.proposal.length,
      activeClientCount: closedCount,
      lostCount: lostCount,
      winRate: winRate
    }
  };
}

module.exports = { getSalesCRM, SALES_CRM_DATABASE_ID };
