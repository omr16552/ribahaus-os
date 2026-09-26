const { getExpenses, createExpense, updateExpense } = require('../lib/money-expenses');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://omr16552.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    if (req.method === 'GET') {
      const data = await getExpenses();
      if (!data.connected) { res.status(200).json({ status: 'not_connected', reason: data.reason }); return; }
      res.status(200).json({ status: 'ok', data: { expenses: data.expenses, stats: data.stats } });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (!body.vendor || !body.category || !body.amount || !body.expenseDate) {
        res.status(400).json({ status: 'error', message: 'vendor, category, amount, and expenseDate are required.' });
        return;
      }
      const data = await createExpense(body);
      if (!data.connected) { res.status(200).json({ status: 'not_connected', reason: data.reason }); return; }
      res.status(201).json({ status: 'ok', data: { expense: data.expense } });
      return;
    }

    if (req.method === 'PATCH') {
      const id = req.query.id;
      if (!id) { res.status(400).json({ status: 'error', message: 'id query parameter is required, e.g. /api/expenses?id=...' }); return; }
      const data = await updateExpense(id, req.body || {});
      if (!data.connected) { res.status(200).json({ status: 'not_connected', reason: data.reason }); return; }
      if (data.notFound) { res.status(404).json({ status: 'error', message: 'Expense not found.' }); return; }
      res.status(200).json({ status: 'ok', data: { expense: data.expense } });
      return;
    }

    res.status(405).json({ status: 'error', message: 'Method not allowed. Use GET, POST, or PATCH.' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};
