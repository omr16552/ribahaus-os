// redeploy trigger: pick up latest NOTION_API_KEY
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://omr16552.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const token = process.env.NOTION_API_KEY;
  if (!token) {
    res.status(500).json({ status: 'error', message: 'NOTION_API_KEY is not set' });
    return;
  }

  try {
    const notionRes = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28'
      }
    });

    if (!notionRes.ok) {
      const details = await notionRes.text();
      res.status(502).json({ status: 'error', message: 'Notion API rejected the request', details });
      return;
    }

    const data = await notionRes.json();
    res.status(200).json({
      status: 'ok',
      service: 'ribahaus-os-api',
      notion: {
        connected: true,
        botName: data.name || 'unknown',
        type: data.type || 'unknown'
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};
