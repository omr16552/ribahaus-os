const { getGoogleAccessToken } = require('../lib/google-auth');

const RIBAHAUS_OS_FOLDER_ID = '1PSbMFTrPx7NKyKpgNEGbwgubHSZpYCqJ';

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://omr16552.github.io');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
          res.status(204).end();
          return;
    }

    try {
          const accessToken = await getGoogleAccessToken([
                  'https://www.googleapis.com/auth/drive.readonly'
                ]);

      const driveRes = await fetch(
              `https://www.googleapis.com/drive/v3/files/${RIBAHAUS_OS_FOLDER_ID}?fields=id,name,webViewLink`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
            );

      if (!driveRes.ok) {
              const details = await driveRes.text();
              res.status(502).json({ status: 'error', message: 'Drive API rejected the request', details });
              return;
      }

      const folder = await driveRes.json();

      res.status(200).json({
              status: 'ok',
              service: 'ribahaus-os-api',
              drive: {
                        connected: true,
                        baseFolder: folder.name,
                        folderId: folder.id,
                        link: folder.webViewLink
              },
              timestamp: new Date().toISOString()
      });
    } catch (err) {
          res.status(500).json({ status: 'error', message: err.message, details: err.details || null });
    }
};
