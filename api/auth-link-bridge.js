const MAX_REQUEST_BYTES = 2048;
const PROVIDER_TIMEOUT_MS = 8000;
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{16,512}$/;

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

function configuredSupabaseOrigin() {
  const raw = process.env.SUPABASE_URL;
  if (!raw || !process.env.SUPABASE_ANON_KEY) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.origin;
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

  const supabaseOrigin = configuredSupabaseOrigin();
  if (!supabaseOrigin) {
    console.error('auth-link-bridge: Supabase public configuration is missing or invalid');
    return failure(res, 503, 'temporarily_unavailable');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(`${supabaseOrigin}/auth/v1/verify`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ token_hash: tokenHash, type: 'email' }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    const accessToken = result?.access_token || result?.session?.access_token;
    const refreshToken = result?.refresh_token || result?.session?.refresh_token;

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
