// Explicit projection on both write and read. Never persist arbitrary error
// messages, response bodies, URLs, tokens, browser fingerprints, or identities.
const ENUMS = {
  component: ['legal_versions', 'turnstile', 'checkout'],
  stage: ['initial_load', 'submit_check', 'post_rejection', 'retry', 'script_load', 'options', 'validation', 'join_page'],
  failure_kind: ['timeout', 'network', 'http', 'invalid_json', 'incomplete_tuple', 'configuration', 'rpc', 'script_timeout', 'script_error', 'widget_error', 'render_exception', 'unknown'],
  outcome: ['retry_started', 'recovered'],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// PostgREST (including its X/internal group), SQLSTATE, and bounded symbolic
// machine codes. Do not enumerate failures: newly surfaced codes are evidence.
const BODY_CODE = /^(?:PGRST(?:\d{3}|X\d{2})|[0-9A-Z]{5}|[A-Z_]{3,40})$/;

export function sanitizeDiagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (allowed.includes(value[key])) out[key] = value[key];
  }
  for (const key of ['episode_id', 'request_id', 'provider_request_id', 'execution_id']) {
    if (typeof value[key] === 'string' && UUID.test(value[key])) out[key] = value[key].toLowerCase();
  }
  for (const [key, min, max] of [['elapsed_ms', 0, 600000], ['attempt', 1, 100], ['http_status', 100, 599]]) {
    if (Number.isInteger(value[key]) && value[key] >= min && value[key] <= max) out[key] = value[key];
  }
  if (typeof value.provider_code === 'string' && /^\d{6}$/.test(value.provider_code)) {
    out.provider_code = value.provider_code;
  }
  if (typeof value.body_code === 'string' && BODY_CODE.test(value.body_code)) {
    out.body_code = value.body_code;
  }
  // P0001 is generic RAISE. Keep this known business reason separately,
  // without accepting arbitrary message text or arbitrary snake_case values.
  if (value.rpc_reason === 'legal_currentness_unavailable') out.rpc_reason = value.rpc_reason;
  return Object.keys(out).length ? out : null;
}

export function responseDiagnostics(response) {
  return sanitizeDiagnostics({
    http_status: response.status,
    request_id: response.headers.get('x-dpc-request-id'),
    provider_request_id: response.headers.get('sb-request-id'),
    execution_id: response.headers.get('x-deno-execution-id'),
  });
}
