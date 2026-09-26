// SALES_CRM_DATABASE_ID can be overridden via env (Vercel project settings) without a code change.
// Falls back to the known-good ID so this keeps working even if the env var isn't set yet.
const SALES_CRM_DATABASE_ID = process.env.SALES_CRM_DATABASE_ID || '15b14383-c251-81c4-87de-cb77c7f935b5';

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

// Sales Stage: where a deal sits in the pipeline before it's won or lost.
// Independent of Client Lifecycle / Engagement Type (v2 brief: these are three separate
// dimensions and must never be conflated into a single pipeline).
function salesStage(status) {
  if (status === 'Lost') return 'closed_lost';
  if (status === 'Closed') return 'closed_won';
  if (status === 'Negotiation') return 'negotiation';
  if (status === 'Proposal') return 'proposal';
  if (status === 'Qualified') return 'qualified';
  return 'lead'; // DREAM, Lead, or unset
}

// Client Lifecycle: only meaningful once a deal is Closed (won) and the prospect becomes a
// client. Not-yet-won and lost deals return null (they aren't clients).
function clientLifecycleStage(status, clientLifecycle) {
  if (status !== 'Closed') return null;
  if (clientLifecycle === 'Onboarding') return 'onboarding';
  if (clientLifecycle === 'Active') return 'active';
  if (clientLifecycle === 'Renewal Due') return 'renewal_due';
  if (clientLifecycle === 'Dormant') return 'dormant';
  if (clientLifecycle === 'Offboarded') return 'offboarded';
  return 'onboarding'; // closed-won but not yet classified in Notion — surfaced so it gets triaged
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
      const clientLifecycle = getSelect(props['Client Lifecycle']);
      const engagementType = getSelect(props['Engagement Type']);
      results.push({
        id: page.id,
        url: page.url,
        name: getText(props['Name']) || '(untitled)',
        company: getText(props['Company']),
        status: status,
        salesStage: salesStage(status),
        clientLifecycle: clientLifecycle,
        clientLifecycleStage: clientLifecycleStage(status, clientLifecycle),
        engagementType: engagementType,
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

  // Sales pipeline: every deal, open and both closed terminal states.
  const salesPipeline = { lead: [], qualified: [], proposal: [], negotiation: [], closed_won: [], closed_lost: [] };
  for (const row of results) {
    (salesPipeline[row.salesStage] || salesPipeline.lead).push(row);
  }

  // Client lifecycle: only rows that are actually closed-won clients.
  const clients = { onboarding: [], active: [], renewal_due: [], dormant: [], offboarded: [] };
  for (const row of results) {
    if (row.clientLifecycleStage) {
      (clients[row.clientLifecycleStage] || clients.onboarding).push(row);
    }
  }

  const openPipelineValue = salesPipeline.lead.concat(salesPipeline.qualified, salesPipeline.proposal, salesPipeline.negotiation)
    .reduce(function (sum, r) { return sum + (r.estimatedValue || 0); }, 0);

  const closedWonCount = salesPipeline.closed_won.length;
  const closedLostCount = salesPipeline.closed_lost.length;
  const winRate = (closedWonCount + closedLostCount) > 0 ? Math.round((closedWonCount / (closedWonCount + closedLostCount)) * 100) : null;

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
      closedWonCount: closedWonCount,
      closedLostCount: closedLostCount,
      winRate: winRate,
      activeClientCount: activeClientCount,
      renewalDueCount: clients.renewal_due.length,
      retainerCount: retainerCount
    }
  };
}

module.exports = { getSalesCRM, SALES_CRM_DATABASE_ID };
