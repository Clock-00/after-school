const navButtons = document.querySelectorAll('[data-view]');
const views = document.querySelectorAll('.view');
const instructorsById = new Map(demoInstructors.map(instructor => [instructor.id, instructor]));
const filters = document.getElementById('career-filters');
const directorySearch = document.getElementById('directory-search');
const careerResults = document.getElementById('career-results');
const directoryResults = document.getElementById('directory-results');
let detailSource = 'career';
let detailTrigger;

function showView(view, currentMenu = view, focus = true) {
  views.forEach(section => section.classList.toggle('active', section.id === view));
  navButtons.forEach(button => {
    const active = button.dataset.view === currentMenu;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (focus) {
    const heading = document.querySelector('#' + view + ' h1');
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

function element(tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}

function instructorSummary(records) {
  const schools = [...new Set(records.map(record => demoSchools[record.school]))];
  const programs = [...new Set(records.map(record => record.program))];
  return [schools.join(' · '), programs.join(' · ')].filter(Boolean).join(' / ');
}

function detailButton(instructor, source) {
  const button = element('button', instructor.name, 'text-button');
  button.type = 'button';
  button.setAttribute('aria-label', instructor.name + ' ' + instructor.id + ' 전체 경력 보기');
  button.addEventListener('click', () => openDetail(instructor, source, button));
  return button;
}

function recordFields(record, detailed) {
  const list = document.createElement('dl');
  const fields = [
    ['학년도', record.year + '학년도'],
    ['학교', demoSchools[record.school]],
    ['프로그램', record.program],
    ['계약 상태', record.status],
    ['계약기간', record.contract.join(' ~ ')],
  ];
  if (detailed) {
    fields.push(
      ['계약 유형', record.type],
      ['실제 활동기간', record.activity?.join(' ~ ') ?? '미확인'],
      ['확인된 강의시간', record.hours === null ? '미확인' : record.hours + '시간'],
    );
  }
  for (const [label, value] of fields) {
    const group = document.createElement('div');
    group.append(element('dt', label), element('dd', value));
    list.append(group);
  }
  return list;
}

function openDetail(instructor, source, trigger) {
  detailSource = source;
  detailTrigger = trigger;
  const records = demoRecords.filter(record => record.instructorId === instructor.id);
  document.getElementById('detail-title').textContent = instructor.name + ' 강사 경력';
  document.getElementById('detail-summary').textContent =
    instructor.id + ' · ' + instructorSummary(records);
  document.getElementById('detail-records').replaceChildren(...records.map(record => {
    const item = document.createElement('li');
    item.append(recordFields(record, true));
    return item;
  }));
  showView('instructor-detail', source);
}

function renderDirectory() {
  const name = directorySearch.value.trim().normalize();
  const matches = demoInstructors.filter(instructor => instructor.name.normalize().includes(name));
  document.getElementById('directory-count').textContent = matches.length
    ? '강사 ' + matches.length + '명' : '일치하는 강사가 없습니다.';
  directoryResults.replaceChildren(...matches.map(instructor => {
    const records = demoRecords.filter(record => record.instructorId === instructor.id);
    const item = document.createElement('li');
    item.append(detailButton(instructor, 'instructors'), element('span', instructor.id, 'record-id'),
      element('p', instructorSummary(records)));
    return item;
  }));
}

function renderCareer() {
  const { name, year, school, program } = filters.elements;
  const query = name.value.trim().normalize();
  const matches = demoRecords.filter(record =>
    instructorsById.get(record.instructorId).name.normalize().includes(query) &&
    (!year.value || String(record.year) === year.value) &&
    (!school.value || record.school === school.value) &&
    (!program.value || record.program === program.value));
  document.getElementById('career-count').textContent = matches.length
    ? '경력 ' + matches.length + '건' : '검색 조건과 일치하는 경력이 없습니다.';
  careerResults.replaceChildren(...matches.map(record => {
    const instructor = instructorsById.get(record.instructorId);
    const item = document.createElement('li');
    item.append(detailButton(instructor, 'career'), element('span', instructor.id, 'record-id'),
      recordFields(record, false));
    return item;
  }));
}

const years = [...new Set(demoRecords.map(record => record.year))].sort((a, b) => b - a);
const programs = [...new Set(demoRecords.map(record => record.program))]
  .sort((a, b) => a.localeCompare(b, 'ko'));
years.forEach(year => filters.elements.year.add(new Option(year + '학년도', year)));
Object.entries(demoSchools).forEach(([id, name]) => filters.elements.school.add(new Option(name, id)));
programs.forEach(program => filters.elements.program.add(new Option(program, program)));

navButtons.forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
document.querySelectorAll('[data-go]').forEach(button => {
  button.addEventListener('click', () => showView(button.dataset.go));
});
document.getElementById('back-to-results').addEventListener('click', () => {
  showView(detailSource, detailSource, false);
  detailTrigger.focus();
});
directorySearch.addEventListener('input', renderDirectory);
filters.addEventListener('submit', event => event.preventDefault());
filters.addEventListener('input', renderCareer);
filters.addEventListener('reset', () => setTimeout(renderCareer, 0));

showView('home', 'home', false);
renderDirectory();
renderCareer();
