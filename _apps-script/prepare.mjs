import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';

const source = name => new URL(name, import.meta.url);
const target = name => source('./build/' + name);
mkdirSync(target(''), { recursive: true });
for (const name of ['Code.js', 'Index.html', 'appsscript.json']) {
  copyFileSync(source('./' + name), target(name));
}
copyFileSync(source('../style.css'), target('Styles.html'));
copyFileSync(source('../demo-data.js'), target('DemoData.js'));
writeFileSync(target('.claspignore'), '.clasp.json\n.claspignore\n');
console.log('Apps Script 배포 파일: ' + target('').pathname);
