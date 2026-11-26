const SCHOOL_NAMES = ['백암초 본교', '백암초 수정분교장'];
const ROLES = {admin: '관리자', staff: '업무 담당자', approver: '승인 담당자'};
const DOCUMENTS = {activity: '방과후학교 강사 활동확인서', career: '방과후학교 강사 경력증명서'};
const TABLES = ['강사', '계약', '발급'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('강사대장 설정')
    .addItem('대장 초기화', 'setupRegister_')
    .addItem('관리자 비밀번호 설정', 'issueAdminPassword_')
    .addItem('업무 담당자 비밀번호 설정', 'issueStaffPassword_')
    .addItem('승인 담당자 비밀번호 설정', 'issueApproverPassword_')
    .addToUi();
}

function issueAdminPassword_() { issueRolePassword_('admin'); }
function issueStaffPassword_() { issueRolePassword_('staff'); }
function issueApproverPassword_() { issueRolePassword_('approver'); }

function issueRolePassword_(role) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const owner = spreadsheet.getOwner();
  if (!owner || Session.getActiveUser().getEmail() !== owner.getEmail()) throw new Error('대장 소유자만 비밀번호를 발급할 수 있습니다.');
  const ui = SpreadsheetApp.getUi();
  const title = ROLES[role] + ' 비밀번호';
  const setup = HtmlService.createHtmlOutputFromFile('Password').setWidth(400).setHeight(235);
  setup.append('<script>document.getElementById("role").value = ' + JSON.stringify(role) + ';</script>');
  ui.showModalDialog(setup, title + ' 설정');
}

function setRolePasswordFromSheet(role, password) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const owner = spreadsheet?.getOwner();
  if (!owner || Session.getActiveUser().getEmail() !== owner.getEmail()) throw new Error('대장 소유자만 비밀번호를 설정할 수 있습니다.');
  if (!Object.hasOwn(ROLES, role) || !validRolePassword_(password)) throw new Error('비밀번호는 9~128자로 입력하세요.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    storeRolePassword_(PropertiesService.getScriptProperties(), role, password);
  } finally {
    lock.releaseLock();
  }
}

function storeRolePassword_(properties, role, password) {
  // A fresh salt also invalidates old sessions when a password is reused.
  const salt = randomRegisterToken_();
  properties.setProperty('role-password:' + role, salt + ':' + registerDigest_(salt + password));
}

function verifyRolePassword_(stored, password) {
  if (!stored || !validRolePassword_(password)) return false;
  const parts = stored.split(':');
  return parts.length === 2
    ? parts[1] === registerDigest_(parts[0] + password)
    : stored === registerDigest_(password);
}

function updateRegisterPassword(token, target, current, password) {
  const properties = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const session = registerSession_(token, properties);
    if (!Object.hasOwn(ROLES, target) || (session.role !== 'admin' && session.role !== target)) {
      throw new Error('이 역할의 비밀번호를 변경할 권한이 없습니다.');
    }
    if (!verifyRolePassword_(session.expected, current)) throw new Error('현재 로그인한 역할의 비밀번호를 확인하세요.');
    if (!validRolePassword_(password)) throw new Error('새 비밀번호는 9~128자로 입력하세요.');
    storeRolePassword_(properties, target, password);
    return {signedOut: session.role === target};
  } finally {
    lock.releaseLock();
  }
}

function validRolePassword_(value) {
  return typeof value === 'string' && value.length >= 9 && value.length <= 128 && value.trim() === value;
}

function randomRegisterToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function registerDigest_(value) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value));
}

function registerLogin(role, password) {
  const invalid = '역할과 비밀번호를 확인하세요.';
  if (!Object.hasOwn(ROLES, role) || !validRolePassword_(password)) throw new Error(invalid);
  const properties = PropertiesService.getScriptProperties();
  const expected = properties.getProperty('role-password:' + role);
  if (!verifyRolePassword_(expected, password)) throw new Error(invalid);
  const token = randomRegisterToken_();
  CacheService.getScriptCache().put('register-session:' + registerDigest_(token),
    JSON.stringify({role, expected}), 21600);
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
  if (!session || properties.getProperty('role-password:' + session.role) !== session.expected) {
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
    const {role} = registerSession_(token, properties);
    return handleRegister_(sheet, role, action, input || {});
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

function handleRegister_(sheet, role, action, input) {
  const actor = ROLES[role];
  if (!actor) throw new Error('역할을 확인할 수 없습니다.');
  const teachers = rows_(sheet, '강사');
  const contracts = rows_(sheet, '계약');
  const requests = rows_(sheet, '발급');
  const time = new Date().toISOString();
  const requireRole = (...roles) => {
    if (!roles.includes(role)) throw new Error('이 업무를 처리할 권한이 없습니다.');
  };
  const find = (records, id) => {
    const record = records.find(item => item.id === id);
    if (!record) throw new Error('해당 기록을 찾을 수 없습니다.');
    return record;
  };
  switch (action) {
    case 'read':
      return {
        role, roles: ROLES, schools: SCHOOL_NAMES, documents: DOCUMENTS,
        teachers: publicRows_(teachers), contracts: publicRows_(contracts), requests: publicRows_(requests),
      };
    case 'teacher': {
      requireRole('admin', 'staff');
      const prior = input.id ? find(teachers, input.id) : null;
      save_(sheet, '강사', prior, {name: text_(input.name, 80), updatedBy: actor, updatedAt: time});
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
        updatedBy: actor, updatedAt: time});
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
        records: publicRows_(records), status: '승인 대기', requestedBy: actor, requestedRole: role, requestedAt: time});
      break;
    }
    case 'review': {
      requireRole('admin', 'approver');
      const request = find(requests, input.id);
      if (request.status !== '승인 대기' || !['승인', '반려'].includes(input.status)) {
        throw new Error('승인 대기 중인 문서만 처리할 수 있습니다.');
      }
      if (request.requestedRole === role) throw new Error('요청한 역할과 다른 역할에서 승인해야 합니다.');
      const {id, row, ...saved} = request;
      save_(sheet, '발급', request, {...saved, status: input.status, reviewedBy: actor, reviewedAt: time,
        number: input.status === '승인' ? 'BA-' + id : ''});
      break;
    }
    default:
      throw new Error('지원하지 않는 작업입니다.');
  }
  return handleRegister_(sheet, role, 'read', {});
}
