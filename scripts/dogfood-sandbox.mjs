import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// This harness is intentionally bound to the separate, loopback-only compose stack.
const origin = 'http://127.0.0.1:28787';
const password = 'DemoPassword12!';
async function request(path, { token, body, method = body ? 'POST' : 'GET' } = {}) {
  const response = await fetch(origin + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000)
  });
  return { status: response.status, body: await response.json() };
}

async function smoke() {
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/v1/me')).status, 401);
  assert.equal((await request('/v1/me', { token: 'dev' })).status, 401, 'auth cannot silently accept a development token');
  const sessions = [];
  for (const [email, plan, role] of [
    ['free-admin@demo.local', 'free', 'admin'],
    ['pro-admin@demo.local', 'pro', 'admin'],
    ['pro-member@demo.local', 'pro', 'member'],
    ['enterprise-admin@demo.local', 'enterprise', 'admin']
  ]) {
    const login = await request('/v1/auth/login', { body: {email, password} });
    assert.equal(login.status, 200, `login: ${email}`);
    assert.ok(login.body.accessToken);
    const me = await request('/v1/me', {token: login.body.accessToken});
    assert.equal(me.status, 200);
    assert.equal(me.body.email, email);
    assert.equal(me.body.plan, plan);
    assert.equal(me.body.role, role);
    assert.equal(me.body.orgId, login.body.orgId);
    sessions.push(login.body);
    console.log(`PASS login, identity, role and plan: ${email}`);
  }
  assert.equal(new Set(sessions.map(s => s.orgId)).size, 3);
  assert.equal(sessions[1].orgId, sessions[2].orgId);
  const admin = sessions[1], member = sessions[2], foreign = sessions[3];
  assert.equal((await request('/v1/admin/users', {token: member.accessToken})).status, 403);
  const ownUsers = await request('/v1/admin/users', {token: admin.accessToken});
  assert.equal(ownUsers.status, 200);
  assert.ok(!JSON.stringify(ownUsers.body).includes(foreign.email), 'another tenant must not appear');
  const foreignGrants = await request(`/v1/admin/users/${foreign.userId}/repo-grants`, {token: admin.accessToken});
  assert.ok([403, 404].includes(foreignGrants.status), 'cross-tenant user grants must be denied');
  assert.equal((await request('/v1/billing/checkout-session', {body: {email: admin.email, plan: 'pro'}})).status, 503);
  const logout = await request('/v1/auth/logout', {token: member.accessToken, body: {refreshToken: member.refreshToken}});
  assert.equal(logout.status, 200);
  assert.equal((await request('/v1/me', {token: member.accessToken})).status, 401, 'revoked session must fail');
  console.log('PASS tenant isolation, member admin denial, cross-tenant denial, billing unavailable, logout revocation');
  console.log('API smoke only: no Extension Host, real codehost, model, integration or Stripe checkout certification.');
}

