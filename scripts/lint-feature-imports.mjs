#!/usr/bin/env node
// `src/features/CLAUDE.md` states one layering rule: a cross-feature import goes
// through the barrel, `@/features/maps`, never a deep path into another
// feature. This is the ban. Any deep cross-feature import fails, with no
// baseline to lend it ground.
//
// Counted: every specifier in `src/features/**` and `src/app/**` that resolves
// under another feature, whether it is written `@/features/x/...` or as a
// relative path. Not counted: a bare `@/features/x` or `@/features/x/index`,
// which is the barrel and the point; `@/features/x/light`, the light entry
// below; a feature reaching into itself; and tests, which reach wherever the
// thing they test lives.
//
// The light entry. A feature whose barrel pulls its components in can offer a
// second public surface at `src/features/<x>/light.ts`, the one fixed name, for
// hooks and pure helpers a module that must not load those components needs.
// It counts as a barrel import. It is light by rule: `light.ts` fails the lint
// when it contains `export *`, or imports or re-exports anything under its own
// feature's `components/` or its own `index`, since either would make it the
// barrel under another name. A `light.ts` anywhere but the feature root is an
// ordinary deep path.
//
// One deep path is allowed to stay: a `require()` inside a function, which
// defers the module on purpose (a headless task that must not load a feature's
// native modules, a cycle the call breaks). Routing it through the barrel would
// load the whole feature at the call, so the permitted list,
// `scripts/feature-lazy-requires.json`, holds each one by file and specifier
// with the reason it is deferred. A listed require is not counted. An unlisted
// one counts like an import, as does a `require()` at module scope. An entry
// fails when it has no reason, when it matches no function-scope require, or
// when its file also imports the same feature at module scope, because the
// deferral then buys nothing.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { treeSources } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

// `--root` points the lint at another tree and `--lazy` at another permitted list,
// so the rule itself can be tested.
const ROOT = flagValue('--root', join(HERE, '..'));
const LAZY_FILE = flagValue('--lazy', join(HERE, 'feature-lazy-requires.json'));
const SRC = join(ROOT, 'src');
const FEATURES = join(SRC, 'features');
const APP = join(SRC, 'app');
const JSON_OUT = process.argv.includes('--json');

const APP_OWNER = '~app';

const FORBIDDEN_EDGES = new Map([
  ['maps -> routes', 'maps is a rendering layer: the caller passes route data in'],
]);

// The names a feature root answers to as a barrel import.
const ENTRIES = new Set(['index', 'light']);

// The tree this commit or merge records, not the disk another session is editing.
const TREE = treeSources(ROOT, [relative(ROOT, FEATURES), relative(ROOT, APP)]);
const relOf = (file) => relative(ROOT, file).split(sep).join('/');

function walk(dir) {
  const prefix = `${relOf(dir)}/`;
  const out = [];
  for (const rel of TREE.keys()) {
    if (!rel.startsWith(prefix)) continue;
    const parts = rel.slice(prefix.length).split('/');
    const name = parts[parts.length - 1];
    if (parts.slice(0, -1).some((part) => part === '__tests__' || part === '__mocks__')) continue;
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(name) || /\.d\.ts$/.test(name)) continue;
    out.push(join(ROOT, rel));
  }
  return out;
}

// Which feature owns this file? `src/app` is its own owner: it is not a feature
// but it imports across the same boundary and carries the largest edges.
function ownerOf(file) {
  const fromFeatures = relative(FEATURES, file);
  if (!fromFeatures.startsWith('..') && !fromFeatures.startsWith(sep))
    return fromFeatures.split(sep)[0];
  const fromApp = relative(APP, file);
  if (!fromApp.startsWith('..') && !fromApp.startsWith(sep)) return APP_OWNER;
  return null;
}

const absOf = (file, spec) => {
  if (spec.startsWith('@/')) return join(SRC, spec.slice(2));
  if (spec.startsWith('.')) return resolve(dirname(file), spec);
  return null;
};

// Resolve a specifier to { target, deep } when it lands inside a feature.
// `@/` is the alias for `src/`. A package name resolves to nothing.
function targetOf(file, spec) {
  const abs = absOf(file, spec);
  if (abs === null) return null;
  const rel = relative(FEATURES, abs);
  if (rel.startsWith('..') || rel.startsWith(sep) || rel === '') return null;
  const parts = rel.split(sep);
  const deep = parts.length > 2 || (parts.length === 2 && !ENTRIES.has(parts[1]));
  return { target: parts[0], deep };
}

const FUNCTION_KINDS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);

