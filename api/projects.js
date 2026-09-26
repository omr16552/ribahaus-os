const { getProjects } = require('../lib/notion-projects');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://omr16552.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ status: 'error', message: 'Method not allowed. Use GET.' }); return; }

  try {
    const data = await getProjects();
    if (!data.connected) {
      res.status(200).json({ status: 'not_connected', reason: data.reason });
      return;
    }
    res.status(200).json({ status: 'ok', data: data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};
