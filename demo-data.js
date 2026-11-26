// 모든 성명과 이력은 가상입니다. 실제 개인정보를 추가하지 마세요.
const demoSchools = {
  main: '백암초 본교',
  branch: '수정분교장',
};

const demoInstructors = [
  { id: 'DEMO-001', name: '김가람' },
  { id: 'DEMO-002', name: '박하늘' },
  { id: 'DEMO-003', name: '김가람' },
];

const demoRecords = [
  {
    instructorId: 'DEMO-001', year: 2026, school: 'main', program: '바이올린',
    contract: ['2026.03.01', '2027.02.28'], activity: null, hours: null,
    status: '계약 중', type: '재계약',
  },
  {
    instructorId: 'DEMO-001', year: 2025, school: 'main', program: '바이올린',
    contract: ['2025.03.01', '2026.02.28'], activity: ['2025.03.06', '2025.12.18'],
    hours: 64, status: '활동 종료', type: '재계약',
  },
  {
    instructorId: 'DEMO-001', year: 2025, school: 'branch', program: '합주',
    contract: ['2025.09.01', '2026.02.28'], activity: ['2025.09.05', '2025.12.19'],
    hours: 24, status: '활동 종료', type: '신규',
  },
  {
    instructorId: 'DEMO-001', year: 2024, school: 'main', program: '바이올린',
    contract: ['2024.03.01', '2025.02.28'], activity: ['2024.03.07', '2024.12.19'],
    hours: 60, status: '활동 종료', type: '신규',
  },
  {
    instructorId: 'DEMO-002', year: 2026, school: 'branch', program: '책놀이',
    contract: ['2026.03.01', '2027.02.28'], activity: null, hours: null,
    status: '계약 중', type: '재계약',
  },
  {
    instructorId: 'DEMO-002', year: 2025, school: 'branch', program: '책놀이',
    contract: ['2025.03.01', '2026.02.28'], activity: ['2025.03.10', '2025.12.15'],
    hours: 40, status: '활동 종료', type: '신규',
  },
  {
    instructorId: 'DEMO-003', year: 2026, school: 'branch', program: '미술',
    contract: ['2026.03.01', '2027.02.28'], activity: null, hours: null,
    status: '계약 중', type: '신규',
  },
];