async function modelSmoke() {
  const login = await request('/v1/auth/login', {body: {email: 'pro-admin@demo.local', password}});
  assert.equal(login.status, 200);
  const started = Date.now();
  const response = await fetch(origin + '/v1/chat', {
    method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${login.body.accessToken}`},
    body: JSON.stringify({message: 'Reply with this exact string and nothing else: DOGFOOD_MODEL_ALIVE_20261003', history: [], context: {},
      useCase: 'chat', model: 'gpt-5-mini', provider: 'openai', maxTokens: 2000, enableThinking: true}),
    signal: AbortSignal.timeout(60_000)
  });
  assert.equal(response.status, 200);
  const events = (await response.text()).split('\n').filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)));
  assert.ok(!events.some(event => event.type === 'error'), 'model stream must not contain an error');
  const content = events.filter(event => event.type === 'delta').map(event => event.text).join('');
  assert.equal(content.trim(), 'DOGFOOD_MODEL_ALIVE_20261003');
  const done = events.find(event => event.type === 'done');
  assert.ok(done?.usage?.inputTokens > 0 && done?.usage?.outputTokens > 0, 'real provider usage required');
  console.log(`PASS local API real model stream, marker and nonzero usage; duration ${Date.now() - started}ms`);
}

async function quotaSmoke() {
  const accounts = [];
  for (const email of ['free-admin@demo.local', 'pro-admin@demo.local', 'pro-member@demo.local']) {
    const login = await request('/v1/auth/login', {body: {email, password}});
    assert.equal(login.status, 200);
    assert.match(login.body.orgId, /^[a-f0-9-]{36}$/i);
    assert.match(login.body.userId, /^[a-f0-9-]{36}$/i);
    accounts.push(login.body);
  }
  const [free, paid, member] = accounts;
  const sql = text => execFileSync('docker', ['compose', '-f', 'docs/dogfood/sandbox.compose.yml', 'exec', '-T',
    'postgres', 'psql', '-U', 'dogfood', '-d', 'dogfood', '-v', 'ON_ERROR_STOP=1', '-c', text],
    {cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: ['ignore', 'ignore', 'pipe']});
  const clear = () => sql("DELETE FROM usage_events WHERE metadata->>'dogfoodSandboxBoundary' = 'true'");
  const chat = token => request('/v1/chat', {token, body: {message: 'Quota boundary probe', history: [], useCase: 'chat'}});
  clear();
  try {
    sql(`INSERT INTO usage_events(org_id,user_id,principal,event_type,metadata)
      SELECT '${free.orgId}', '${free.userId}', 'dogfood', 'chat.message',
      jsonb_build_object('provider','gemini','model','gemini-2.5-flash','inputTokens',1,'outputTokens',1,
      'countsAsMessage',true,'useCase','chat','quotaTurnId','dogfood-boundary-' || n,'dogfoodSandboxBoundary',true)
      FROM generate_series(1,20) n`);
    assert.equal((await chat(free.accessToken)).status, 429, 'free 20-message boundary must block before model work');
    sql(`INSERT INTO usage_events(org_id,user_id,principal,event_type,metadata)
      VALUES('${paid.orgId}','${paid.userId}','dogfood','quota.credit',
      '{"bucket":"auto","usdCents":1500,"dogfoodSandboxBoundary":true}')`);
    assert.equal((await chat(paid.accessToken)).status, 429, 'paid included cap must block');
    const own = await request('/v1/me', {token: paid.accessToken});
    const other = await request('/v1/me', {token: member.accessToken});
    assert.equal(own.status, 200); assert.equal(other.status, 200);
    assert.ok(own.body.usageMeters.usedCents >= 1500);
    assert.equal(own.body.usageMeters.remainingCents, 0);
    assert.ok(other.body.usageMeters.remainingCents > 0, 'one exhausted seat must not consume another seat');
    console.log('PASS free message cap and paid per-user cap; authentication remains valid');
  } finally { clear(); }
}

function faults() {
  let mode = 'pass';
  const modes = new Set(['pass', '429', '503', 'offline']);
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url?.startsWith('/__dogfood/mode/')) {
      const next = req.url.split('/').at(-1);
      if (!modes.has(next)) { res.writeHead(400).end(); return; }
      mode = next;
      res.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({mode}));
      return;
    }
    if (mode === 'offline') { req.socket.destroy(); return; }
    if (mode !== 'pass') {
      res.writeHead(Number(mode), {'content-type': 'application/json', ...(mode === '429' ? {'retry-after': '1'} : {})});
      res.end(JSON.stringify({error: 'dogfood_injected_fault', status: Number(mode)}));
      return;
    }
    const upstream = http.request(origin + req.url, {method: req.method, headers: {...req.headers, host: '127.0.0.1:28787'}}, response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  server.listen(28788, '127.0.0.1', () => console.log('Disposable API fault proxy on http://127.0.0.1:28788; modes: pass, 429, 503, offline'));
  return server;
}

async function faultCheck() {
  const server = faults();
  if (!server.listening) await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const proxy = 'http://127.0.0.1:28788';
  try {
    for (const mode of ['429', '503', 'offline', 'pass']) {
      const control = await fetch(`${proxy}/__dogfood/mode/${mode}`, {method: 'POST'});
      assert.equal(control.status, 200);
      if (mode === 'offline') {
        await assert.rejects(fetch(`${proxy}/health`, {signal: AbortSignal.timeout(2000)}));
      } else {
        const result = await fetch(`${proxy}/health`, {signal: AbortSignal.timeout(2000)});
        assert.equal(result.status, mode === 'pass' ? 200 : Number(mode));
        if (mode === '429') assert.equal(result.headers.get('retry-after'), '1');
      }
      console.log(`PASS controlled ${mode} fault`);
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

function setup() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const compose = ['compose', '-f', 'docs/dogfood/sandbox.compose.yml'];
  const run = args => execFileSync('docker', [...compose, ...args], {cwd: root, stdio: 'inherit'});
  // The fixed compose file has no production env file or credentials. These
  // seed commands replace only named demo tenants in its isolated database.
  run(['up', '-d', '--wait']);
  run(['exec', '-T', 'api', 'node', 'scripts/run-migrations.mjs']);
  for (const seed of ['seed-governance-demo', 'seed-repo-access-demo']) {
    run(['exec', '-T', 'api', 'node', 'dist/admin-org.js', seed]);
  }
}

if (process.argv[2] === 'smoke') await smoke();
else if (process.argv[2] === 'faults') faults();
else if (process.argv[2] === 'fault-check') await faultCheck();
else if (process.argv[2] === 'setup') setup();
else if (process.argv[2] === 'model-smoke') await modelSmoke();
else if (process.argv[2] === 'quota-smoke') await quotaSmoke();
else { console.error('Usage: node scripts/dogfood-sandbox.mjs setup|smoke|model-smoke|quota-smoke|faults|fault-check'); process.exitCode = 2; }
