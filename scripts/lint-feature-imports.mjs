#!/usr/bin/env node
// `src/features/CLAUDE.md` states one layering rule: a cross-feature import goes
// through the barrel, `@/features/maps`, never a deep path into another
// feature. Nothing enforced it, and 91 per cent of the tree's cross-feature
// imports are deep paths, so demanding zero would fail every commit.
//
// This is a ratchet instead. `scripts/feature-import-baseline.json` holds the
// deep count for each owner -> target edge as it stands. An edge above its
// baseline fails, an edge the baseline never listed fails, and an edge the tree
// has already beaten fails with the number to paste back, so the ground a sweep
// takes cannot be given away again.
//
// Counted: every specifier in `src/features/**` and `src/app/**` that resolves
// under another feature, whether it is written `@/features/x/...` or as a
// relative path. Not counted: a bare `@/features/x` or `@/features/x/index`,
// which is the barrel and the point; a feature reaching into itself; and tests,
// which reach wherever the thing they test lives.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));

const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

// `--root` points the lint at another tree and `--baseline` at another file, so
// the rule itself can be tested.
const ROOT = flagValue('--root', join(HERE, '..'));
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'feature-import-baseline.json'));
const SRC = join(ROOT, 'src');
const FEATURES = join(SRC, 'features');
const APP = join(SRC, 'app');
const JSON_OUT = process.argv.includes('--json');
const VERBOSE = process.argv.includes('--verbose');

const APP_OWNER = '~app';

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === '__mocks__') continue;
      out.push(...walk(full));
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(name) || /\.d\.ts$/.test(name)) continue;
    out.push(full);
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

// Resolve a specifier to { target, deep } when it lands inside a feature.
// `@/` is the alias for `src/`. A package name resolves to nothing.
function targetOf(file, spec) {
  let abs = null;
  if (spec.startsWith('@/')) abs = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) abs = resolve(dirname(file), spec);
  if (abs === null) return null;
  const rel = relative(FEATURES, abs);
  if (rel.startsWith('..') || rel.startsWith(sep) || rel === '') return null;
  const parts = rel.split(sep);
  const deep = parts.length > 2 || (parts.length === 2 && parts[1] !== 'index');
  return { target: parts[0], deep };
}

// Every module specifier the file actually resolves at build time: static
// imports and re-exports, `import()` and `require()`. Read from the syntax tree
// so a path quoted in a comment or a string is not one of them.
function specifiersIn(file) {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const out = [];
  const push = (node) => {
    if (node && ts.isStringLiteralLike(node))
      out.push({
        spec: node.text,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) push(node.moduleSpecifier);
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      push(node.moduleReference.expression);
    else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamic =
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === 'require');
      if (isDynamic && node.arguments.length > 0) push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function scan() {
  const deep = [];
  let barrel = 0;
  for (const file of [...walk(FEATURES), ...walk(APP)]) {
    const owner = ownerOf(file);
    if (owner === null) continue;
    for (const { spec, line } of specifiersIn(file)) {
      const hit = targetOf(file, spec);
      if (hit === null || hit.target === owner) continue;
      if (!hit.deep) {
        barrel += 1;
        continue;
      }
      deep.push({ file: relative(ROOT, file), line, edge: `${owner} -> ${hit.target}`, spec });
    }
  }
  return { deep, barrel };
}

// A baseline edge naming a feature this tree does not have says nothing about
// it. That is what lets a fixture root run against the real baseline.
function edgePresent(edge) {
  const [owner, target] = edge.split(' -> ');
  const ownerDir = owner === APP_OWNER ? APP : join(FEATURES, owner);
  return existsSync(ownerDir) && existsSync(join(FEATURES, target));
}

const hasBarrel = (feature) =>
  existsSync(join(FEATURES, feature, 'index.ts')) ||
  existsSync(join(FEATURES, feature, 'index.tsx'));

function main() {
  const { deep, barrel } = scan();
  const counts = new Map();
  for (const d of deep) counts.set(d.edge, (counts.get(d.edge) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  if (JSON_OUT) {
    console.log(JSON.stringify(Object.fromEntries(sorted), null, 2));
    return;
  }

  const baseline = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : {};
  const allowed = (edge) => baseline[edge] ?? 0;

  const over = sorted.filter(([edge, n]) => n > allowed(edge));
  const beaten = Object.keys(baseline)
    .filter((edge) => edgePresent(edge) && (counts.get(edge) ?? 0) < baseline[edge])
    .sort();

  if (VERBOSE) {
    for (const [edge, n] of sorted) console.log(`  ${edge}  ${n}, baseline ${allowed(edge)}`);
    console.log('');
  }

  if (over.length > 0) {
    console.error('Deep imports into another feature, above what the baseline allows:');
    for (const [edge, n] of over) {
      console.error(`  ${edge}  ${n}, baseline ${allowed(edge)}`);
      for (const d of deep.filter((x) => x.edge === edge))
        console.error(`    ${d.file}:${d.line}  ${d.edge}  ${d.spec}`);
    }
    console.error('');
    console.error("Fix: import the target feature's barrel, `@/features/<name>`, and export what");
    console.error('     you need from it. The barrel is the rule in src/features/CLAUDE.md, and');
    console.error('     the baseline in scripts/feature-import-baseline.json only moves down.');
    const missing = [...new Set(over.map(([edge]) => edge.split(' -> ')[1]))]
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

  if (beaten.length > 0) {
    console.error('Baseline entries the tree is already under (lower them, or the ground is lent');
    console.error('back to the next deep import):');
    for (const edge of beaten)
      console.error(`  ${edge}  ${counts.get(edge) ?? 0}, baseline ${baseline[edge]}`);
    console.error('');
    console.error('Fix: paste those numbers into scripts/feature-import-baseline.json, or drop');
    console.error('     the entry when the count is 0.');
    process.exit(1);
  }

  const total = deep.length + barrel;
  console.log('lint-feature-imports: OK');
  console.log(
    `  cross-feature imports: ${total}, ${barrel} barrel, ${deep.length} deep over ${counts.size} edge(s), baseline ${Object.values(baseline).reduce((a, b) => a + b, 0)}`
  );
}

main();
