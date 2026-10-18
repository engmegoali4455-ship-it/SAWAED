// بعد next build: يكتب out/sw.js مع قائمة بكل ملفات التطبيق لتخزينها مسبقاً (العمل دون اتصال).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const OUT = 'out';
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push('/' + relative(OUT, p).replace(/\\/g, '/'));
  }
})(OUT);
const precache = files.filter((f) => !f.endsWith('.map') && f !== '/sw.js' && !f.endsWith('/404.html'))
  .map((f) => (f.endsWith('/index.html') ? f.slice(0, -'index.html'.length) : f));
const hash = createHash('sha256');
for (const f of files.filter((f) => f !== '/sw.js')) hash.update(f).update(readFileSync(join(OUT, f)));
const version = hash.digest('hex').slice(0, 12);
const template = readFileSync('scripts/sw.template.js', 'utf8');
writeFileSync(join(OUT, 'sw.js'), template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache)));
console.log(`sw.js: ${precache.length} ملفاً، الإصدار ${version}`);
