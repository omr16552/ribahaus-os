const { getProposals, createProposal, updateProposal } = require('../lib/money-proposals');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://omr16552.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    if (req.method === 'GET') {
      const data = await getProposals();
      if (!data.connected) { res.status(200).json({ status: 'not_connected', reason: data.reason }); return; }
      res.status(200).json({ status: 'ok', data: { proposals: data.proposals, stats: data.stats } });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (!body.title || !body.clientName || !body.value) {
        res.status(400).json({ status: 'error', message: 'title, clientName, and value are required.' });
        return;
      }
      const data = await createProposal(body);
      if (!data.connected) { res.status(200).json({ status: 'not_connected', reason: data.reason }); return; }
      res.status(201).json({ status: 'ok', data: { proposal: data.proposal } });
      return;
    }

    if (req.method === 'PATCH') {
      const id = req.query.id;
      if (!id) { res.status(400).json({ status: 'error', message: 'id query parameter is required, e.g. /api/proposals?id=...' }); return; }
      const data = await updateProposal(id, req.body || {});
      if (!data.connected) { res.status(200).json({ status: 'not_connected', reason: data.reason }); return; }
      if (data.notFound) { res.status(404).json({ status: 'error', message: 'Proposal not found.' }); return; }
      res.status(200).json({ status: 'ok', data: { proposal: data.proposal } });
      return;
    }

    res.status(405).json({ status: 'error', message: 'Method not allowed. Use GET, POST, or PATCH.' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};
