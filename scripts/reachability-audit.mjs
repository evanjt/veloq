#!/usr/bin/env node
// A module is dead if nothing real reaches it. A barrel naming a module does not
// make it reachable: the largest block of dead TypeScript this repo has carried
// was fifteen components whose only importer was their feature's index.ts. They
// type-checked, formatted, bundled and grepped like live code, so every other
// check passed them. This one encodes the rule that catches the whole class.
//
// A module under src/ is flagged when:
//   (a) nothing imports it at all, or
//   (b) every importer is an index barrel and no real file ever imports one of
//       its exported symbols through the chain of barrels that re-export it.
//
// Reachability is propagated by SYMBOL, not by file. A real file importing
// { Button } from '@/shared/ui' reaches only the module the barrel maps Button
// to. Names are matched exactly - Button never satisfies IconButton,
// AnimatedButton or TipButtons, and DataSection never satisfies
// SupportingDataSection. A near-miss on that trap once cost the wrong deletion.
//
// Not flagged, because they are reachable without an importer:
//   - src/app/** - Expo Router discovers routes by path convention.
//   - anything named by require(), dynamic import(), jest.mock(), app.json,
//     app.config.js or a prebuild plugin.
//   - .d.ts declarations, which are not modules.
// Modules reached only from src/__tests__/** are reported separately as
// test-only. That is a different judgement and does not fail the audit.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

const rel = (p) => relative(ROOT, p);

// Deliberate exceptions. Each entry needs a reason: the rule stays strict and
// the exception is recorded, rather than the rule being weakened to fit.
const ALLOWLIST = new Map([
  // Deliberately unmounted while recording is feature-gated off. Kept for
  // re-enabling, and guarded by src/__tests__/bugs/noWritePermissionPrompt.test.ts,
  // which asserts no shipping file mounts it.
  [
    'src/features/settings/components/RecordingPermissionSection.tsx',
    'intentionally unwired, see US-PRM1 test',
  ],
  [
    'src/features/home/components/InsightLine.tsx',
    'deliberately disabled, see the note at src/app/(tabs)/index.tsx:207',
  ],
]);

const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'ios', 'android', 'coverage', '.expo']);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const isTest = (p) => rel(p).startsWith('src/__tests__/');
const isRoute = (p) => rel(p).startsWith('src/app/');
// An index.tsx under src/app/ is a route, not a barrel: Expo Router maps it to
// the directory's own path and it imports like any other real file.
const isBarrel = (p) => /(?:^|\/)index\.tsx?$/.test(rel(p)) && !isRoute(p);
const isDeclaration = (p) => p.endsWith('.d.ts');

// A module file, ie. a candidate for the audit.
const isModule = (p) =>
  rel(p).startsWith('src/') && /\.tsx?$/.test(p) && !isDeclaration(p) && !isRoute(p) && !isTest(p);

const RESOLVE_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

function resolveSpecifier(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else if (spec.startsWith('/')) base = spec;
  else return null; // bare package
  // A `.js` specifier in TS source means the sibling .ts.
  const candidates = base.endsWith('.js')
    ? [
        base.replace(/\.js$/, '.ts'),
        base.replace(/\.js$/, '.tsx'),
        base,
        ...RESOLVE_EXT.map((e) => base + e),
      ]
    : RESOLVE_EXT.map((e) => base + e);
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

// --- parsing -------------------------------------------------------------

// Names bound by an import/export clause. WILDCARD means the whole module
// surface is demanded (namespace import, side-effect import, `export *`).
const WILDCARD = '*';

function parseClause(clause) {
  const names = new Set();
  let text = clause.trim().replace(/^type\s+/, '');
  if (text === '') return names; // side-effect handled by the caller
  if (/^\*\s+as\s/.test(text)) return new Set([WILDCARD]);
  const braceStart = text.indexOf('{');
  if (braceStart === -1) {
    // `import Default from` or `import Default, * as ns from`
    if (/\*\s+as\s/.test(text)) names.add(WILDCARD);
    if (/^[A-Za-z_$][\w$]*/.test(text)) names.add('default');
    return names;
  }
  const head = text.slice(0, braceStart).replace(/,\s*$/, '').trim();
  if (head !== '') names.add('default');
  const body = text.slice(braceStart + 1, text.lastIndexOf('}'));
  for (const piece of body.split(',')) {
    const p = piece.trim().replace(/^type\s+/, '');
    if (p === '') continue;
    const m = /^([A-Za-z_$][\w$]*|default)\b/.exec(p);
    if (m) names.add(m[1]);
  }
  return names;
}

// Static edges out of a file: { spec, names, kind }. The kind matters for
// barrels - a re-export forwards someone else's demand, while a plain import
// means the barrel itself uses the value and is a real consumer of it.
function parseImports(src) {
  const out = [];
  const re =
    /(?:^|[\s;}])(import|export)\s+((?:type\s+)?(?:\*\s+as\s+[\w$]+|\{[\s\S]*?\}|[\w$]+(?:\s*,\s*(?:\{[\s\S]*?\}|\*\s+as\s+[\w$]+))?))\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)))
    out.push({
      spec: m[3],
      names: parseClause(m[2]),
      kind: m[1] === 'import' ? 'import' : 'reexport',
    });
  const star = /(?:^|[\s;}])export\s+(?:type\s+)?\*(?:\s+as\s+[\w$]+)?\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = star.exec(src)))
    out.push({ spec: m[1], names: new Set([WILDCARD]), kind: 'reexport' });
  const side = /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g;
  while ((m = side.exec(src))) out.push({ spec: m[1], names: new Set([WILDCARD]), kind: 'import' });
  return out;
}

