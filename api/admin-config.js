/**
 * Bootstrap config for the /admin/support dashboard.
 *
 * The dashboard signs in against Supabase Auth from the browser, so it needs
 * the project URL and the anon (publishable) key. Serving them from env vars
 * rather than hardcoding them in the page means pointing the dashboard at a
 * different project is a Vercel config change, not a code change.
 *
 * The anon key is safe to expose. The service-role key is not — it bypasses
 * RLS entirely, so `assertNotSecretKey` refuses to serve anything that looks
 * like one rather than leaking it to every visitor.
 */

const ADMIN_SUPABASE_URL = () => process.env.ADMIN_SUPABASE_URL || process.env.SUPABASE_URL || '';
const ADMIN_SUPABASE_ANON_KEY = () =>
  process.env.ADMIN_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

// Supabase issues two key generations: legacy JWTs carrying a `role` claim,
// and `sb_publishable_*` / `sb_secret_*` prefixed keys. Detect the privileged
// variant of both.
export function looksLikeSecretKey(key) {
  // Env pastes commonly pick up leading/trailing whitespace; classify the
  // trimmed value so a spaced service-role key can't slip past the guard.
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) return false;
  if (trimmed.startsWith('sb_secret_')) return true;
  const segments = trimmed.split('.');
  if (segments.length !== 3) return false;
  try {
    const claims = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
    return claims.role === 'service_role';
  } catch {
    return false;
  }
}

export function projectRefFrom(url) {
  const match = /^https?:\/\/([a-z0-9-]+)\.supabase\./i.exec(url || '');
  return match ? match[1] : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ configured: false, reason: 'method_not_allowed' });
  }

  const supabaseUrl = ADMIN_SUPABASE_URL().trim();
  const supabaseAnonKey = ADMIN_SUPABASE_ANON_KEY().trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(200).json({ configured: false, reason: 'missing_env' });
  }

  if (looksLikeSecretKey(supabaseAnonKey)) {
    console.error(
      'admin-config: refusing to serve ADMIN_SUPABASE_ANON_KEY — it looks like a service-role/secret key, which must never reach the browser.',
    );
    return res.status(200).json({ configured: false, reason: 'service_role_key_refused' });
  }

  return res.status(200).json({
    configured: true,
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    supabaseAnonKey,
    projectRef: projectRefFrom(supabaseUrl),
  });
}
