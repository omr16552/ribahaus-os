const { getSalesCRM } = require('../lib/notion-crm');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://omr16552.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ status: 'error', message: 'Method not allowed. Use GET.' }); return; }

  try {
    const crm = await getSalesCRM();
    if (!crm.connected) {
      res.status(200).json({ status: 'not_connected', reason: crm.reason });
      return;
    }
    res.status(200).json({ status: 'ok', data: crm });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};