// Paths named at runtime rather than by a static import. Treated as full
// consumers: the module surface is demanded and the target stays alive.
function parseDynamic(src, bareStrings) {
  const out = [];
  const re =
    /(?:require|import|jest\.mock|jest\.doMock|jest\.requireActual)\s*\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  // A plain path string in app.json or a prebuild plugin is a reference, eg.
  // "./src/plugins/with-x". Only config files get this: inside TS the same
  // string is the specifier of a static import that was already parsed by
  // name, and re-reading it here would demand the whole module surface and
  // erase the symbol precision the audit depends on.
  if (!bareStrings) return out;
  const pathish = /['"](\.{1,2}\/[\w./@-]+|@\/[\w./-]+)['"]/g;
  while ((m = pathish.exec(src))) out.push(m[1]);
  return out;
}

// Names a module exports itself, used to decide which `export *` source
// satisfies a demanded name.
function parseOwnExports(src) {
  const names = new Set();
  let m;
  const decl =
    /(?:^|[\s;}])export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function\s*\*?|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = decl.exec(src))) names.add(m[1]);
  const localList = /(?:^|[\s;}])export\s*\{([\s\S]*?)\}\s*(?!from)/g;
  while ((m = localList.exec(src))) {
    for (const piece of m[1].split(',')) {
      const p = piece.trim().replace(/^type\s+/, '');
      if (p === '') continue;
      const as = /\bas\s+([A-Za-z_$][\w$]*|default)\s*$/.exec(p);
      names.add(as ? as[1] : (/^([A-Za-z_$][\w$]*)/.exec(p) || [])[1]);
    }
  }
  if (/(?:^|[\s;}])export\s+default\b/.test(src)) names.add('default');
  return names;
}

// Re-exports of a barrel: exported name -> { file, name }, plus the `export *`
// sources whose own exports have to be consulted for an unlisted name.
function parseReExports(src, file) {
  const named = new Map();
  const stars = [];
  let m;
  const list = /(?:^|[\s;}])export\s*(?:type\s*)?\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = list.exec(src))) {
    const target = resolveSpecifier(m[2], file);
    if (!target) continue;
    for (const piece of m[1].split(',')) {
      const p = piece.trim().replace(/^type\s+/, '');
      if (p === '') continue;
      const as = /^([A-Za-z_$][\w$]*|default)\s+as\s+([A-Za-z_$][\w$]*|default)$/.exec(p);
      if (as) named.set(as[2], { file: target, name: as[1] });
      else {
        const n = (/^([A-Za-z_$][\w$]*|default)/.exec(p) || [])[1];
        if (n) named.set(n, { file: target, name: n });
      }
    }
  }
  const star = /(?:^|[\s;}])export\s+(?:type\s+)?\*(?:\s+as\s+([\w$]+))?\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = star.exec(src))) {
    const target = resolveSpecifier(m[2], file);
    if (target) stars.push({ file: target, namespaced: Boolean(m[1]), ns: m[1] || null });
  }
  return { named, stars };
}

// --- graph ---------------------------------------------------------------

const files = new Map(); // abs path -> { src, imports, ownExports, reExports }

function load(file) {
  if (files.has(file)) return files.get(file);
  const src = readFileSync(file, 'utf8');
  const entry = {
    src,
    imports: parseImports(src),
    ownExports: parseOwnExports(src),
    reExports: parseReExports(src, file),
  };
  files.set(file, entry);
  return entry;
}

// Walk demand from one consumer edge, marking every module the names actually
// land on. Barrels forward demand; they are not the destination.
function markDemand(target, names, reached, seen = new Set()) {
  const key = `${target}::${[...names].sort().join(',')}`;
  if (seen.has(key)) return;
  seen.add(key);
  reached.add(target);
  if (!isBarrel(target)) return;

  const entry = load(target);
  // An index.ts that composes rather than only re-exports (eg. a map style
  // assembled from layer modules) is real code once reached, so its plain
  // imports are real consumption.
  for (const edge of entry.imports) {
    if (edge.kind !== 'import') continue;
    const dep = resolveSpecifier(edge.spec, target);
    if (dep && rel(dep).startsWith('src/')) markDemand(dep, edge.names, reached, seen);
  }

  const { named, stars } = entry.reExports;
  const wildcard = names.has(WILDCARD);
  const wanted = wildcard ? [...named.keys()] : [...names];

  for (const n of wanted) {
    const hit = named.get(n);
    if (hit) markDemand(hit.file, new Set([hit.name]), reached, seen);
  }
  for (const s of stars) {
    if (wildcard || s.namespaced) {
      markDemand(s.file, new Set([WILDCARD]), reached, seen);
      continue;
    }
    const surface = exportSurface(s.file);
    const forwarded = [...names].filter((n) => surface.has(n));
    if (forwarded.length > 0) markDemand(s.file, new Set(forwarded), reached, seen);
  }
}

