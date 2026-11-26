import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';

const local = process.env.LOCAL_DEMO === '1';
const origin = new URL(process.env.APP_ORIGIN ?? 'http://127.0.0.1:3001');
const admin = normalizeId(process.env.ADMIN_ID ?? '');
const port = Number(process.env.PORT ?? 3001);
const derivePassword = promisify(scrypt);

function normalizeId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validId(value) {
  return /^[a-z0-9][a-z0-9._@+-]{2,253}$/.test(value);
}

function validPassword(value) {
  return typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value) <= 256;
}

if (!validId(admin) || (local ? origin.origin !== `http://127.0.0.1:${port}` : origin.protocol !== 'https:')) {
  throw new Error('APP_ORIGIN 및 ADMIN_ID를 확인하세요.');
}

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
  CREATE TABLE IF NOT EXISTS credentials (
    email TEXT PRIMARY KEY REFERENCES users(email),
    salt TEXT NOT NULL,
    password_hash BLOB NOT NULL
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
  throw new Error('기존 데이터베이스의 관리자와 ADMIN_ID가 다릅니다.');
}
const startupPassword = process.env.ADMIN_PASSWORD;
if (!db.prepare('SELECT email FROM credentials WHERE email = ?').get(admin)) {
  if (!validPassword(startupPassword)) throw new Error('초기 ADMIN_PASSWORD를 12자 이상으로 설정하세요.');
  const salt = randomBytes(16).toString('hex');
  const passwordHash = scryptSync(startupPassword, salt, 64);
  transaction(() => {
    db.prepare("INSERT OR IGNORE INTO users VALUES (?, 'admin', 'active')").run(admin);
    db.prepare("UPDATE users SET status = 'active' WHERE email = ? AND role = 'admin'").run(admin);
    db.prepare('INSERT INTO credentials VALUES (?, ?, ?)').run(admin, salt, passwordHash);
  });
}
if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'links'").get()) {
  transaction(() => {
    db.exec('DROP TABLE links; DELETE FROM sessions');
  });
}

const cookie = local ? 'demo_session' : '__Host-session';
const sessionLifetime = 8 * 60 * 60;
const roles = ['staff', 'approver'];
const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const page = readFileSync(new URL('./login.html', import.meta.url));
const client = readFileSync(new URL('./login.js', import.meta.url));
const stylesheet = readFileSync(new URL('../style.css', import.meta.url));
const recent = new Map();

function throttle(key, limit) {
  const time = now();
  const entry = recent.get(key);
  if (entry && entry.expires > time) {
    if (entry.attempts >= limit) return false;
    entry.attempts++;
    return true;
  }
  if (!entry && recent.size >= 10000) return false;
  recent.set(key, { expires: time + 60, attempts: 1 });
  return true;
}

setInterval(() => {
  const time = now();
  for (const [key, entry] of recent) if (entry.expires <= time) recent.delete(key);
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
  response.setHeader('Set-Cookie', `${cookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${local ? '' : '; Secure'}`);
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

const dummySalt = randomBytes(16).toString('hex');
const dummyHash = randomBytes(64);

async function authenticate(request, body) {
  const id = normalizeId(body.id);
  if (!validId(id) || !validPassword(body.password) || !['admin', ...roles].includes(body.role)) return null;
  if (!throttle('login-address:' + request.socket.remoteAddress, 40)
      || !throttle('login-id:' + id, 8)) return null;
  const credential = db.prepare(`
    SELECT users.role, credentials.salt, credentials.password_hash
    FROM users JOIN credentials USING (email) WHERE users.email = ? AND users.status = 'active'
  `).get(id);
  const candidate = await derivePassword(body.password, credential?.salt ?? dummySalt, 64);
  if (!timingSafeEqual(candidate, credential?.password_hash ?? dummyHash) || credential?.role !== body.role) return null;

  return transaction(() => {
    const active = db.prepare(`
      SELECT 1 FROM users JOIN credentials USING (email)
      WHERE users.email = ? AND users.status = 'active' AND users.role = ? AND credentials.salt = ?
    `).get(id, body.role, credential.salt);
    if (!active) return null;
    const session = token();
    db.prepare('DELETE FROM sessions WHERE hash = ?').run(sessionHash(request));
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(session), id, now() + sessionLifetime);
    audit(id, 'login', id);
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
      '/style.css': [stylesheet, 'text/css; charset=utf-8'], __proto__: null }[path];
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
    const session = await authenticate(request, body);
    if (!session) return json(response, 401, { error: '역할과 아이디, 비밀번호를 확인하고 잠시 후 다시 시도하세요.' });
    setSession(response, session, sessionLifetime);
    return json(response, 200, {});
  }
  const hash = sessionHash(request);
  const user = hash && db.prepare(`
    SELECT users.email AS id, users.role
    FROM sessions JOIN users USING (email) JOIN credentials USING (email)
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
    return json(response, 200, db.prepare(`
      SELECT users.email AS id, role, CASE
        WHEN status = 'revoked' THEN 'revoked'
        WHEN credentials.email IS NOT NULL THEN 'active'
        ELSE 'pending'
      END AS status
      FROM users LEFT JOIN credentials USING (email) ORDER BY users.email
    `).all());
  }
  if (key === 'POST /api/users') {
    const id = normalizeId(body.id);
    if (!validId(id) || !roles.includes(body.role) || !validPassword(body.password)) {
      return json(response, 400, { error: '아이디와 역할, 12자 이상의 비밀번호를 확인하세요.' });
    }
    const salt = randomBytes(16).toString('hex');
    const passwordHash = await derivePassword(body.password, salt, 64);
    const assigned = transaction(() => {
      const session = db.prepare('SELECT 1 FROM sessions WHERE hash = ? AND expires > ?').get(hash, now());
      if (!session) return false;
      const existing = db.prepare('SELECT role, status FROM users WHERE email = ?').get(id);
      if (existing?.role === 'admin' || (existing?.status === 'active'
        && db.prepare('SELECT 1 FROM credentials WHERE email = ?').get(id))) return false;
      db.prepare(`
        INSERT INTO users VALUES (?, ?, 'active')
        ON CONFLICT(email) DO UPDATE SET role = excluded.role, status = 'active'
      `).run(id, body.role);
      db.prepare(`
        INSERT INTO credentials VALUES (?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET salt = excluded.salt, password_hash = excluded.password_hash
      `).run(id, salt, passwordHash);
      audit(user.id, 'register', id);
      return true;
    });
    return assigned ? json(response, 201, {}) : json(response, 409, { error: '계정을 등록할 수 없습니다.' });
  }
  if (key === 'POST /api/revoke') {
    const id = normalizeId(body.id);
    const result = transaction(() => {
      const update = db.prepare("UPDATE users SET status = 'revoked' WHERE email = ? AND role != 'admin' AND status != 'revoked'").run(id);
      if (!update.changes) return false;
      db.prepare('DELETE FROM credentials WHERE email = ?').run(id);
      db.prepare('DELETE FROM sessions WHERE email = ?').run(id);
      audit(user.id, 'revoke', id);
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
server.listen(port, local ? '127.0.0.1' : (process.env.BIND_HOST ?? '127.0.0.1'),
  () => console.info(`로그인 서비스 시작: ${origin.origin}`));
