const { getGoogleAccessToken } = require('../lib/google-auth');

const DEFAULT_CALENDAR_ID = 'hello@ribahaus.com';

module.exports = async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', 'https://omr16552.github.io');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

        if (req.method === 'OPTIONS') {
                  res.status(204).end();
                  return;
        }

        try {
                  const { searchParams } = new URL(req.url, 'http://localhost');
                  const calendarId = searchParams.get('calendarId') || DEFAULT_CALENDAR_ID;
                  const debug = searchParams.get('debug') === '1';

          const accessToken = await getGoogleAccessToken([
                      'https://www.googleapis.com/auth/calendar.readonly'
                    ]);

          const now = new Date();

          const eventsRes = await fetch(
                      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?maxResults=5&orderBy=startTime&singleEvents=true&timeMin=${now.toISOString()}`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
                    );

          if (eventsRes.ok) {
                      const data = await eventsRes.json();
                      const events = data.items || [];
                      const response = {
                                    status: 'ok',
                                    service: 'ribahaus-os-api',
                                    calendar: {
                                                    connected: true,
                                                    accessLevel: 'full-event-details',
                                                    calendarId,
                                                    upcomingEventCount: events.length,
                                                    nextEvent: events[0] ? { title: events[0].summary, start: events[0].start } : null
                                    },
                                    timestamp: new Date().toISOString()
                      };
                      if (debug) {
                                    response.debugRawFirstEvent = events[0] || null;
                      }
                      res.status(200).json(response);
                      return;
          }

          const details = await eventsRes.text();
                  res.status(502).json({ status: 'error', message: 'Calendar API rejected the request', calendarId, details });
        } catch (err) {
                  res.status(500).json({ status: 'error', message: err.message, details: err.details || null });
        }
};
