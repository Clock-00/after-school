import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';

test('역할별 로그인, 계정 등록 및 접근 해제', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'after-school-auth-'));
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['app.mjs'], {
    env: {
      ...process.env, APP_ORIGIN: origin, PORT: String(port), LOCAL_DEMO: '1',
      ADMIN_ID: 'school-admin', ADMIN_PASSWORD: 'example-admin-password', DATA_DIR: directory,
    },
  });
  const exited = once(server, 'exit');
  t.after(async () => {
    server.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  let errors = '';
  server.stderr.on('data', chunk => { errors += chunk; });

  async function waitFor(find) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = find();
      if (value) return value;
      if (server.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail('서버 출력 대기 실패: ' + errors);
  }

  await waitFor(() => output.includes('로그인 서비스 시작'));
  function call(path, { body, cookie, from = origin } = {}) {
    const headers = cookie ? { Cookie: cookie } : {};
    return fetch(origin + '/api/' + path, body === undefined ? { headers } : {
      method: 'POST', headers: { ...headers, Origin: from, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  const account = {
    admin: { id: 'school-admin', role: 'admin', password: 'example-admin-password' },
    staff: { id: 'school-staff', role: 'staff', password: 'example-staff-password' },
    approver: { id: 'school-approver', role: 'approver', password: 'example-approver-password' },
  };
  async function signIn(credentials) {
    const response = await call('login', { body: credentials });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Set-Cookie'), /HttpOnly; SameSite=Lax/);
    return response.headers.get('Set-Cookie').split(';')[0];
  }

  const page = await fetch(origin);
  assert.match(await page.text(), /역할별 로그인/);
  assert.equal((await call('demo-records')).status, 401);
  assert.equal((await call('login', { from: 'https://other.example.test', body: account.admin })).status, 403);
  assert.equal((await call('login', { body: { ...account.admin, password: 'incorrect-password' } })).status, 401);
  assert.equal((await call('login', { body: { ...account.admin, role: 'staff' } })).status, 401);
  const admin = await signIn(account.admin);
  assert.equal((await call('users', { cookie: admin, body: { ...account.staff, role: 'admin' } })).status, 400);
  assert.equal((await call('users', { cookie: admin, body: account.staff })).status, 201);
  assert.equal((await call('users', { cookie: admin, body: account.staff })).status, 409);
  assert.equal((await call('login', { body: { ...account.staff, role: 'admin' } })).status, 401);
  const staff = await signIn(account.staff);
  assert.deepEqual(await (await call('me', { cookie: staff })).json(), { id: account.staff.id, role: 'staff' });
  assert.equal((await call('demo-records', { cookie: staff })).status, 200);
  assert.equal((await call('users', { cookie: staff })).status, 403);
  assert.equal((await call('users', { cookie: staff, body: account.approver })).status, 403);

  assert.equal((await call('users', { cookie: admin, body: account.approver })).status, 201);
  const approver = await signIn(account.approver);
  assert.equal((await (await call('me', { cookie: approver })).json()).role, 'approver');
  const users = await (await call('users', { cookie: admin })).json();
  assert.deepEqual(users.map(user => Object.keys(user)), users.map(() => ['id', 'role', 'status']));
  assert.ok(!JSON.stringify(users).includes(account.approver.password));

  assert.equal((await call('revoke', { cookie: admin, body: { id: account.staff.id } })).status, 200);
  assert.equal((await call('demo-records', { cookie: staff })).status, 401);
  assert.equal((await call('login', { body: account.staff })).status, 401);
  assert.equal((await call('logout', { cookie: admin, body: {} })).status, 200);
  assert.equal((await call('me', { cookie: admin })).status, 401);
  assert.ok(!output.includes(account.admin.password));
});
