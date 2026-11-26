# 백암초 방과후 통합 관리 — GitHub Pages 입문용

**주의: 화면 시연용입니다.** 로그인, 실제 데이터 저장, PDF, 승인 기능은 아직 없습니다. 실제 학생·강사 개인정보, 비밀번호, API 키, 계약서 등을 공개 저장소에 올리지 마세요.

## 파일 안내
- `index.html`: 웹사이트의 구조와 글
- `style.css`: 색상, 크기, 모바일 화면 모양
- `script.js`: 메뉴 이동과 시연용 가상 강사 검색

## GitHub에 게시하기
1. https://github.com 에 가입하고 로그인합니다.
2. 우측 상단 `+` → `New repository`를 누릅니다.
3. Repository name에 `after-school`을 입력하고 Public을 선택한 뒤 `Create repository`를 누릅니다.
4. 저장소 화면에서 `uploading an existing file` 또는 `Add file` → `Upload files`를 선택합니다.
5. **ZIP 자체가 아니라 압축 해제한 폴더 안의** `index.html`, `style.css`, `script.js`, `README.md` 4개 파일을 업로드합니다.
6. `Commit changes`를 누릅니다.
7. `Settings` → `Pages` → Build and deployment에서 Source=`Deploy from a branch`, Branch=`main`, Folder=`/(root)`를 선택해 Save 합니다.
8. 잠시 후 `https://본인아이디.github.io/after-school/` 주소로 접속합니다.

계정 이름과 저장소 이름에 따라 주소가 달라집니다. 게시 후 실제 데이터 연결 전 인증·권한·백엔드 보안 설계가 필요합니다.

공식 안내: https://docs.github.com/ko/pages/getting-started-with-github-pages/creating-a-github-pages-site
