const SCHOOL_NAMES = ['백암초 본교', '백암초 수정분교장'];
const ROLES = {admin: '관리자', staff: '업무 담당자', approver: '승인 담당자'};
const DOCUMENTS = {activity: '방과후학교 강사 활동확인서', career: '방과후학교 강사 경력증명서'};
const TABLES = ['사용자', '강사', '계약', '발급'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('강사대장 설정')
    .addItem('대장 초기화', 'setupRegister_')
    .addItem('담당자 접속 코드 발급', 'issueRegisterCode_')
    .addToUi();
}

function issueRegisterCode_() {
  const ui = SpreadsheetApp.getUi();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const owner = spreadsheet.getOwner();
  if (!owner || Session.getActiveUser().getEmail() !== owner.getEmail()) throw new Error('대장 소유자만 접속 코드를 발급할 수 있습니다.');
  const answer = ui.prompt('접속 코드 발급', '등록된 담당자의 Google 이메일을 입력하세요.', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  const email = answer.getResponseText().trim().toLowerCase();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let code;
  try {
    const user = rows_(spreadsheet, '사용자').find(record => record.email === email);
    if (!user || !Object.hasOwn(ROLES, user.role)) throw new Error('등록된 담당자의 이메일을 확인하세요.');
    code = randomRegisterToken_();
    const properties = PropertiesService.getScriptProperties();
    properties.setProperty('register-code:' + email, registerDigest_(code));
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  ui.alert('접속 코드', '담당자에게 별도로 전달하세요. 닫으면 코드를 다시 볼 수 없습니다.\n\n' + code, ui.ButtonSet.OK);
}

function randomRegisterToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function registerDigest_(value) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value));
}

function registerLogin(email, role, code) {
  email = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!Object.hasOwn(ROLES, role) || typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) {
    throw new Error('아이디와 역할, 접속 코드를 확인하세요.');
  }
  const properties = PropertiesService.getScriptProperties();
  const sheetId = properties.getProperty('REGISTER_SHEET');
  const expected = properties.getProperty('register-code:' + email);
  if (!sheetId || !expected || expected !== registerDigest_(code)
      || !rows_(SpreadsheetApp.openById(sheetId), '사용자').some(user => user.email === email && user.role === role)) {
    throw new Error('아이디와 역할, 접속 코드를 확인하세요.');
  }
  const token = randomRegisterToken_();
  CacheService.getScriptCache().put('register-session:' + registerDigest_(token), JSON.stringify({email, role, expected}), 21600);
  return token;
}

function registerLogout(token) {
  if (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) {
    CacheService.getScriptCache().remove('register-session:' + registerDigest_(token));
  }
}

function registerSession_(token, properties) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('로그인이 필요합니다.');
  const session = JSON.parse(CacheService.getScriptCache().get('register-session:' + registerDigest_(token)));
  if (!session || properties.getProperty('register-code:' + session.email) !== session.expected) {
    throw new Error('로그인이 필요합니다.');
  }
  return session;
}

function setupRegister_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const admin = Session.getEffectiveUser().getEmail().trim().toLowerCase();
  if (!spreadsheet || !admin || spreadsheet.getOwner()?.getEmail() !== Session.getActiveUser().getEmail()) {
    throw new Error('대장 소유자 계정으로 연결된 스프레드시트에서 실행하세요.');
  }
  const properties = PropertiesService.getScriptProperties();
  const configured = properties.getProperty('REGISTER_SHEET');
  if (configured && configured !== spreadsheet.getId()) throw new Error('이미 다른 대장이 연결되어 있습니다.');
  TABLES.forEach(name => {
    const title = '늘봄_' + name;
    if (!spreadsheet.getSheetByName(title)) {
      spreadsheet.insertSheet(title).appendRow(['키', '기록(JSON)']);
    }
  });
  const users = spreadsheet.getSheetByName('늘봄_사용자');
  if (users.getLastRow() === 1) users.appendRow([Utilities.getUuid(), JSON.stringify({email: admin, role: 'admin'})]);
  properties.setProperty('REGISTER_SHEET', spreadsheet.getId());
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('백암초 방과후 강사대장');
}

function registerApi(token, action, input) {
  const properties = PropertiesService.getScriptProperties();
  const id = properties.getProperty('REGISTER_SHEET');
  if (!id) throw new Error('대장 초기 설정이 필요합니다.');
  const sheet = SpreadsheetApp.openById(id);
  const lock = LockService.getScriptLock();
  if (action !== 'read') lock.waitLock(10000);
  try {
    const {email, role} = registerSession_(token, properties);
    if (!rows_(sheet, '사용자').some(user => user.email === email && user.role === role)) {
      throw new Error('로그인이 필요합니다.');
    }
    return handleRegister_(sheet, email, action, input || {});
  } finally {
    if (action !== 'read') {
      try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
    }
  }
}

function rows_(sheet, name) {
  const table = sheet.getSheetByName('늘봄_' + name);
  const last = table.getLastRow();
  return last < 2 ? [] : table.getRange(2, 1, last - 1, 2).getValues()
    .map(([id, json], index) => ({id, row: index + 2, ...JSON.parse(json)}));
}

function save_(sheet, name, existing, data) {
  const table = sheet.getSheetByName('늘봄_' + name);
  const id = existing ? existing.id : Utilities.getUuid();
  const row = existing ? existing.row : table.getLastRow() + 1;
  table.getRange(row, 1, 1, 2).setValues([[id, JSON.stringify(data)]]);
}

