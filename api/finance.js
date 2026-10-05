const { withAuth } = require('../lib/auth');
// Finance API. One function (the project is at Vercel's Hobby function count) serving:
//   GET   /api/finance?months=6      -> P&L, cost breakdown, cash outlook, payroll ledger
//   POST  /api/finance               -> add a team payment, or { action: 'copySalaries', from, to }
//   PATCH /api/finance?id=...        -> update a team payment (for example mark it paid)
const { getFinance } = require('../lib/money-finance');
const { createTeamPayment, updateTeamPayment, copySalaries } = require('../lib/money-team');

module.exports = withAuth(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://omr16552.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    if (req.method === 'GET') {
      const data = await getFinance(req.query.months);
      if (!data.connected) { res.status(200).json({ status: 'not_connected', reason: data.reason }); return; }
      delete data.connected;
      res.status(200).json({ status: 'ok', data: data });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.action === 'copySalaries') {
        const copied = await copySalaries(body.from, body.to);
        if (!copied.connected) { res.status(200).json({ status: 'not_connected', reason: copied.reason }); return; }
        if (copied.invalid) { res.status(400).json({ status: 'error', message: copied.invalid }); return; }
        res.status(201).json({ status: 'ok', data: { created: copied.created, skipped: copied.skipped } });
        return;
      }
      if (!body.payeeName || !body.amount || !body.periodMonth) {
        res.status(400).json({ status: 'error', message: 'payeeName, amount, and periodMonth are required.' });
        return;
      }
      const data = await createTeamPayment(body);
      if (!data.connected) { res.status(200).json({ status: 'not_connected', reason: data.reason }); return; }
      if (data.invalid) { res.status(400).json({ status: 'error', message: data.invalid }); return; }
      res.status(201).json({ status: 'ok', data: { payment: data.payment } });
      return;
    }

    if (req.method === 'PATCH') {
      const id = req.query.id;
      if (!id) { res.status(400).json({ status: 'error', message: 'id query parameter is required, e.g. /api/finance?id=...' }); return; }
      const data = await updateTeamPayment(id, req.body || {});
      if (!data.connected) { res.status(200).json({ status: 'not_connected', reason: data.reason }); return; }
      if (data.invalid) { res.status(400).json({ status: 'error', message: data.invalid }); return; }
      if (data.notFound) { res.status(404).json({ status: 'error', message: 'Payment not found.' }); return; }
      res.status(200).json({ status: 'ok', data: { payment: data.payment } });
      return;
    }

    res.status(405).json({ status: 'error', message: 'Method not allowed. Use GET, POST, or PATCH.' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});
