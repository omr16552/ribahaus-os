// Owner sign-in for the whole API. One shared password (APP_PASSWORD, set in Vercel) is exchanged
// for a signed 7-day token via POST /api/health; every other endpoint is wrapped in withAuth().
// Fails closed: if APP_PASSWORD is not set, protected endpoints answer 503 instead of opening up.
const crypto = require('crypto');

const ALLOWED_ORIGIN = 'https://omr16552.github.io';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function authConfigured() {
  return !!process.env.APP_PASSWORD;
}

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function signingKey() {
  return sha('ribahaus-os-auth:' + process.env.APP_PASSWORD);
}

function passwordMatches(input) {
  if (!authConfigured()) return false;
  return crypto.timingSafeEqual(sha(input), sha(process.env.APP_PASSWORD));
}

function issueToken() {
  const body = Buffer.from(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', signingKey()).update(body).digest('base64url');
  return body + '.' + sig;
}

function verifyToken(token) {
  if (!authConfigured() || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const expected = crypto.createHmac('sha256', signingKey()).update(parts[0]).digest();
  const given = Buffer.from(parts[1], 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    return typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch (err) {
    return false;
  }
}

function bearerToken(req) {
  const header = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const match = /^Bearer (.+)$/.exec(header);
  return match ? match[1] : null;
}

function verifyRequest(req) {
  return verifyToken(bearerToken(req));
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Wraps an API handler: CORS first (the handler's own CORS lines are ignored so they cannot
// narrow the allowed headers), then the preflight answer, then the sign-in check.
function withAuth(handler) {
  return async function (req, res) {
    setCors(res);
    const original = res.setHeader.bind(res);
    res.setHeader = function (name, value) {
      if (/^access-control-/i.test(String(name))) return res;
      return original(name, value);
    };
    original('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (!authConfigured()) {
      res.status(503).json({ status: 'error', message: 'APP_PASSWORD is not set in Vercel yet, so the API is locked.' });
      return;
    }
    if (!verifyRequest(req)) {
      res.status(401).json({ status: 'error', code: 'unauthorized', message: 'Sign in required.' });
      return;
    }
    return handler(req, res);
  };
}

module.exports = { withAuth, setCors, authConfigured, passwordMatches, issueToken, verifyToken, verifyRequest };
