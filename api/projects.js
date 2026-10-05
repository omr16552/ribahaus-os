// Projects API, backed by Postgres.
//   GET   /api/projects         -> all projects
//   POST  /api/projects         -> add a project
//   PATCH /api/projects?id=...  -> update one
const { getProjects, createProject, updateProject } = require('../lib/crm-projects');
const { withAuth } = require('../lib/auth');

module.exports = withAuth(async (req, res) => {
  try {
    if (req.method === 'GET') {
      const data = await getProjects();
      if (!data.connected) { res.status(200).json({ status: 'not_connected', reason: data.reason }); return; }
      res.status(200).json({ status: 'ok', data: data });
      return;
    }

    if (req.method === 'POST') {
      const data = await createProject(req.body || {});
      if (!data.connected) { res.status(200).json({ status: 'not_connected', reason: data.reason }); return; }
      if (data.invalid) { res.status(400).json({ status: 'error', message: data.invalid }); return; }
      res.status(201).json({ status: 'ok', data: { project: data.project } });
      return;
    }

    if (req.method === 'PATCH') {
      const id = req.query.id;
      if (!id) { res.status(400).json({ status: 'error', message: 'id query parameter is required, e.g. /api/projects?id=...' }); return; }
      const data = await updateProject(id, req.body || {});
      if (!data.connected) { res.status(200).json({ status: 'not_connected', reason: data.reason }); return; }
      if (data.notFound) { res.status(404).json({ status: 'error', message: 'Project not found.' }); return; }
      if (data.invalid) { res.status(400).json({ status: 'error', message: data.invalid }); return; }
      res.status(200).json({ status: 'ok', data: { project: data.project } });
      return;
    }

    res.status(405).json({ status: 'error', message: 'Method not allowed. Use GET, POST, or PATCH.' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});
