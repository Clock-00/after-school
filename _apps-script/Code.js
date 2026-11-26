const ROLE_LABELS = { admin: '관리자', staff: '업무 담당자', approver: '승인 담당자' };

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate().setTitle('백암초 강사 경력관리');
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function config_() {
  const store = PropertiesService.getScriptProperties();
  const admin = email_(store.getProperty('ADMIN_EMAIL'));
  const secret = store.getProperty('AUTH_SECRET');
  if (!admin || !secret || !/^[a-f0-9]{64}$/.test(secret)) {
    throw new Error('관리자 초기 설정이 필요합니다.');
  }
  return { store, admin, secret };
}

function email_(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email.length <= 254 && /^[a-z0-9._+%-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) ? email : '';
}

function locked_(action) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    return action(config_());
  } finally {
    lock.releaseLock();
  }
}

function load_(config, prefix, email) {
  return JSON.parse(config.store.getProperty(prefix + email) || 'null');
}

function save_(config, prefix, email, value) {
  config.store.setProperty(prefix + email, JSON.stringify(value));
}

function role_(config, email) {
  return email === config.admin ? 'admin' : load_(config, 'user:', email)?.role;
}

function digest_(config, value) {
  return Utilities.computeHmacSha256Signature(value, config.secret)
    .map(byte => ('0' + (byte & 255).toString(16)).slice(-2)).join('');
}

function randomToken_(config) {
  return digest_(config, Utilities.getUuid() + ':' + Utilities.getUuid());
}

function authorized_(config, input, adminOnly) {
  const email = email_(input.email);
  const role = email && role_(config, email);
  const session = role && load_(config, 'session:', email);
  if (!session || session.expires <= Date.now() || typeof input.session !== 'string'
      || !/^[a-f0-9]{64}$/.test(input.session)
      || session.hash !== digest_(config, input.session)
      || (adminOnly && role !== 'admin')) {
    throw new Error('로그인 또는 접근 권한을 확인해 주세요.');
  }
  return { email, role };
}

function prepareMail_(config, email) {
  if (!email || !role_(config, email)) return null;
  const previous = load_(config, 'code:', email);
  if (previous && previous.sent + 60000 > Date.now()) return null;
  const code = randomToken_(config).slice(0, 10).toUpperCase();
  const sent = Date.now();
  save_(config, 'code:', email, { hash: digest_(config, code), sent, expires: sent + 600000, attempts: 0 });
  return { email, code, sent };
}

function sendMail_(mail, invited) {
  if (!mail) return;
  try {
    MailApp.sendEmail({
      to: mail.email,
      subject: invited ? '백암초 강사 경력관리 초대' : '백암초 강사 경력관리 로그인',
      body: '접속 주소: ' + ScriptApp.getService().getUrl()
        + '\n\n인증번호: ' + mail.code + '\n\n인증번호는 10분 동안 한 번만 사용할 수 있습니다.',
    });
  } catch (_) {
    locked_(config => {
      if (load_(config, 'code:', mail.email)?.sent === mail.sent) {
        config.store.deleteProperty('code:' + mail.email);
      }
    });
    if (invited) throw new Error('메일을 보내지 못했습니다. 발송 권한과 일일 한도를 확인해 주세요.');
  }
}

function requestCode(address) {
  const mail = locked_(config => prepareMail_(config, email_(address)));
  sendMail_(mail, false);
  return true;
}

function login(address, value) {
  return locked_(config => {
    const email = email_(address);
    const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!email || !role_(config, email) || !/^[A-F0-9]{10}$/.test(code)) return null;
    const challenge = load_(config, 'code:', email);
    if (!challenge || challenge.expires <= Date.now() || challenge.attempts >= 5) return null;
    if (challenge.hash !== digest_(config, code)) {
      challenge.attempts++;
      save_(config, 'code:', email, challenge);
      return null;
    }
    config.store.deleteProperty('code:' + email);
    const session = randomToken_(config);
    save_(config, 'session:', email, { hash: digest_(config, session), expires: Date.now() + 28800000 });
    return { email, session };
  });
}

function workspace(credentials) {
  return locked_(config => {
    const user = authorized_(config, credentials);
    const output = { role: user.role, label: ROLE_LABELS[user.role], schools: demoSchools,
      instructors: demoInstructors, records: demoRecords };
    if (user.role === 'admin') {
      const properties = config.store.getProperties();
      output.users = Object.keys(properties).filter(key => key.startsWith('user:'))
        .map(key => ({ email: key.slice(5), role: JSON.parse(properties[key]).role }))
        .sort((first, second) => first.email.localeCompare(second.email));
    }
    return output;
  });
}

function invite(credentials, address, role) {
  const mail = locked_(config => {
    authorized_(config, credentials, true);
    const email = email_(address);
    if (!email || email === config.admin || !['staff', 'approver'].includes(role)) {
      throw new Error('초대 이메일과 역할을 확인해 주세요.');
    }
    const existing = role_(config, email);
    if (existing && existing !== role) throw new Error('역할을 바꾸려면 기존 접근을 해제한 후 다시 초대해 주세요.');
    if (!existing && Object.keys(config.store.getProperties()).filter(key => key.startsWith('user:')).length >= 25) {
      throw new Error('시험 배포에서는 담당자를 최대 25명까지 등록할 수 있습니다.');
    }
    save_(config, 'user:', email, { role });
    const invitation = prepareMail_(config, email);
    if (!invitation) throw new Error('잠시 후 다시 초대해 주세요.');
    return invitation;
  });
  sendMail_(mail, true);
  return true;
}

function revoke(credentials, address) {
  return locked_(config => {
    authorized_(config, credentials, true);
    const email = email_(address);
    if (!email || email === config.admin) throw new Error('해제할 담당자를 선택해 주세요.');
    ['user:', 'code:', 'session:'].forEach(prefix => config.store.deleteProperty(prefix + email));
    return true;
  });
}

function logout(credentials) {
  return locked_(config => {
    const user = authorized_(config, credentials);
    config.store.deleteProperty('session:' + user.email);
    return true;
  });
}
