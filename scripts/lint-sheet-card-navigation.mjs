#!/usr/bin/env node
// A row inside a map sheet opens its subject as a card pushed into the same sheet. A row that
// pushed the detail screen instead would open a second screen with a second sheet stacked over
// the first, and on iOS the new screen lands under the sheet still presented.
//
// The files a sheet card renders are every module the card registry reaches through its imports,
// where an import of a name from a barrel reaches only the module that defines that name, since a
// barrel is not a hop anybody wrote. Type-only imports reach nothing. In those files a push of a
// detail route (`/activity/`, `/route/`, any `/section/` path: a section, its history, its laps)
// through `navigateTo` or `router.push` / `router.navigate` is refused, given as a string, a
// template or an object's `pathname`. `useOpenDetail` is the one door: it pushes a card inside a
// sheet and opens the screen outside one, and its own call is made with a computed path.

import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { treeView } from './lib/indexedSources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? resolve(here, '..') : resolve(process.argv[rootFlag + 1]);
const SRC = join(root, 'src');
const tree = treeView(root, ['src']);
const REGISTRY = 'src/features/routes/screens/DetailCardStack.tsx';
const DETAIL_PATH = /^\/(activity|route|section)\//;
const ROUTER_PUSHES = new Set(['push', 'navigate']);

const rel = (file) => relative(root, file).split('\\').join('/');

// `@/x` is `src/x`; anything else relative is relative to the importing file. A directory
// resolves through its `index`. Returns null for a package.
function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (tree.has(candidate)) return candidate;
  }
  return null;
}

const hasModifier = (node, kind) => node.modifiers?.some((m) => m.kind === kind) ?? false;

const modules = new Map();

// What a module imports, what it defines, and what it passes on from elsewhere.
function moduleOf(file) {
  if (modules.has(file)) return modules.get(file);
  const source = tree.text(file) ?? '';
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const mod = {
    file,
    sf,
    // { spec, names: [name] | null } where null asks for the whole module.
    imports: [],
    defines: new Set(),
    // exported name -> { spec, name }
    reexports: new Map(),
    starSpecs: [],
  };
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const clause = stmt.importClause;
      const spec = stmt.moduleSpecifier.text;
      if (clause?.isTypeOnly) continue;
      if (!clause) {
        mod.imports.push({ spec, names: null });
        continue;
      }
      const names = [];
      if (clause.name) names.push('default');
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        mod.imports.push({ spec, names: null });
      } else if (bindings) {
        for (const el of bindings.elements) {
          if (!el.isTypeOnly) names.push((el.propertyName ?? el.name).text);
        }
      }
      if (names.length > 0) mod.imports.push({ spec, names });
    } else if (ts.isExportDeclaration(stmt)) {
      if (stmt.isTypeOnly) continue;
      const spec = stmt.moduleSpecifier?.text;
      if (!stmt.exportClause) {
        if (spec) mod.starSpecs.push(spec);
      } else if (ts.isNamespaceExport(stmt.exportClause)) {
        if (spec) mod.reexports.set(stmt.exportClause.name.text, { spec, name: null });
      } else {
        for (const el of stmt.exportClause.elements) {
          if (el.isTypeOnly) continue;
          const local = (el.propertyName ?? el.name).text;
          if (spec) mod.reexports.set(el.name.text, { spec, name: local });
          else mod.defines.add(el.name.text);
        }
      }
    } else if (ts.isExportAssignment(stmt)) {
      mod.defines.add('default');
    } else if (hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(stmt, ts.SyntaxKind.DefaultKeyword)) mod.defines.add('default');
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) mod.defines.add(decl.name.text);
        }
      } else if (stmt.name && ts.isIdentifier(stmt.name)) {
        mod.defines.add(stmt.name.text);
      }
    }
  }
  modules.set(file, mod);
  return mod;
}

// The module that defines `name` as `file` exports it, following re-exports and `export *`.
// Null asks for the whole module. Bounded, so a cycle of re-exports cannot spin.
function definingModules(file, name, seen = new Set()) {
  const key = `${file}#${name}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const mod = moduleOf(file);
  if (name === null) return [file];
  if (mod.defines.has(name)) return [file];
  const onward = mod.reexports.get(name);
  if (onward) {
    const target = resolveImport(file, onward.spec);
    return target ? definingModules(target, onward.name, seen) : [];
  }
  for (const spec of mod.starSpecs) {
    const target = resolveImport(file, spec);
    if (!target) continue;
    const found = definingModules(target, name, seen);
    if (found.length > 0) return found;
  }
  return [];
}

const registry = join(root, REGISTRY);
if (!tree.has(registry)) {
  console.error(`lint-sheet-card-navigation: ${REGISTRY} not found`);
  process.exit(1);
}

// Every module the registry reaches. A module reached whole passes on everything it re-exports.
const reached = new Set();
const queue = [registry];
while (queue.length > 0) {
  const file = queue.pop();
  if (reached.has(file)) continue;
  reached.add(file);
  const mod = moduleOf(file);
  const wanted = [...mod.imports];
  for (const { spec, name } of mod.reexports.values()) wanted.push({ spec, names: [name] });
  for (const spec of mod.starSpecs) wanted.push({ spec, names: null });
  for (const { spec, names } of wanted) {
    const target = resolveImport(file, spec);
    if (!target) continue;
    for (const name of names ?? [null]) {
      for (const found of definingModules(target, name)) queue.push(found);
    }
  }
}

// The path a navigation call's first argument names, when it is written out.
function pathOf(arg) {
  if (!arg) return null;
  if (ts.isStringLiteralLike(arg)) return arg.text;
  if (ts.isTemplateExpression(arg)) return arg.head.text;
  if (ts.isObjectLiteralExpression(arg)) {
    for (const prop of arg.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        prop.name.getText() === 'pathname' &&
        ts.isStringLiteralLike(prop.initializer)
      )
        return prop.initializer.text;
    }
  }
  return null;
}

function isNavigationCall(node) {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'navigateTo';
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'router' &&
    ROUTER_PUSHES.has(callee.name.text)
  );
}

const failures = [];
for (const file of [...reached].sort()) {
  const { sf } = moduleOf(file);
  const visit = (node) => {
    if (ts.isCallExpression(node) && isNavigationCall(node)) {
      const path = pathOf(node.arguments[0]);
      if (path !== null && DETAIL_PATH.test(path)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        failures.push(
          `${rel(file)}:${line}: ${node.expression.getText(sf)} to ${path} in a file a map sheet ` +
            'card renders; open it with useOpenDetail, which pushes it as a card in the sheet'
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
