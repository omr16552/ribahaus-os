const { getGoogleAccessToken } = require('./google-auth');

const RIBAHAUS_OS_FOLDER_ID = '1PSbMFTrPx7NKyKpgNEGbwgubHSZpYCqJ';
const DEFAULT_CALENDAR_ID = 'hello@ribahaus.com';

async function getNotionStatus() {
    const token = process.env.NOTION_API_KEY;
    if (!token) {
          return { connected: false, reason: 'NOTION_API_KEY is not set' };
    }

  const res = await fetch('https://api.notion.com/v1/users/me', {
        headers: {
                Authorization: `Bearer ${token}`,
                'Notion-Version': '2022-06-28'
        }
  });

  if (!res.ok) {
        return { connected: false, reason: 'Notion API rejected the request' };
  }

  const data = await res.json();
    return {
          connected: true,
          botName: data.name || 'unknown',
          note: 'Connection is verified, but no Notion pages (Central Tasks, Sales CRM, content calendars) have been shared with this integration yet, so their content cannot be read.'
    };
}

async function listDriveFolder(folderId) {
    const targetFolderId = folderId || RIBAHAUS_OS_FOLDER_ID;
    const accessToken = await getGoogleAccessToken([
          'https://www.googleapis.com/auth/drive.readonly'
        ]);

  const url = `https://www.googleapis.com/drive/v3/files?q=%27${targetFolderId}%27+in+parents+and+trashed=false&fields=files(id,name,mimeType,modifiedTime)&pageSize=50`;

  const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!res.ok) {
        const details = await res.text();
        throw new Error('Drive API error: ' + details);
  }

  const data = await res.json();
    return { folderId: targetFolderId, files: data.files || [] };
}

async function listCalendarEvents(calendarId, maxResults) {
    const targetCalendarId = calendarId || DEFAULT_CALENDAR_ID;
    const limit = maxResults || 5;
    const accessToken = await getGoogleAccessToken([
          'https://www.googleapis.com/auth/calendar.readonly'
        ]);

  const now = new Date().toISOString();
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events?maxResults=${limit}&orderBy=startTime&singleEvents=true&timeMin=${now}`;

  const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!res.ok) {
        if (res.status === 403) {
                return { calendarId: targetCalendarId, accessLevel: 'denied-or-freebusy-only', events: [] };
        }
        const details = await res.text();
        throw new Error('Calendar API error: ' + details);
  }

  const data = await res.json();
    const events = (data.items || []).map(function (e) {
          return {
                  title: e.summary || (e.visibility === 'private' ? '(private event, title hidden)' : '(untitled)'),
                  start: e.start,
                  end: e.end,
                  visibility: e.visibility || 'default'
          };
    });

  return { calendarId: targetCalendarId, accessLevel: 'full', events: events };
}

module.exports = { getNotionStatus, listDriveFolder, listCalendarEvents, RIBAHAUS_OS_FOLDER_ID, DEFAULT_CALENDAR_ID };
