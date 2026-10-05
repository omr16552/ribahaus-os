// Notion tasks dashboard API (the project is at Vercel's Hobby function count, so this file
// replaces api/notion-status.js).
//   GET  /api/tasks               -> tasks from the Notion databases chosen in settings
//   GET  /api/tasks?view=sources  -> Notion databases the integration can see + current choice
//   POST /api/tasks               -> { sourceIds: [...] } saves which databases to read
const { getTasks, listSources, saveSelectedIds } = require('../lib/notion-tasks');
const { withAuth } = require('../lib/auth');

module.exports = withAuth(async (req, res) => {
  try {
    if (req.method === 'GET') {
      if (req.query && req.query.view === 'sources') {
        const data = await listSources();
        if (!data.connected) { res.status(200).json({ status: 'not_connected', reason: data.reason }); return; }
        res.status(200).json({ status: 'ok', data: { sources: data.sources, selected: data.selected } });
        return;
      }
      const data = await getTasks();
      if (!data.connected) { res.status(200).json({ status: 'not_connected', reason: data.reason }); return; }
      delete data.connected;
      res.status(200).json({ status: 'ok', data: data });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const saved = await saveSelectedIds(body.sourceIds);
      if (!saved.connected) { res.status(200).json({ status: 'not_connected', reason: saved.reason }); return; }
      if (saved.invalid) { res.status(400).json({ status: 'error', message: saved.invalid }); return; }
      res.status(200).json({ status: 'ok', data: { selected: saved.ids } });
      return;
    }

    res.status(405).json({ status: 'error', message: 'Method not allowed. Use GET or POST.' });
  } catch (err) {
    const status = err.status === 401 ? 502 : 500;
    res.status(status).json({ status: 'error', message: err.status ? 'Notion rejected the request (' + err.status + ').' : err.message });
  }
});
