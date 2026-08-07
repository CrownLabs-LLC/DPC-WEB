const MAX_REQUEST_BYTES = 2048;
const PROVIDER_TIMEOUT_MS = 8000;
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{16,512}$/;
// The urgent member-access lane is temporarily running from a stable Vercel
// branch alias. Preview deployments do not inherit production environment
// variables, so this public (non-secret) URL keeps that alias on production.
// Once /auth is merged to the canonical website, production uses SUPABASE_URL.
const TEMPORARY_PREVIEW_VERIFIER_URL = 'https://ebiuspbgzggrdiaswpcc.supabase.co/functions/v1/auth-link-bridge';

function setSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
}

function failure(res, status = 400, code = 'link_invalid') {
  return res.status(status).json({ success: false, error: { code } });
}

function requestBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body);
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
  return req.body;
}

function verificationEndpoint() {
  const raw = process.env.DPC_AUTH_LINK_BRIDGE_URL
    || (process.env.VERCEL_ENV === 'preview' ? TEMPORARY_PREVIEW_VERIFIER_URL : null)
    || (process.env.SUPABASE_URL
      ? `${process.env.SUPABASE_URL.replace(/\/$/, '')}/functions/v1/auth-link-bridge`
      : null);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return failure(res, 405, 'invalid_request');
  }

  const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') return failure(res, 415, 'invalid_request');

  const declaredLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return failure(res, 413, 'invalid_request');
  }

  let body;
  try {
    body = requestBody(req);
  } catch {
    return failure(res, 400, 'invalid_request');
  }

  const tokenHash = body?.token_hash;
  if (typeof tokenHash !== 'string'
      || tokenHash !== tokenHash.trim()
      || !TOKEN_HASH_PATTERN.test(tokenHash)
      || Buffer.byteLength(JSON.stringify(body || {}), 'utf8') > MAX_REQUEST_BYTES) {
    return failure(res);
  }

  const endpoint = verificationEndpoint();
  if (!endpoint) {
    console.error('auth-link-bridge: verification endpoint is missing or invalid');
    return failure(res, 503, 'temporarily_unavailable');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ token_hash: tokenHash }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    const accessToken = result?.data?.access_token || result?.access_token || result?.session?.access_token;
    const refreshToken = result?.data?.refresh_token || result?.refresh_token || result?.session?.refresh_token;

    if (!response.ok || !accessToken || !refreshToken) return failure(res);

    return res.status(200).json({
      success: true,
      data: { access_token: accessToken, refresh_token: refreshToken },
    });
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.error('auth-link-bridge: token verification provider request failed');
    }
    return failure(res, error?.name === 'AbortError' ? 504 : 400, 'link_invalid');
  } finally {
    clearTimeout(timeout);
  }
}