const surfaceCache = new Map();
// Every name a module exposes, following `export *` chains.
function exportSurface(file, seen = new Set()) {
  if (surfaceCache.has(file)) return surfaceCache.get(file);
  if (seen.has(file)) return new Set();
  seen.add(file);
  const entry = load(file);
  const names = new Set(entry.ownExports);
  for (const [n] of entry.reExports.named) names.add(n);
  for (const s of entry.reExports.stars) {
    if (s.namespaced) {
      // `export * as ns from './m'` publishes exactly one name, `ns`.
      if (s.ns) names.add(s.ns);
      continue;
    }
    for (const n of exportSurface(s.file, seen)) names.add(n);
  }
  surfaceCache.set(file, names);
  return names;
}

function propagate(consumers) {
  const reached = new Set();
  for (const file of consumers) {
    const entry = load(file);
    for (const { spec, names } of entry.imports) {
      const target = resolveSpecifier(spec, file);
      if (!target || !rel(target).startsWith('src/')) continue;
      markDemand(target, names, reached);
    }
    for (const spec of parseDynamic(entry.src, !/\.tsx?$/.test(file))) {
      const target = resolveSpecifier(spec, file);
      if (target && rel(target).startsWith('src/'))
        markDemand(target, new Set([WILDCARD]), reached);
    }
  }
  return reached;
}

function main() {
  const srcFiles = walk(SRC).filter((f) => CODE_EXT.test(f));
  if (srcFiles.length === 0) {
    console.error(`reachability-audit: no source files under ${rel(SRC)}. Wrong root?`);
    process.exit(2);
  }
  const modules = srcFiles.filter(isModule);

  // Config and native-plugin files can name a src path without importing it.
  const configFiles = [
    ...[
      'app.json',
      'app.config.js',
      'babel.config.js',
      'react-native.config.js',
      'metro.config.js',
    ].map((f) => join(ROOT, f)),
    ...walk(join(ROOT, 'config')).filter((f) => /\.(?:js|json|ts)$/.test(f)),
    ...walk(join(ROOT, 'modules')).filter((f) => CODE_EXT.test(f) && !f.includes('/rust/')),
    ...walk(join(ROOT, 'scripts')).filter((f) => /\.(?:js|mjs|cjs|ts)$/.test(f)),
  ].filter((f) => existsSync(f));

  // Real code: everything under src/ that is not a test, plus routes, plus the
  // config surface. Barrels are included as consumers only through the demand
  // they forward, never as the reason a module is alive.
  const realConsumers = [
    ...srcFiles.filter((f) => /\.tsx?$/.test(f) && !isTest(f) && !isBarrel(f) && !isDeclaration(f)),
    ...configFiles,
  ];
  const testConsumers = srcFiles.filter(isTest);

  const reachedReal = propagate(realConsumers);
  const reachedTest = propagate(testConsumers);

  const dead = [];
  const testOnly = [];
  for (const m of modules) {
    if (reachedReal.has(m)) continue;
    if (ALLOWLIST.has(rel(m))) continue;
    (reachedTest.has(m) ? testOnly : dead).push(rel(m));
  }
  dead.sort();
  testOnly.sort();

  if (testOnly.length > 0) {
    console.log('Test-only modules (reached from src/__tests__ but from no real code):');
    for (const f of testOnly) console.log(`  ${f}`);
    console.log('');
  }

  // A dead module and an unused barrel are different judgements. A module
  // nothing can reach is a defect. A barrel nobody imports is unused surface,
  // which is worth knowing but is a style call, so it does not fail the run.
  const deadModules = dead.filter((f) => !isBarrel(join(ROOT, f)));
  const unusedBarrels = dead.filter((f) => isBarrel(join(ROOT, f)));

  if (unusedBarrels.length > 0) {
    console.log('Unused barrels (nothing imports them; not a failure):');
    for (const f of unusedBarrels) console.log(`  ${f}`);
    console.log('');
  }

  if (deadModules.length > 0) {
    console.error('Unreachable modules (no importer, or barrel-only with no symbol consumer):');
    for (const f of deadModules) console.error(`  ${f}`);
    console.error('');
    console.error('Fix: delete the module, or import one of its symbols from real code.');
    console.error('     A re-export in an index.ts is not a consumer. If the module must');
    console.error('     stay, add it to ALLOWLIST in this script with a reason.');
    process.exit(1);
  }

  console.log('reachability-audit: OK');
  console.log(
    `  modules checked: ${modules.length}, reachable: ${modules.length - testOnly.length}, test-only: ${testOnly.length}, allowlisted: ${ALLOWLIST.size}`
  );
}

main();
