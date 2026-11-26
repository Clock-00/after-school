import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';

test('초대, 일회용 링크, 역할 검사 및 접근 해제', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'after-school-auth-'));
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['app.mjs'], {
    env: {
      ...process.env, APP_ORIGIN: origin, PORT: String(port), DEMO_MAIL: '1',
      ADMIN_EMAIL: 'admin@example.test', DATA_DIR: directory,
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
  const mailToken = email => waitFor(() => {
    const line = output.split('\n').find(line => line.startsWith('[가상 메일] ' + email + ' '));
    return line?.split('#token=')[1];
  });
  function call(path, { body, cookie, from = origin } = {}) {
    const headers = cookie ? { Cookie: cookie } : {};
    return fetch(origin + '/api/' + path, body === undefined ? { headers } : {
      method: 'POST', headers: { ...headers, Origin: from, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  const staff = 'staff@example.test';
  const unknown = 'unknown@example.test';
  const approver = 'approver@example.test';
  async function signIn(email) {
    const token = await mailToken(email);
    const response = await call('exchange', { body: { token } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Set-Cookie'), /HttpOnly; SameSite=Lax/);
    assert.equal((await call('exchange', { body: { token } })).status, 401);
    return response.headers.get('Set-Cookie').split(';')[0];
  }

  assert.equal((await call('demo-records')).status, 401);
  assert.equal((await call('login', { from: 'https://other.example.test', body: { email: 'admin@example.test' } })).status, 403);
  const unknownLogin = await call('login', { body: { email: unknown } });
  assert.equal(unknownLogin.status, 202);
  assert.deepEqual(await unknownLogin.json(), {});
  assert.equal((await call('login', { body: { email: 'admin@example.test' } })).status, 202);
  const admin = await signIn('admin@example.test');
  assert.equal((await call('invite', { cookie: admin, body: { email: staff, role: 'admin' } })).status, 400);
  assert.equal((await call('invite', { cookie: admin, body: { email: staff, role: 'staff' } })).status, 200);
  const staffCookie = await signIn(staff);
  assert.equal((await (await call('me', { cookie: staffCookie })).json()).role, 'staff');
  assert.equal((await call('demo-records', { cookie: staffCookie })).status, 200);
  assert.equal((await call('users', { cookie: staffCookie })).status, 403);
  assert.equal((await call('invite', { cookie: staffCookie, body: { email: unknown, role: 'staff' } })).status, 403);

  assert.equal((await call('invite', { cookie: admin, body: { email: approver, role: 'approver' } })).status, 200);
  const pending = await mailToken(approver);
  assert.equal((await call('revoke', { cookie: admin, body: { email: approver } })).status, 200);
  assert.equal((await call('exchange', { body: { token: pending } })).status, 401);

  assert.equal((await call('revoke', { cookie: admin, body: { email: staff } })).status, 200);
  assert.equal((await call('demo-records', { cookie: staffCookie })).status, 401);
  assert.equal((await call('logout', { cookie: admin, body: {} })).status, 200);
  assert.equal((await call('me', { cookie: admin })).status, 401);
  assert.ok(!output.includes(unknown));
});
