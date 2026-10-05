// Sales + Clients API, backed by Postgres.
//   GET   /api/crm            -> pipeline columns, client lifecycle columns, stats
//   POST  /api/crm            -> add a lead or client
//   PATCH /api/crm?id=...     -> update one (move stage, change lifecycle, edit details)
const { getSalesCRM, createDeal, updateDeal } = require('../lib/crm-deals');
const { withAuth } = require('../lib/auth');

module.exports = withAuth(async (req, res) => {
  try {
    if (req.method === 'GET') {
      const crm = await getSalesCRM();
      if (!crm.connected) { res.status(200).json({ status: 'not_connected', reason: crm.reason }); return; }
      res.status(200).json({ status: 'ok', data: crm });
      return;
    }

    if (req.method === 'POST') {
      const data = await createDeal(req.body || {});
      if (!data.connected) { res.status(200).json({ status: 'not_connected', reason: data.reason }); return; }
      if (data.invalid) { res.status(400).json({ status: 'error', message: data.invalid }); return; }
      res.status(201).json({ status: 'ok', data: { deal: data.deal } });
      return;
    }

    if (req.method === 'PATCH') {
      const id = req.query.id;
      if (!id) { res.status(400).json({ status: 'error', message: 'id query parameter is required, e.g. /api/crm?id=...' }); return; }
      const data = await updateDeal(id, req.body || {});
      if (!data.connected) { res.status(200).json({ status: 'not_connected', reason: data.reason }); return; }
      if (data.notFound) { res.status(404).json({ status: 'error', message: 'Record not found.' }); return; }
      if (data.invalid) { res.status(400).json({ status: 'error', message: data.invalid }); return; }
      res.status(200).json({ status: 'ok', data: { deal: data.deal } });
      return;
    }

    res.status(405).json({ status: 'error', message: 'Method not allowed. Use GET, POST, or PATCH.' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});
