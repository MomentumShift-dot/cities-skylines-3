// ============================================================================
//  단일 HTML 번들러 — ES 모듈 전체를 하나의 파일로 묶는다 (의존성 없음)
//
//  각 모듈을 IIFE로 감싸 모듈 객체를 만들고, import 는 그 객체에서 구조분해로
//  꺼내 쓰도록 바꾼다. 모듈마다 스코프가 분리되므로 이름 충돌이 생기지 않는다.
// ============================================================================
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = resolve(ROOT, 'src/main.js');
// 동적 import 로만 쓰이는 모듈도 번들에 포함시킨다
const EXTRA = ['src/demo.js', 'src/selftest.js'].map(p => resolve(ROOT, p));

const RE_IMPORT_NAMED = /^[ \t]*import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
const RE_IMPORT_STAR  = /^[ \t]*import\s*\*\s*as\s+([\w$]+)\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
const RE_EXPORT_DECL  = /^([ \t]*)export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\s)/gm;
const RE_EXPORT_LIST  = /^[ \t]*export\s*\{([^}]*)\};?[ \t]*$/gm;
const RE_DYNAMIC      = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

const id = f => relative(ROOT, f).split('\\').join('/');

const modules = new Map();   // id -> { file, src, deps:[ids], names:[], code }

async function load(file) {
  const key = id(file);
  if (modules.has(key)) return modules.get(key);
  const src = await readFile(file, 'utf8');
  const mod = { file, key, src, deps: [], names: [] };
  modules.set(key, mod);

  const depOf = spec => resolve(dirname(file), spec);
  const seen = new Set();
  const addDep = async spec => {
    const f = depOf(spec);
    const k = id(f);
    if (!seen.has(k)) { seen.add(k); mod.deps.push(k); }
    await load(f);
  };

  for (const m of src.matchAll(RE_IMPORT_NAMED)) await addDep(m[2]);
  for (const m of src.matchAll(RE_IMPORT_STAR))  await addDep(m[2]);
  for (const m of src.matchAll(RE_DYNAMIC))      await addDep(m[1]);
  return mod;
}

/** 모듈 본문을 IIFE 로 변환 */
function transform(mod) {
  let code = mod.src;
  const names = new Set();

  // export 선언 → 선언만 남기고 이름 수집
  code = code.replace(RE_EXPORT_DECL, '$1');
  for (const m of mod.src.matchAll(/^[ \t]*export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([\w$]+)/gm))
    names.add(m[1]);
  // export { a, b as c };
  code = code.replace(RE_EXPORT_LIST, (_, list) => {
    for (const part of list.split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    }
    return '';
  });

  const modRef = spec => `__M[${JSON.stringify(id(resolve(dirname(mod.file), spec)))}]`;

  // import { a, b as c } from '...' → const { a, b: c } = __M['...'];
  code = code.replace(RE_IMPORT_NAMED, (_, list, spec) => {
    const binds = list.split(',').map(s => s.trim()).filter(Boolean)
      .map(s => { const p = s.split(/\s+as\s+/); return p[1] ? `${p[0].trim()}: ${p[1].trim()}` : p[0].trim(); });
    return `const { ${binds.join(', ')} } = ${modRef(spec)};`;
  });
  // import * as X from '...' → const X = __M['...'];
  code = code.replace(RE_IMPORT_STAR, (_, ns, spec) => `const ${ns} = ${modRef(spec)};`);
  // 동적 import → 이미 로드된 모듈 객체
  code = code.replace(RE_DYNAMIC, (_, spec) => `Promise.resolve(${modRef(spec)})`);

  mod.names = [...names];
  const ret = mod.names.length ? `\n  return { ${mod.names.join(', ')} };\n` : '\n  return {};\n';
  return `__M[${JSON.stringify(mod.key)}] = (function () {\n${code}${ret}})();`;
}

/** 위상 정렬 */
function sorted() {
  const out = [], state = new Map();
  const visit = k => {
    const st = state.get(k);
    if (st === 2) return;
    if (st === 1) return;                   // 순환은 선언 호이스팅에 의존
    state.set(k, 1);
    for (const d of modules.get(k).deps) visit(d);
    state.set(k, 2);
    out.push(k);
  };
  for (const k of modules.keys()) visit(k);
  return out;
}

// ---------------------------------------------------------------------------
const main = await load(ENTRY);
for (const f of EXTRA) await load(f);

// main.js 는 부작용(게임 시작)이 있으므로 항상 마지막에 둔다
const order = sorted().filter(k => k !== main.key).concat(main.key);
const body = order.map(k => transform(modules.get(k))).join('\n\n');
const js = `const __M = {};\n\n${body}\n`;

const css = await readFile(resolve(ROOT, 'styles.css'), 'utf8');
const html = await readFile(resolve(ROOT, 'index.html'), 'utf8');

// index.html 에서 #app ~ 툴팁까지의 마크업만 추출
const bodyMatch = html.match(/<body>([\s\S]*?)<script[\s\S]*?<\/body>/);
if (!bodyMatch) throw new Error('index.html 본문을 찾지 못했습니다');
const markup = bodyMatch[1].trim();

const TITLE = 'Cities: Skylines III';
const FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏙️</text></svg>";

/** 아티팩트용: html/head/body 래퍼 없이 조각만 */
const fragment = `<title>${TITLE}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap">
<style>
${css}
</style>

${markup}

<script type="module">
${js}
</script>
`;

/** 단독 실행용: 파일을 그대로 열어도 동작하는 완전한 문서 */
const standalone = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>${TITLE}</title>
<link rel="icon" href="${FAVICON}">
<style>
${css}
</style>
</head>
<body>
${markup}
<script type="module">
${js}
</script>
</body>
</html>
`;

await mkdir(resolve(ROOT, 'dist'), { recursive: true });
await writeFile(resolve(ROOT, 'dist/cities-skylines-3.html'), standalone);
await writeFile(resolve(ROOT, 'dist/artifact.html'), fragment);

const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log(`모듈 ${order.length}개 번들 완료`);
console.log(`  dist/cities-skylines-3.html  ${kb(standalone.length)}  (단독 실행)`);
console.log(`  dist/artifact.html           ${kb(fragment.length)}  (아티팩트용 조각)`);
console.log('  포함 순서:', order.join(' → '));
