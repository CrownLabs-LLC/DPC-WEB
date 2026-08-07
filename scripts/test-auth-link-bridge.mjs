import assert from 'node:assert/strict';
import handler from '../api/auth-link-bridge.js';

const VALID_HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const originalFetch = globalThis.fetch;
const originalUrl = process.env.SUPABASE_URL;
const originalBridgeUrl = process.env.DPC_AUTH_LINK_BRIDGE_URL;
const originalVercelEnvironment = process.env.VERCEL_ENV;

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

async function invoke({ method = 'POST', body, headers = {} } = {}) {
  const req = {
    method,
    body,
    headers: { 'content-type': 'application/json', ...headers },
  };
  const res = responseRecorder();
  await handler(req, res);
  return res;
}

try {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  delete process.env.DPC_AUTH_LINK_BRIDGE_URL;
  delete process.env.VERCEL_ENV;

  {
    let called = false;
    globalThis.fetch = async (url, options) => {
      called = true;
      assert.equal(url, 'https://project.supabase.co/functions/v1/auth-link-bridge');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { token_hash: VALID_HASH });
      return new Response(JSON.stringify({
        success: true,
        data: {
          access_token: 'access.jwt.value',
          refresh_token: 'refresh-value',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const res = await invoke({ body: { token_hash: VALID_HASH } });
    assert.equal(called, true);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      success: true,
      data: { access_token: 'access.jwt.value', refresh_token: 'refresh-value' },
    });
    assert.equal(res.headers['cache-control'], 'no-store, max-age=0');
    assert.equal(res.headers['x-frame-options'], 'DENY');
  }

  {
    let called = false;
    globalThis.fetch = async () => { called = true; };
    const malformed = await invoke({ body: { token_hash: 'too short' } });
    const oversized = await invoke({
      body: { token_hash: VALID_HASH },
      headers: { 'content-length': '3000' },
    });
    const wrongMethod = await invoke({ method: 'GET' });

    assert.equal(malformed.statusCode, 400);
    assert.equal(oversized.statusCode, 413);
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(called, false);
  }

  {
    globalThis.fetch = async () => new Response(JSON.stringify({ msg: 'Token expired' }), { status: 403 });
    const res = await invoke({ body: { token_hash: VALID_HASH } });
    const serialized = JSON.stringify(res.body);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { success: false, error: { code: 'link_invalid' } });
    assert.equal(serialized.includes(VALID_HASH), false);
    assert.equal(serialized.includes('Token expired'), false);
  }

  {
    delete process.env.SUPABASE_URL;
    process.env.VERCEL_ENV = 'preview';
    globalThis.fetch = async (url) => {
      assert.equal(url, 'https://hohbsqkmrlhkstojfdgx.supabase.co/functions/v1/auth-link-bridge');
      return new Response(JSON.stringify({ success: false, error: { code: 'link_invalid' } }), { status: 400 });
    };
    const res = await invoke({ body: { token_hash: VALID_HASH } });
    assert.equal(res.statusCode, 400);
  }

  {
    delete process.env.SUPABASE_URL;
    delete process.env.VERCEL_ENV;
    const res = await invoke({ body: { token_hash: VALID_HASH } });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { success: false, error: { code: 'temporarily_unavailable' } });
  }

  console.log('auth-link-bridge tests passed');
} finally {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalBridgeUrl === undefined) delete process.env.DPC_AUTH_LINK_BRIDGE_URL;
  else process.env.DPC_AUTH_LINK_BRIDGE_URL = originalBridgeUrl;
  if (originalVercelEnvironment === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnvironment;
}
