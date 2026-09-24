const { getGoogleAccessToken } = require('../lib/google-auth');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://omr16552.github.io');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
          res.status(204).end();
          return;
    }

    try {
          const accessToken = await getGoogleAccessToken([
                  'https://www.googleapis.com/auth/calendar.readonly'
                ]);

      const calRes = await fetch(
              'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=10',
        { headers: { Authorization: `Bearer ${accessToken}` } }
            );

      if (!calRes.ok) {
              const details = await calRes.text();
              res.status(502).json({ status: 'error', message: 'Calendar API rejected the request', details });
              return;
      }

      const data = await calRes.json();
          const calendars = data.items || [];

      res.status(200).json({
              status: 'ok',
              service: 'ribahaus-os-api',
              calendar: {
                        connected: true,
                        visibleCalendars: calendars.length,
                        note: calendars.length === 0
                          ? 'Auth works, but no calendars are shared with the service account yet.'
                                    : undefined
              },
              timestamp: new Date().toISOString()
      });
    } catch (err) {
          res.status(500).json({ status: 'error', message: err.message, details: err.details || null });
    }
};
