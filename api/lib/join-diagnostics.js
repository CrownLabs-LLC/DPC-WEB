// Explicit projection on both write and read. Never persist arbitrary error
// messages, response bodies, URLs, tokens, browser fingerprints, or identities.
const ENUMS = {
  component: ['legal_versions', 'turnstile', 'checkout'],
  stage: ['initial_load', 'submit_check', 'post_rejection', 'retry', 'script_load', 'options', 'validation', 'join_page'],
  failure_kind: ['timeout', 'network', 'http', 'invalid_json', 'incomplete_tuple', 'configuration', 'rpc', 'script_timeout', 'script_error', 'widget_error', 'render_exception', 'unknown'],
  outcome: ['retry_started', 'recovered'],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (['INVALID_REQUEST', 'CHECKOUT_NOT_ENABLED', 'BOOT_ERROR', 'WORKER_LIMIT', 'PGRST202', '42501', 'P0001'].includes(value.body_code)) {
    out.body_code = value.body_code;
  }
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
