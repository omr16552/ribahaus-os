const { getNotionStatus, listDriveFolder, listCalendarEvents } = require('../lib/agent-tools');

const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_TOOL_ITERATIONS = 5;

const SYSTEM_PROMPT = [
    'You are the RibaHaus OS assistant, embedded as a chat command box inside Omar\'s internal agency dashboard for Riba Haus.',
    'You have read-only access to three connected tools: Notion status, Google Drive (the RibaHaus OS folder), and Google Calendar (hello@ribahaus.com).',
    'Important limitations to keep in mind and mention when relevant:',
    '- Notion: the integration connection is verified, but no actual Notion pages (Central Tasks, Sales CRM, content calendars) have been shared with it yet, so you cannot read their content yet.',
    '- Calendar: some events are marked private in Google Calendar. For those, the event title and description are hidden from you even though you can see that the event exists and when it occurs.',
    'Be concise and direct. When you use a tool, base your answer only on what it actually returns - never guess or invent data. If something is not accessible, say so plainly and explain why.'
  ].join('\n');

const TOOLS = [
  {
        name: 'get_notion_status',
        description: 'Check whether the Notion integration is connected and what it can currently read.',
        input_schema: {
                type: 'object',
                properties: {}
        }
  },
  {
        name: 'list_drive_folder',
        description: 'List files inside a Google Drive folder in the RibaHaus OS workspace. Defaults to the root RibaHaus OS folder if no folderId is given.',
        input_schema: {
                type: 'object',
                properties: {
                          folderId: { type: 'string', description: 'Optional Google Drive folder ID. Omit to list the root RibaHaus OS folder.' }
                }
        }
  },
  {
        name: 'list_calendar_events',
        description: 'List upcoming events on a Google Calendar. Defaults to hello@ribahaus.com if no calendarId is given.',
        input_schema: {
                type: 'object',
                properties: {
                          calendarId: { type: 'string', description: 'Optional calendar ID. Omit to use the default RibaHaus calendar.' },
                          maxResults: { type: 'number', description: 'Optional max number of events to return (default 5).' }
                }
        }
  }
  ];

async function executeTool(name, input) {
    if (name === 'get_notion_status') {
          return await getNotionStatus();
    }
    if (name === 'list_drive_folder') {
          return await listDriveFolder(input && input.folderId);
    }
    if (name === 'list_calendar_events') {
          return await listCalendarEvents(input && input.calendarId, input && input.maxResults);
    }
    return { error: 'Unknown tool: ' + name };
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://omr16552.github.io');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
          res.status(204).end();
          return;
    }

    if (req.method !== 'POST') {
          res.status(405).json({ status: 'error', message: 'Method not allowed. Use POST.' });
          return;
    }

    try {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey) {
                  res.status(500).json({ status: 'error', message: 'ANTHROPIC_API_KEY is not set' });
                  return;
          }

      const body = req.body || {};
          const message = body.message;
          const history = Array.isArray(body.history) ? body.history : [];

      if (!message || typeof message !== 'string') {
              res.status(400).json({ status: 'error', message: 'Request body must include a non-empty "message" string.' });
              return;
      }

      const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
          const messages = history.concat([{ role: 'user', content: message }]);

      let iterations = 0;
          let finalText = null;

      while (iterations < MAX_TOOL_ITERATIONS) {
              iterations += 1;

            const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
                      method: 'POST',
                      headers: {
                                  'Content-Type': 'application/json',
                                  'x-api-key': apiKey,
                                  'anthropic-version': '2023-06-01'
                      },
                      body: JSON.stringify({
                                  model: model,
                                  max_tokens: 1024,
                                  system: SYSTEM_PROMPT,
                                  tools: TOOLS,
                                  messages: messages
                      })
            });

            const data = await anthropicRes.json();

            if (!anthropicRes.ok) {
                      res.status(502).json({ status: 'error', message: 'Anthropic API rejected the request', details: data });
                      return;
            }

            messages.push({ role: 'assistant', content: data.content });

            if (data.stop_reason === 'tool_use') {
                      const toolResults = [];
                      for (const block of data.content) {
                                  if (block.type === 'tool_use') {
                                                let result;
                                                try {
                                                                result = await executeTool(block.name, block.input);
                                                } catch (toolErr) {
                                                                result = { error: toolErr.message };
                                                }
                                                toolResults.push({
                                                                type: 'tool_result',
                                                                tool_use_id: block.id,
                                                                content: JSON.stringify(result)
                                                });
                                  }
                      }
                      messages.push({ role: 'user', content: toolResults });
                      continue;
            }

            const textBlock = (data.content || []).find(function (b) { return b.type === 'text'; });
              finalText = textBlock ? textBlock.text : '';
              break;
      }

      if (finalText === null) {
              finalText = 'I was not able to finish that request within the allowed number of steps. Please try rephrasing or asking a narrower question.';
      }

      res.status(200).json({ status: 'ok', reply: finalText, history: messages });
    } catch (err) {
          res.status(500).json({ status: 'error', message: err.message, details: err.details || null });
    }
};
