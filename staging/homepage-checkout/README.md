# Homepage preview checkout harness

This isolated entrypoint supports the authorized October 20 Home/Events/Join
preview. It is not a production billing implementation or a general signup URL.

- Deploy only as `circle-checkout-homepage-preview` in `dpc-staging`
  (`hohbsqkmrlhkstojfdgx`). The runtime rejects a different Supabase URL,
  production Stripe key, or non-test Turnstile mode before serving checkout.
- `DPC_HOMEPAGE_PREVIEW_ORIGIN` must be the exact approved Vercel preview origin.
  POST requests require that Origin and an email matching
  `dpc-homepage-qa-20261020-<unique-label>@example.com`.
- It reuses the unchanged, checksum-pinned billing source listed in
  `source-manifest.json`, independently compared against reviewed DPC commit
  `7bd9142abea342deb9063f22397a8ca7e084a8e1`.
- Only the QA entrypoint differs: sandbox guards, synthetic-identity restriction,
  exact-origin CORS, and success/cancel return URLs on the preview. Existing
  staging functions and all production functions remain unchanged.
- All normal checkout validation, Turnstile verification, legal-version checks,
  Stripe test prices, rate limits and idempotency remain in the billing handler.
- GET reports non-secret environment/readiness information. It creates nothing.

To assemble, obtain the recorded staging source with Supabase's read-only
`get_edge_function` or function download operation, then run:

```sh
node scripts/prepare-homepage-staging.mjs /path/to/source-export.json /tmp/dpc-homepage-preview-runtime
node scripts/test-homepage-staging-policy.mjs
deno check /tmp/dpc-homepage-preview-runtime/index.ts
```

The export may be the `{files:[...]}` object or its files array. Assembly rejects
any source mismatch. Never add generated billing copies or credentials to this
repository. Deploy the assembled files with `index.ts` as the entrypoint;
`verify_jwt=false` preserves the existing public checkout transport, with
Turnstile verification plus the stricter QA guards in the handler. Do not alter
production JWT, CORS, security or payment configuration.

Configure the web branch's Vercel **Preview** variables only:
`SUPABASE_URL=https://hohbsqkmrlhkstojfdgx.supabase.co` and the existing staging
`SUPABASE_SERVICE_ROLE_KEY` as a server-only sensitive variable. Never expose
that key in client HTML, logs or Git. Preview legal lookup rejects a live URL.

The existing reviewed Privacy 4.9 data migration was applied to staging under
its original version `20260918210346`; both 4.2 and 4.9 remain valid for existing
member access. No production legal version or member record changed.

The verification scope is opening Stripe test checkout, six plan/amount checks,
kit add/remove, and return/retry behavior. Do not enter real personal/payment
data or complete a real payment. Retain prior accepted paid sandbox evidence;
this harness does not change onboarding or webhook behavior.
