const crypto = require('crypto');

function base64url(input) {
    return Buffer.from(input)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
}

async function getGoogleAccessToken(scopes) {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !rawKey) {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY is not set');
  }

  const privateKey = rawKey.replace(/\\n/g, '\n');
    const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
          iss: clientEmail,
          scope: scopes.join(' '),
          aud: 'https://oauth2.googleapis.com/token',
          iat: now,
          exp: now + 3600
    };

  const unsigned = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claims));

  const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsigned);
    signer.end();
    const signature = signer.sign(privateKey)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const jwt = unsigned + '.' + signature;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: jwt
        })
  });

  const data = await tokenRes.json();

  if (!tokenRes.ok) {
        const err = new Error(data.error_description || data.error || 'Failed to obtain Google access token');
        err.details = data;
        throw err;
  }

  return data.access_token;
}

module.exports = { getGoogleAccessToken };
