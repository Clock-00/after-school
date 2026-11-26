import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

test('앱스 스크립트 초대, 코드 로그인, 역할 및 세션 차단', () => {
  const admin = 'admin@example.test';
  const staff = 'staff@example.test';
  const properties = new Map([['ADMIN_EMAIL', admin], ['AUTH_SECRET', '1'.repeat(64)]]);
  const mail = [];
  const context = createContext({
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key),
      setProperty: (key, value) => properties.set(key, value),
      deleteProperty: key => properties.delete(key),
      getProperties: () => Object.fromEntries(properties),
    }) },
    Utilities: { getUuid: randomUUID,
      computeHmacSha256Signature: (value, secret) => [...createHmac('sha256', secret).update(value).digest()] },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://example.test/exec' }) },
    MailApp: { sendEmail: message => mail.push(message) },
  });
  for (const file of ['../demo-data.js', './Code.js']) {
    runInContext(readFileSync(new URL(file, import.meta.url), 'utf8'), context);
  }
  const latestCode = () => mail.at(-1).body.match(/인증번호: ([A-F0-9]{10})/)[1];

  assert.throws(() => context.workspace({ email: admin, session: 'x' }), /로그인/);
  context.requestCode('unknown@example.test');
  assert.equal(mail.length, 0);
  context.requestCode(admin);
  context.requestCode(admin);
  assert.equal(mail.length, 1);
  const adminCode = latestCode();
  const owner = context.login(admin, adminCode);
  assert.equal(context.login(admin, adminCode), null);
  assert.equal(context.workspace(owner).role, 'admin');
  context.invite(owner, staff, 'staff');
  const staffCode = latestCode();
  assert.equal(context.login(staff, staffCode === '0000000000' ? 'FFFFFFFFFF' : '0000000000'), null);
  const employee = context.login(staff, staffCode);
  assert.equal(context.workspace(employee).records.length, 7);
  assert.equal(context.workspace(employee).users, undefined);
  assert.throws(() => context.invite(employee, 'other@example.test', 'staff'), /권한/);
  assert.throws(() => context.workspace({ ...employee, email: admin }), /권한/);
  context.revoke(owner, staff);
  assert.throws(() => context.workspace(employee), /권한/);
  context.requestCode(staff);
  assert.equal(mail.length, 2);
  context.logout(owner);
  assert.throws(() => context.workspace(owner), /권한/);
});
