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
                      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

            const eventsRes = await fetch(
                          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?maxResults=5&orderBy=startTime&singleEvents=true&timeMin=${now.toISOString()}`,
                    { headers: { Authorization: `Bearer ${accessToken}` } }
                        );

            if (eventsRes.ok) {
                          const data = await eventsRes.json();
                          const events = data.items || [];
                          const first = events[0];
                          const response = {
                                          status: 'ok',
                                          service: 'ribahaus-os-api',
                                          calendar: {
                                                            connected: true,
                                                            accessLevel: 'full-event-details',
                                                            calendarId,
                                                            upcomingEventCount: events.length,
                                                            nextEvent: first ? {
                                                                                title: first.summary || null,
                                                                                start: first.start,
                                                                                visibility: first.visibility || 'default',
                                                                                note: first.summary ? undefined : 'Title hidden: this event is marked private, and the service account only has calendar-level reader access (not an attendee/organizer).'
                                                            } : null
                                          },
                                          timestamp: new Date().toISOString()
                          };
                          if (debug) {
                                          response.debugRawFirstEvent = first || null;
                          }
                          res.status(200).json(response);
                          return;
            }

            if (eventsRes.status === 403) {
                          const fbRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
                                          method: 'POST',
                                          headers: {
                                                            Authorization: `Bearer ${accessToken}`,
                                                            'Content-Type': 'application/json'
                                          },
                                          body: JSON.stringify({
                                                            timeMin: now.toISOString(),
                                                            timeMax: in7Days.toISOString(),
                                                            items: [{ id: calendarId }]
                                          })
                          });

                        if (fbRes.ok) {
                                        const fbData = await fbRes.json();
                                        const cal = fbData.calendars && fbData.calendars[calendarId];
                                        const busy = (cal && cal.busy) || [];
                                        res.status(200).json({
                                                          status: 'ok',
                                                          service: 'ribahaus-os-api',
                                                          calendar: {
                                                                              connected: true,
                                                                              accessLevel: 'free-busy-only',
                                                                              calendarId,
                                                                              busyBlocksNext7Days: busy.length,
                                                                              note: 'Shared as "See only free/busy" in Google Calendar. Upgrade to "See all event details" in that calendar\'s sharing settings for titles and full data.'
                                                          },
                                                          timestamp: new Date().toISOString()
                                        });
                                        return;
                        }
            }

            const details = await eventsRes.text();
                      res.status(502).json({ status: 'error', message: 'Calendar API rejected the request', calendarId, details });
          } catch (err) {
                      res.status(500).json({ status: 'error', message: err.message, details: err.details || null });
          }
};