// Every module specifier the file actually resolves at build time: static
// imports and re-exports, `import()` and `require()`. Read from the syntax tree
// so a path quoted in a comment or a string is not one of them. `lazy` marks a
// `require()` inside a function, the only form the permitted list can cover.
function specifiersIn(file) {
  const src = TREE.get(relOf(file)).toString('utf8');
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const out = [];
  const push = (node, { lazy = false, star = false } = {}) => {
    if (node && ts.isStringLiteralLike(node))
      out.push({
        spec: node.text,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        lazy,
        star,
      });
  };
  const visit = (node, inFunction) => {
    if (ts.isImportDeclaration(node)) push(node.moduleSpecifier);
    else if (ts.isExportDeclaration(node)) push(node.moduleSpecifier, { star: !node.exportClause });
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      push(node.moduleReference.expression);
    else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const isDynamic = callee.kind === ts.SyntaxKind.ImportKeyword || isRequire;
      if (isDynamic && node.arguments.length > 0)
        push(node.arguments[0], { lazy: isRequire && inFunction });
    }
    ts.forEachChild(node, (child) => visit(child, inFunction || FUNCTION_KINDS.has(child.kind)));
  };
  visit(sf, false);
  return out;
}

function readLazyList() {
  if (!existsSync(LAZY_FILE)) return { entries: [], problems: [] };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(LAZY_FILE, 'utf8'));
  } catch (e) {
    return {
      entries: [],
      problems: [`${relative(ROOT, LAZY_FILE)} is not valid JSON: ${e.message}`],
    };
  }
  if (!Array.isArray(parsed))
    return { entries: [], problems: [`${relative(ROOT, LAZY_FILE)} must be a JSON array`] };
  return { entries: parsed, problems: [] };
}

// The `light.ts` files of the tree that break the rule that keeps them light.
function lightViolations() {
  const out = [];
  const prefix = `${relOf(FEATURES)}/`;
  for (const rel of TREE.keys()) {
    const parts = rel.startsWith(prefix) ? rel.slice(prefix.length).split('/') : [];
    if (parts.length !== 2 || parts[1] !== 'light.ts') continue;
    const feature = parts[0];
    const file = join(ROOT, rel);
    for (const { spec, line, star } of specifiersIn(file)) {
      let reason = null;
      if (star) reason = '`export *` re-exports whatever the target adds';
      else {
        const abs = absOf(file, spec);
        const within = abs === null ? '..' : relative(join(FEATURES, feature), abs);
        const first = within.split(sep)[0];
        if (first === 'components') reason = 'it reaches its own `components/`';
        else if (within === '' || first === 'index') reason = 'it reaches its own `index`';
      }
      if (reason !== null) out.push({ file: rel, line, spec, reason });
    }
  }
  return out;
}

function scan(permitted) {
  const deep = [];
  const forbidden = [];
  const lazyHits = [];
  const moduleScope = new Map();
  let barrel = 0;
  let lazyCount = 0;
  for (const file of [...walk(FEATURES), ...walk(APP)]) {
    const owner = ownerOf(file);
    if (owner === null) continue;
    const rel = relOf(file);
    for (const { spec, line, lazy } of specifiersIn(file)) {
      const hit = targetOf(file, spec);
      if (hit === null || hit.target === owner) continue;
      const edge = `${owner} -> ${hit.target}`;
      if (FORBIDDEN_EDGES.has(edge)) {
        forbidden.push({ file: rel, line, edge, spec });
        continue;
      }
      if (!lazy) {
        if (!moduleScope.has(rel)) moduleScope.set(rel, new Set());
        moduleScope.get(rel).add(hit.target);
      }
      if (!hit.deep) {
        barrel += 1;
        continue;
      }
      if (lazy) lazyHits.push({ file: rel, spec, target: hit.target });
      if (lazy && permitted.has(`${rel}\0${spec}`)) {
        lazyCount += 1;
        continue;
      }
      deep.push({ file: relative(ROOT, file), line, edge, spec });
    }
  }
  return { deep, forbidden, barrel, lazyCount, lazyHits, moduleScope };
}

