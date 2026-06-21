#!/usr/bin/env node
/**
 * Local Stripe webhook smoke test (no `vercel login` required).
 * Usage: node scripts/test-stripe-webhook.mjs
 */
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import handler from '../api/stripe-webhook.js';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

function wrapRes(res, onJson) {
  let statusCode = 200;
  const api = {
    status(code) {
      statusCode = code;
      res.statusCode = code;
      return api;
    },
    setHeader(k, v) {
      res.setHeader(k, v);
      return api;
    },
    json(body) {
      if (!res.headersSent) res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
      onJson(statusCode, body);
      return api;
    },
  };
  return api;
}

function run(cmd, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', reject);
  });
}

const whsecResult = await run('stripe', ['listen', '--print-secret']);
if (whsecResult.code !== 0) {
  console.error('stripe listen --print-secret failed. Is Stripe CLI installed and logged in?');
  process.stderr.write(whsecResult.stderr);
  process.exit(1);
}
process.env.STRIPE_WEBHOOK_SECRET = whsecResult.stdout.trim();

if (!process.env.STRIPE_SECRET_KEY) {
  const listResult = await run('stripe', ['config', '--list']);
  if (listResult.code === 0) {
    const match = listResult.stdout.match(/test_mode_api_key = '([^']+)'/);
    if (match?.[1]) {
      process.env.STRIPE_SECRET_KEY = match[1];
      console.log('Using Stripe test_mode_api_key from Stripe CLI config');
    }
  }
}

const required = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('Missing env vars:', missing.join(', '));
  console.error('Add them to .env or run: stripe login');
  process.exit(1);
}

let handlerStatus = null;
let handlerBody = null;

const server = http.createServer((req, res) => {
  if (req.url !== '/api/stripe-webhook') {
    res.writeHead(404);
    return res.end('not found');
  }
  handler(req, wrapRes(res, (status, body) => {
    handlerStatus = status;
    handlerBody = body;
    console.log(`handler responded ${status}:`, JSON.stringify(body));
  }));
});

await new Promise((resolve) => server.listen(3000, resolve));
console.log('Webhook server listening on http://localhost:3000/api/stripe-webhook');

const listenLog = [];
const listen = spawn(
  'stripe',
  ['listen', '--forward-to', 'localhost:3000/api/stripe-webhook', '--events', 'checkout.session.completed'],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);
listen.stderr.on('data', (chunk) => {
  for (const line of chunk.toString().split('\n')) {
    if (line.trim()) listenLog.push(line);
  }
});

await new Promise((r) => setTimeout(r, 4000));
const ready = listenLog.some((l) => l.includes('Ready!'));
if (!ready) {
  console.error('stripe listen did not become ready in time');
  listen.kill();
  server.close();
  process.exit(1);
}

console.log('stripe listen ready — triggering checkout.session.completed...');
const trigger = await run('stripe', ['trigger', 'checkout.session.completed']);
if (trigger.stdout.trim()) console.log(trigger.stdout.trim());
if (trigger.code !== 0) {
  process.stderr.write(trigger.stderr);
  listen.kill();
  server.close();
  process.exit(trigger.code);
}

await new Promise((r) => setTimeout(r, 6000));

const forwardLines = listenLog.filter((l) => l.includes('checkout.session.completed') || /\[(200|400|500)\]/.test(l));
for (const line of forwardLines) console.log(line);

const logText = listenLog.join('\n');
if (/\[400\].*Invalid signature/i.test(logText) || (/\[400\]/.test(logText) && /signature/i.test(logText))) {
  console.error('\nFAIL: 400 Invalid signature — raw body / bodyParser fix not working.');
  process.exitCode = 1;
} else if (handlerStatus === 200 || /\[200\]/.test(logText)) {
  console.log('\nPASS: Event forwarded; handler returned 200 (signature verification OK).');
  if (handlerBody?.skipped === 'not_founding_deposit') {
    console.log('Note: stripe trigger uses a $30 fixture session — skipped as expected.');
    console.log('For full E2E, complete a real $49 Payment Link with product_type=founding_deposit.');
  }
} else if (handlerStatus === 500 || /\[500\]/.test(logText)) {
  console.log('\nPARTIAL: Signature OK (not 400), handler returned 500.');
  console.log('Likely missing RESEND_FOUNDING_AUDIENCE_ID or downstream API error — not a signature/bodyParser issue.');
} else if (/\[ERROR\]/.test(logText)) {
  console.error('\nFAIL: stripe listen could not reach localhost:3000');
  process.exitCode = 1;
} else {
  console.log('\nNo clear result — check output above.');
  process.exitCode = 1;
}

listen.kill();
server.close();
