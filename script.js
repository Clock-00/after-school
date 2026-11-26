// 모든 기록은 시연용 가상 데이터입니다. 실제 개인정보를 추가하지 마세요.
const demoRecords = [
  {name:'김가람', year:2024, school:'본교', program:'바이올린', dates:'2024.03.01 ~ 2025.02.28'},
  {name:'김가람', year:2025, school:'본교', program:'바이올린', dates:'2025.03.01 ~ 2026.02.28'},
  {name:'김가람', year:2026, school:'본교', program:'바이올린', dates:'2026.03.01 ~ 2027.02.28'},
  {name:'박하늘', year:2025, school:'수정분교장', program:'책놀이', dates:'2025.03.01 ~ 2026.02.28'},
  {name:'박하늘', year:2026, school:'수정분교장', program:'책놀이', dates:'2026.03.01 ~ 2027.02.28'},
];
const navButtons = document.querySelectorAll('[data-view]');
function showView(view) {
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === view));
  navButtons.forEach(el => el.classList.toggle('active', el.dataset.view === view));
  window.scrollTo(0,0);
}
navButtons.forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click',()=>showView(b.dataset.go)));
function render() {
  const name = document.querySelector('#search').value.trim();
  const year = document.querySelector('#year').value;
  const school = document.querySelector('#school').value;
  const results = demoRecords.filter(r => r.name.includes(name) && (year==='all' || String(r.year)===year) && (school==='all'||r.school===school));
  const tbody = document.querySelector('#results');
  tbody.replaceChildren();
  if (!results.length) {const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=5;td.textContent='일치하는 예시 데이터가 없습니다.';tr.append(td);tbody.append(tr);return;}
  results.forEach(r=>{const tr=document.createElement('tr');[r.name,String(r.year),r.school,r.program,r.dates].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td)});tbody.append(tr)});
}
['search','year','school'].forEach(id => document.getElementById(id).addEventListener('input',render));
render();
