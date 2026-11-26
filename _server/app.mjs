import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import nodemailer from 'nodemailer';

const demo = process.env.DEMO_MAIL === '1';
const origin = new URL(process.env.APP_ORIGIN ?? 'http://127.0.0.1:3001');
const admin = normalizeEmail(process.env.ADMIN_EMAIL ?? '');
const port = Number(process.env.PORT ?? 3001);
const smtp = process.env.SMTP_URL;
const sender = process.env.MAIL_FROM;

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validEmail(email) {
  return email.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)
    && (!demo || email.endsWith('@example.test'));
}

if (!validEmail(admin) || (!demo && (origin.protocol !== 'https:' || !smtp || !sender))
    || (demo && origin.origin !== `http://127.0.0.1:${port}`)) {
  throw new Error('APP_ORIGIN, ADMIN_EMAIL 및 메일 설정을 확인하세요.');
}

const mailer = demo ? null : nodemailer.createTransport(smtp, { requireTLS: true });
const dataDirectory = process.env.DATA_DIR ?? fileURLToPath(new URL('./data/', import.meta.url));
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(join(dataDirectory, 'auth.sqlite'));
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('admin', 'staff', 'approver')),
    status TEXT NOT NULL CHECK (status IN ('invited', 'active', 'revoked'))
  );
  CREATE TABLE IF NOT EXISTS links (
    hash TEXT PRIMARY KEY,
    email TEXT NOT NULL REFERENCES users(email),
    expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    hash TEXT PRIMARY KEY,
    email TEXT NOT NULL REFERENCES users(email),
    expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY,
    happened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    subject TEXT NOT NULL
  );
`);
const existingAdmin = db.prepare("SELECT email FROM users WHERE role = 'admin'").get();
if (existingAdmin && existingAdmin.email !== admin) {
  throw new Error('기존 데이터베이스의 관리자와 ADMIN_EMAIL이 다릅니다.');
}
db.prepare("INSERT OR IGNORE INTO users VALUES (?, 'admin', 'invited')").run(admin);

const cookie = demo ? 'demo_session' : '__Host-session';
const linkLifetime = 15 * 60;
const sessionLifetime = 8 * 60 * 60;
const roles = ['staff', 'approver'];
const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const page = readFileSync(new URL('./login.html', import.meta.url));
const client = readFileSync(new URL('./login.js', import.meta.url));
const stylesheet = readFileSync(new URL('../style.css', import.meta.url));
const recent = new Map();

function throttle(key, seconds) {
  const time = now();
  if ((recent.get(key) ?? 0) > time) return false;
  if (recent.size >= 10000) return false;
  recent.set(key, time + seconds);
  return true;
}

setInterval(() => {
  const time = now();
  for (const [key, expiry] of recent) if (expiry <= time) recent.delete(key);
  db.prepare('DELETE FROM links WHERE expires <= ?').run(time);
  db.prepare('DELETE FROM sessions WHERE expires <= ?').run(time);
}, 60_000).unref();

function transaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function audit(actor, action, subject) {
  db.prepare('INSERT INTO audit (actor, action, subject) VALUES (?, ?, ?)').run(actor, action, subject);
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function sessionHash(request) {
  const value = (request.headers.cookie ?? '').split(';')
    .map(part => part.trim()).find(part => part.startsWith(cookie + '='))?.slice(cookie.length + 1);
  return value && /^[\w-]{43}$/.test(value) ? digest(value) : '';
}

function setSession(response, value, seconds) {
  response.setHeader('Set-Cookie', `${cookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${demo ? '' : '; Secure'}`);
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request.setEncoding('utf-8')) {
    body += chunk;
    if (body.length > 4096) throw new Error('invalid body');
  }
  const value = JSON.parse(body);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid body');
  return value;
}

async function sendLink(email) {
  const value = token();
  const hash = digest(value);
  db.prepare('INSERT INTO links VALUES (?, ?, ?)').run(hash, email, now() + linkLifetime);
  const link = `${origin.origin}/#token=${value}`;
  try {
    if (demo) {
      console.info(`[가상 메일] ${email} ${link}`);
    } else {
      await mailer.sendMail({
        from: sender, to: email, subject: '백암초 방과후 업무 시스템 로그인',
        text: `아래 링크를 열어 로그인하세요. 링크는 발송 후 15분 동안 한 번만 사용할 수 있습니다.\n\n${link}`,
      });
    }
  } catch {
    db.prepare('DELETE FROM links WHERE hash = ?').run(hash);
    throw new Error('mail delivery failed');
  }
}

function exchange(value) {
  return transaction(() => {
    const link = db.prepare(`
      DELETE FROM links
      WHERE hash = ? AND expires > ?
        AND EXISTS (SELECT 1 FROM users WHERE users.email = links.email AND status != 'revoked')
      RETURNING email
    `).get(digest(value), now());
    if (!link) return null;
    db.prepare("UPDATE users SET status = 'active' WHERE email = ?").run(link.email);
    db.prepare('DELETE FROM links WHERE email = ?').run(link.email);
    const session = token();
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(session), link.email, now() + sessionLifetime);
    audit(link.email, 'login', link.email);
    return session;
  });
}

