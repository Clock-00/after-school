const byId = id => document.getElementById(id);
const notice = byId('notice');
const roles = { admin: '관리자', staff: '업무 담당자', approver: '승인 담당자' };
const statuses = { invited: '초대됨', active: '활성', revoked: '접근 해제' };
let token;

function readLoginLink() {
  token = new URLSearchParams(location.hash.slice(1)).get('token');
  if (location.hash) history.replaceState(null, '', location.pathname);
  byId('use-link').hidden = !token;
  if (token) byId('sign-in').hidden = false;
}

readLoginLink();
window.addEventListener('hashchange', readLoginLink);

async function api(path, body) {
  const response = await fetch('/api/' + path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || '요청에 실패했습니다.'), { status: response.status });
  return result;
}

function action(element, event, callback) {
  element.addEventListener(event, async event => {
    event.preventDefault();
    const button = element.matches('button') ? element : element.querySelector('button');
    if (button.disabled) return;
    button.disabled = true;
    notice.textContent = '';
    try { await callback(); }
    catch (error) { notice.textContent = error.message; }
    finally { button.disabled = false; }
  });
}

function listItem(text) {
  const li = document.createElement('li');
  li.textContent = text;
  return li;
}

async function refreshUsers() {
  const users = await api('users');
  byId('users').replaceChildren(...users.map(user => {
    const row = listItem(`${user.email} · ${roles[user.role]} · ${statuses[user.status]} `);
    if (user.role !== 'admin' && user.status !== 'revoked') {
      const revoke = document.createElement('button');
      revoke.className = 'secondary-button';
      revoke.textContent = '접근 해제';
      revoke.setAttribute('aria-label', user.email + ' 접근 해제');
      action(revoke, 'click', async () => {
        await api('revoke', { email: user.email });
        await refreshUsers();
        notice.textContent = '접근을 해제했습니다.';
      });
      row.append(revoke);
    }
    return row;
  }));
}

async function refresh() {
  let user;
  try { user = await api('me'); }
  catch (error) { if (error.status !== 401) throw error; }
  byId('sign-in').hidden = Boolean(user) && !token;
  byId('account').hidden = !user;
  byId('admin').hidden = user?.role !== 'admin';
  byId('identity').textContent = user ? `${user.email} · ${roles[user.role]}` : '';
  byId('users').replaceChildren();
  byId('records').replaceChildren();
  if (!user) return;
  const records = await api('demo-records');
  byId('records').replaceChildren(...records.map(record =>
    listItem(`${record.year}학년도 · ${record.program} · ${record.id}`)));
  if (user.role === 'admin') await refreshUsers();
}

action(byId('email-form'), 'submit', async () => {
  await api('login', { email: byId('email-form').elements.email.value });
  notice.textContent = '등록된 계정이면 로그인 링크를 보내드립니다.';
});
action(byId('use-link'), 'click', async () => {
  const value = token;
  token = null;
  byId('use-link').hidden = true;
  await api('exchange', { token: value });
  await refresh();
});
action(byId('logout'), 'click', async () => {
  await api('logout', {});
  await refresh();
});
action(byId('invite-form'), 'submit', async () => {
  const fields = byId('invite-form').elements;
  await api('invite', { email: fields.email.value, role: fields.role.value });
  byId('invite-form').reset();
  await refreshUsers();
  notice.textContent = '초대 링크를 보냈습니다.';
});
refresh().catch(error => { notice.textContent = error.message; });
