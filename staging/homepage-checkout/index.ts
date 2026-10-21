// Staging QA entrypoint, assembled with the unchanged reviewed billing files
// recorded in source-manifest.json. Never deploy to the production project.
// @ts-nocheck -- Deno/Supabase entrypoint.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0';
import { createCircleCheckoutHandler } from './billing/circleCheckout.ts';
import { createCircleCheckoutRuntimeDeps, loadCircleCheckoutRuntimeConfig } from './billing/circleCheckoutRuntime.ts';
import { assertStagingConfiguration, allowedFixture } from './preview-policy.mjs';

const config = loadCircleCheckoutRuntimeConfig('staging', name => Deno.env.get(name));
const projectUrl = Deno.env.get('SUPABASE_URL');
const origin = assertStagingConfiguration(projectUrl, config, Deno.env.get('DPC_HOMEPAGE_PREVIEW_ORIGIN'));
const client = createClient(projectUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const handler = createCircleCheckoutHandler(createCircleCheckoutRuntimeDeps({
  client,
  config: {
    ...config,
    successUrl: `${origin}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}/subscription-cancelled`,
  },
  enabled: true,
  optionalKitEnabled: true,
  logError(message, error) { console.error(message, error instanceof Error ? error.message : 'unknown_error'); },
}));
const headers = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'content-type, authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
  'Vary': 'Origin',
};
Deno.serve(async request => {
  if (request.method === 'GET') {
    return new Response(JSON.stringify({ environment: 'staging', stripeMode: 'test',
      optionalKitEnabled: true, returnOrigin: origin, syntheticIdentitiesOnly: true }), { headers });
  }
  if (request.headers.get('origin') !== origin) {
    return new Response(JSON.stringify({ success: false, error: { code: 'PREVIEW_ORIGIN_REQUIRED' } }), { status: 403, headers });
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers });
  let body;
  try { body = await request.clone().json(); }
  catch { return new Response(null, { status: 400, headers }); }
  if (!allowedFixture(request.headers.get('origin'), origin, body?.email)) {
    return new Response(JSON.stringify({ success: false, error: { code: 'SYNTHETIC_QA_IDENTITY_REQUIRED' } }), { status: 403, headers });
  }
  const response = await handler(request);
  const responseHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value);
  return new Response(response.body, { status: response.status, headers: responseHeaders });
});