// Problems with the permitted list itself, so an entry cannot outlive the
// require it excuses or excuse one with no stated reason.
function lazyProblems(entries, lazyHits, moduleScope) {
  const problems = [];
  for (const entry of entries) {
    const { file, spec, reason } = entry ?? {};
    const name = `${file}  ${spec}`;
    if (typeof file !== 'string' || typeof spec !== 'string') {
      problems.push(`an entry needs a file and a spec: ${JSON.stringify(entry)}`);
      continue;
    }
    if (typeof reason !== 'string' || reason.trim() === '') {
      problems.push(`${name}  has no reason`);
      continue;
    }
    if (!TREE.has(file)) continue;
    const hit = lazyHits.find((h) => h.file === file && h.spec === spec);
    if (!hit) {
      problems.push(`${name}  matches no function-scope require in the tree`);
      continue;
    }
    if (moduleScope.get(file)?.has(hit.target))
      problems.push(
        `${name}  the file also imports ${hit.target} at module scope, so the deferral buys nothing`
      );
  }
  return problems;
}

const hasBarrel = (feature) =>
  TREE.has(relOf(join(FEATURES, feature, 'index.ts'))) ||
  TREE.has(relOf(join(FEATURES, feature, 'index.tsx')));

function main() {
  const heavy = lightViolations();
  if (heavy.length > 0) {
    console.error('A light entry that is not light:');
    for (const v of heavy) console.error(`  ${v.file}:${v.line}  ${v.spec}  ${v.reason}`);
    console.error('');
    console.error('Fix: `light.ts` re-exports by name from hooks, lib and stores only. One that');
    console.error('     reaches the components or the index is the barrel under another name.');
    process.exit(1);
  }

  const { entries, problems: listProblems } = readLazyList();
  const permitted = new Set(
    entries
      .filter((e) => typeof e?.reason === 'string' && e.reason.trim() !== '')
      .map((e) => `${e.file}\0${e.spec}`)
  );
  const { deep, forbidden, barrel, lazyCount, lazyHits, moduleScope } = scan(permitted);
  if (forbidden.length > 0) {
    console.error('Imports across a direction that is forbidden:');
    for (const v of forbidden)
      console.error(`  ${v.file}:${v.line}  ${v.edge}  ${v.spec}  ${FORBIDDEN_EDGES.get(v.edge)}`);
    console.error('');
    console.error('Fix: pass the data or the callback in from the importing side, or move the');
    console.error('     helper to `src/shared`. A barrel import, a deep path and a permitted lazy');
    console.error('     require are all refused, and the baseline does not cover this edge.');
    process.exit(1);
  }

  const counts = new Map();
  for (const d of deep) counts.set(d.edge, (counts.get(d.edge) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  if (JSON_OUT) {
    console.log(JSON.stringify(Object.fromEntries(sorted), null, 2));
    return;
  }

  const problems = [...listProblems, ...lazyProblems(entries, lazyHits, moduleScope)];
  if (problems.length > 0) {
    console.error(
      'Permitted lazy requires in scripts/feature-lazy-requires.json that do not hold:'
    );
    for (const p of problems) console.error(`  ${p}`);
    console.error('');
    console.error('Fix: each entry names the file and specifier of a function-scope require()');
    console.error('     and says why it is deferred. Drop an entry when the require is gone or');
    console.error('     its file imports that feature at module scope anyway.');
    process.exit(1);
  }

  if (deep.length > 0) {
    console.error('Deep imports into another feature:');
    for (const [edge, n] of sorted) {
      console.error(`  ${edge}  ${n}`);
      for (const d of deep.filter((x) => x.edge === edge))
        console.error(`    ${d.file}:${d.line}  ${d.edge}  ${d.spec}`);
    }
    console.error('');
    console.error("Fix: import the target feature's barrel, `@/features/<name>`, and export what");
    console.error('     you need from it. The barrel is the rule in src/features/CLAUDE.md. A');
    console.error('     module that must not load the barrel imports `@/features/<name>/light`.');
    console.error(
      '     A require() inside a function that defers the module on purpose stays deep'
    );
    console.error('     when scripts/feature-lazy-requires.json lists its file and specifier with');
    console.error('     the reason.');
    const missing = [...new Set(sorted.map(([edge]) => edge.split(' -> ')[1]))]
      .filter((t) => !hasBarrel(t))
      .sort();
    if (missing.length > 0) {
      console.error('');
      console.error(`No barrel exists yet for: ${missing.join(', ')}.`);
      console.error('     Create src/features/<name>/index.ts re-exporting by name exactly what');
      console.error('     you need, never `export *`: the deleted ones re-exported sub-barrels');
      console.error('     that went with them.');
    }
    process.exit(1);
  }

  const total = deep.length + barrel;
  console.log('lint-feature-imports: OK');
  console.log(
    `  cross-feature imports: ${total}, ${barrel} barrel, ${deep.length} deep, ${lazyCount} lazy require(s) permitted`
  );
}

main();
