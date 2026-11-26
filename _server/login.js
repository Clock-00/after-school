const byId = id => document.getElementById(id);
const notice = byId('notice');
const roles = { admin: '관리자', staff: '업무 담당자', approver: '승인 담당자' };
const statuses = { pending: '비밀번호 등록 필요', active: '활성', revoked: '접근 해제' };

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
    const row = listItem(`${user.id} · ${roles[user.role]} · ${statuses[user.status]} `);
    if (user.role !== 'admin' && user.status !== 'revoked') {
      const revoke = document.createElement('button');
      revoke.className = 'secondary-button';
      revoke.textContent = '접근 해제';
      revoke.setAttribute('aria-label', user.id + ' 접근 해제');
      action(revoke, 'click', async () => {
        await api('revoke', { id: user.id });
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
  byId('sign-in').hidden = Boolean(user);
  byId('account').hidden = !user;
  byId('admin').hidden = user?.role !== 'admin';
  byId('identity').textContent = user ? `${user.id} · ${roles[user.role]}` : '';
  byId('users').replaceChildren();
  byId('records').replaceChildren();
  if (!user) return;
  const records = await api('demo-records');
  byId('records').replaceChildren(...records.map(record =>
    listItem(`${record.year}학년도 · ${record.program} · ${record.id}`)));
  if (user.role === 'admin') await refreshUsers();
}

action(byId('login-form'), 'submit', async () => {
  const form = byId('login-form');
  const { id, role, password } = form.elements;
  try {
    await api('login', { id: id.value, role: role.value, password: password.value });
    form.reset();
    await refresh();
  } finally {
    password.value = '';
  }
});
action(byId('logout'), 'click', async () => {
  await api('logout', {});
  await refresh();
});
action(byId('register-form'), 'submit', async () => {
  const form = byId('register-form');
  const { id, role, password } = form.elements;
  try {
    await api('users', { id: id.value, role: role.value, password: password.value });
    form.reset();
    await refreshUsers();
    notice.textContent = '담당자 계정을 등록했습니다.';
  } finally {
    password.value = '';
  }
});
refresh().catch(error => { notice.textContent = error.message; });