async function handle(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy',
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  const path = request.url.split('?')[0];
  if (request.method === 'GET') {
    const asset = { '/': [page, 'text/html; charset=utf-8'], '/login.js': [client, 'text/javascript; charset=utf-8'],
      '/style.css': [stylesheet, 'text/css; charset=utf-8'] }[path];
    if (asset) {
      response.writeHead(200, { 'Content-Type': asset[1] });
      response.end(asset[0]);
      return;
    }
  }
  if (request.method === 'POST' && (request.headers.origin !== origin.origin
    || request.headers['content-type'] !== 'application/json')) {
    return json(response, 403, { error: '요청을 허용할 수 없습니다.' });
  }
  if (!['POST', 'GET'].includes(request.method)) return json(response, 405, {});
  const key = `${request.method} ${path}`;
  let body;
  if (request.method === 'POST') {
    try { body = await readBody(request); }
    catch { return json(response, 400, { error: '요청 형식을 확인하세요.' }); }
  }
  if (key === 'POST /api/login') {
    const email = normalizeEmail(body.email);
    const user = validEmail(email) && db.prepare("SELECT email FROM users WHERE email = ? AND status != 'revoked'").get(email);
    if (user && throttle('email:' + email, 60)) {
      // Respond uniformly without waiting for SMTP or disclosing membership.
      sendLink(email).catch(() => console.error('로그인 메일을 보내지 못했습니다.'));
    }
    return json(response, 202, {});
  }
  if (key === 'POST /api/exchange') {
    const value = typeof body.token === 'string' && /^[\w-]{43}$/.test(body.token) && exchange(body.token);
    if (!value) return json(response, 401, { error: '사용할 수 없는 링크입니다. 새 링크를 요청하세요.' });
    setSession(response, value, sessionLifetime);
    return json(response, 200, {});
  }
  const hash = sessionHash(request);
  const user = hash && db.prepare(`
    SELECT users.email, users.role FROM sessions JOIN users USING (email)
    WHERE sessions.hash = ? AND sessions.expires > ? AND users.status = 'active'
  `).get(hash, now());
  if (!user) return json(response, 401, { error: '로그인이 필요합니다.' });

  if (key === 'GET /api/me') return json(response, 200, user);
  if (key === 'POST /api/logout') {
    db.prepare('DELETE FROM sessions WHERE hash = ?').run(hash);
    setSession(response, '', 0);
    return json(response, 200, {});
  }
  if (key === 'GET /api/demo-records') {
    return json(response, 200, [{ id: 'DEMO-001', program: '가상 바이올린', year: 2026 }]);
  }
  if (user.role !== 'admin') return json(response, 403, { error: '관리자 권한이 필요합니다.' });
  if (key === 'GET /api/users') {
    return json(response, 200, db.prepare('SELECT email, role, status FROM users ORDER BY email').all());
  }
  if (key === 'POST /api/invite') {
    const email = normalizeEmail(body.email);
    if (!validEmail(email) || !roles.includes(body.role)) return json(response, 400, { error: '이메일과 역할을 확인하세요.' });
    const assigned = transaction(() => {
      const existing = db.prepare('SELECT role, status FROM users WHERE email = ?').get(email);
      if (existing && (existing.role === 'admin' || existing.status === 'active'
        || (existing.status === 'invited' && existing.role !== body.role))) return false;
      if (!throttle('invite:' + email, 60)) return false;
      db.prepare(`
        INSERT INTO users VALUES (?, ?, 'invited')
        ON CONFLICT(email) DO UPDATE SET role = excluded.role, status = 'invited'
      `).run(email, body.role);
      audit(user.email, 'invite', email);
      return true;
    });
    if (!assigned) return json(response, 409, { error: '이미 등록되어 있거나 최근 초대했습니다.' });
    try { await sendLink(email); }
    catch { return json(response, 502, { error: '메일을 보내지 못했습니다. 잠시 후 다시 초대하세요.' }); }
    return json(response, 200, {});
  }
  if (key === 'POST /api/revoke') {
    const email = normalizeEmail(body.email);
    const result = transaction(() => {
      const update = db.prepare("UPDATE users SET status = 'revoked' WHERE email = ? AND role != 'admin' AND status != 'revoked'").run(email);
      if (!update.changes) return false;
      db.prepare('DELETE FROM links WHERE email = ?').run(email);
      db.prepare('DELETE FROM sessions WHERE email = ?').run(email);
      audit(user.email, 'revoke', email);
      return true;
    });
    return result ? json(response, 200, {}) : json(response, 409, { error: '접근을 해제할 수 없습니다.' });
  }
  return json(response, 404, {});
}

const server = createServer((request, response) => {
  handle(request, response).catch(() => {
    console.error('요청 처리 중 오류가 발생했습니다.');
    if (!response.headersSent) json(response, 500, { error: '서버 오류가 발생했습니다.' });
    else response.end();
  });
});
server.requestTimeout = 15000;
server.listen(port, demo ? '127.0.0.1' : (process.env.BIND_HOST ?? '127.0.0.1'),
  () => console.info(`로그인 서비스 시작: ${origin.origin}`));