function text_(value, max, optional = false) {
  const result = typeof value === 'string' ? value.trim() : '';
  if ((!optional && !result) || result.length > max) throw new Error('필수 입력값과 글자 수를 확인하세요.');
  return result;
}

function date_(value, optional = false) {
  const date = text_(value, 10, optional);
  if (!date && optional) return '';
  const parsed = new Date(date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('날짜를 확인하세요.');
  }
  return date;
}

function publicRows_(rows) {
  return rows.map(({row, ...record}) => record);
}

function handleRegister_(sheet, email, action, input) {
  const users = rows_(sheet, '사용자');
  const actor = users.find(record => record.email === email);
  if (!actor || !Object.hasOwn(ROLES, actor.role)) throw new Error('등록된 담당자만 이용할 수 있습니다.');
  const teachers = rows_(sheet, '강사');
  const contracts = rows_(sheet, '계약');
  const requests = rows_(sheet, '발급');
  const time = new Date().toISOString();
  const requireRole = (...roles) => {
    if (!roles.includes(actor.role)) throw new Error('이 업무를 처리할 권한이 없습니다.');
  };
  const find = (records, id) => {
    const record = records.find(item => item.id === id);
    if (!record) throw new Error('해당 기록을 찾을 수 없습니다.');
    return record;
  };
  switch (action) {
    case 'read':
      return {
        email, role: actor.role, roles: ROLES, schools: SCHOOL_NAMES, documents: DOCUMENTS,
        teachers: publicRows_(teachers), contracts: publicRows_(contracts), requests: publicRows_(requests),
        users: actor.role === 'admin' ? publicRows_(users) : [],
      };
    case 'user': {
      requireRole('admin');
      const target = text_(input.email, 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)
          || !['staff', 'approver', 'disabled'].includes(input.role)) {
        throw new Error('담당자의 이메일과 역할을 확인하세요.');
      }
      const prior = users.find(item => item.email === target);
      if (prior?.role === 'admin') throw new Error('초기 관리자 계정의 역할은 변경할 수 없습니다.');
      if (prior && prior.role !== input.role) {
        PropertiesService.getScriptProperties().deleteProperty('register-code:' + target);
      }
      save_(sheet, '사용자', prior, {email: target, role: input.role, updatedBy: email, updatedAt: time});
      break;
    }
    case 'teacher': {
      requireRole('admin', 'staff');
      const prior = input.id ? find(teachers, input.id) : null;
      save_(sheet, '강사', prior, {name: text_(input.name, 80), updatedBy: email, updatedAt: time});
      break;
    }
    case 'contract': {
      requireRole('admin', 'staff');
      const prior = input.id ? find(contracts, input.id) : null;
      const teacher = find(teachers, input.teacherId);
      if (prior && prior.teacherId !== teacher.id) throw new Error('기존 계약의 강사는 변경할 수 없습니다.');
      const year = Number(input.year);
      const start = date_(input.start);
      const end = date_(input.end);
      const actualStart = date_(input.actualStart, true);
      const actualEnd = date_(input.actualEnd, true);
      const hours = input.hours === '' ? null : Number(input.hours);
      if (!Number.isInteger(year) || year < 2000 || year > 2100 || !SCHOOL_NAMES.includes(input.school)
          || !['계약 예정', '계약 중', '활동 종료', '계약 해지'].includes(input.status) || start > end
          || Boolean(actualStart) !== Boolean(actualEnd)
          || (actualStart && (actualStart > actualEnd || actualStart < start || actualEnd > end))
          || (hours !== null && (!actualStart || !Number.isFinite(hours) || hours < 0 || hours > 10000))) {
        throw new Error('학년도, 학교, 계약 및 활동 기간, 강의 시간을 확인하세요.');
      }
      save_(sheet, '계약', prior, {teacherId: teacher.id, year, school: input.school,
        program: text_(input.program, 100), status: input.status, start, end, actualStart, actualEnd, hours,
        updatedBy: email, updatedAt: time});
      break;
    }
    case 'request': {
      requireRole('admin', 'staff');
      const teacher = find(teachers, input.teacherId);
      if (!Object.hasOwn(DOCUMENTS, input.type) || !Array.isArray(input.contractIds)
          || !input.contractIds.length || input.contractIds.length > 20
          || new Set(input.contractIds).size !== input.contractIds.length) throw new Error('문서 종류와 계약을 선택하세요.');
      const records = input.contractIds.map(id => find(contracts, id));
      if (records.some(record => record.teacherId !== teacher.id || !record.actualStart || !record.actualEnd)) {
        throw new Error('해당 강사의 실제 활동 기간이 확인된 계약만 선택하세요.');
      }
      save_(sheet, '발급', null, {teacherId: teacher.id, teacherName: teacher.name, type: input.type,
        records: publicRows_(records), status: '승인 대기', requestedBy: email, requestedAt: time});
      break;
    }
    case 'review': {
      requireRole('admin', 'approver');
      const request = find(requests, input.id);
      if (request.status !== '승인 대기' || !['승인', '반려'].includes(input.status)) {
        throw new Error('승인 대기 중인 문서만 처리할 수 있습니다.');
      }
      if (request.requestedBy === email) throw new Error('본인이 요청한 문서는 다른 담당자가 승인해야 합니다.');
      const {id, row, ...saved} = request;
      save_(sheet, '발급', request, {...saved, status: input.status, reviewedBy: email, reviewedAt: time,
        number: input.status === '승인' ? 'BA-' + id : ''});
      break;
    }
    default:
      throw new Error('지원하지 않는 작업입니다.');
  }
  return handleRegister_(sheet, email, 'read', {});
}
