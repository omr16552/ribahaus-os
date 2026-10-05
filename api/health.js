// Public health check, plus the sign-in endpoint:
//   GET  /api/health -> service status, and whether the caller's token is valid
//   POST /api/health -> { password } exchanged for a signed token (7 days)
const { setCors, authConfigured, passwordMatches, issueToken, verifyRequest } = require('../lib/auth');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'POST') {
    if (!authConfigured()) {
      res.status(503).json({ status: 'error', message: 'APP_PASSWORD is not set in Vercel yet.' });
      return;
    }
    const password = req.body && req.body.password;
    if (typeof password !== 'string' || !passwordMatches(password)) {
      await new Promise(function (resolve) { setTimeout(resolve, 600); });
      res.status(401).json({ status: 'error', message: 'Wrong password.' });
      return;
    }
    res.status(200).json({ status: 'ok', data: { token: issueToken(), expiresInDays: 7 } });
    return;
  }

  res.status(200).json({
    status: 'ok',
    service: 'ribahaus-os-api',
    timestamp: new Date().toISOString(),
    authConfigured: authConfigured(),
    authenticated: verifyRequest(req)
  });
};
