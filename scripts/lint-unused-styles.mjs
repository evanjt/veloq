#!/usr/bin/env node
// Refuse StyleSheet entries that no source expression reads.

import { posix } from 'node:path';

import ts from 'typescript';

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const flag = process.argv.indexOf('--root');
const root = flag < 0 ? process.cwd() : process.argv[flag + 1];
const sources = indexedSources(root, ['src']);
refuseEmptyListing(sources, 'unused styles');

const files = new Map();
for (const [path, bytes] of sources) {
  if (!/\.tsx?$/.test(path) || /(^|\/)(__tests__|__mocks__)\//.test(path)) continue;
  files.set(
    path,
    ts.createSourceFile(
      path,
      bytes.toString('utf8'),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )
  );
}

const sheets = new Map();
const exportsByFile = new Map();
const importsByFile = new Map();
const readers = new Map();
const literalName = (node) =>
  node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node))
    ? node.text
    : null;
const sheetId = (path, name) => `${path}\0${name}`;

function modulePath(from, spec) {
  let base;
  if (spec.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(from), spec));
  else if (spec.startsWith('@/')) base = `src/${spec.slice(2)}`;
  else return null;
  return (
    [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((candidate) =>
      files.has(candidate)
    ) ?? null
  );
}

for (const [path, sf] of files) {
  const localExports = new Map();
  const localImports = new Map();
  exportsByFile.set(path, localExports);
  importsByFile.set(path, localImports);
  for (const statement of sf.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const init = decl.initializer;
        if (
          ts.isCallExpression(init) &&
          ts.isPropertyAccessExpression(init.expression) &&
          ts.isIdentifier(init.expression.expression) &&
          init.expression.expression.text === 'StyleSheet' &&
          init.expression.name.text === 'create' &&
          init.arguments[0] &&
          ts.isObjectLiteralExpression(init.arguments[0])
        ) {
          const keys = new Map();
          for (const property of init.arguments[0].properties) {
            const name = literalName(property.name);
            if (name !== null)
              keys.set(name, sf.getLineAndCharacterOfPosition(property.getStart(sf)).line + 1);
          }
          sheets.set(sheetId(path, decl.name.text), keys);
        }
        if (statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          localExports.set(decl.name.text, { path, name: decl.name.text });
        }
      }
    } else if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const target = modulePath(path, statement.moduleSpecifier.text);
      if (!target) continue;
      const named = statement.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          localImports.set(element.name.text, {
            path: target,
            name: element.propertyName?.text ?? element.name.text,
          });
        }
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      const target =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? modulePath(path, statement.moduleSpecifier.text)
          : path;
      if (!target) continue;
      for (const element of statement.exportClause.elements) {
        localExports.set(element.name.text, {
          path: target,
          name: element.propertyName?.text ?? element.name.text,
        });
      }
    }
  }
}

function resolve(path, name, seen = new Set()) {
  const id = sheetId(path, name);
  if (seen.has(id)) return null;
  seen.add(id);
  if (sheets.has(id)) return id;
  const imported = importsByFile.get(path)?.get(name);
  if (imported) return resolveExport(imported.path, imported.name, seen);
  const exported = exportsByFile.get(path)?.get(name);
  if (exported) return resolve(exported.path, exported.name, seen);
  return null;
}

function resolveExport(path, name, seen) {
  const exported = exportsByFile.get(path)?.get(name);
  if (!exported) return null;
  return resolve(exported.path, exported.name, seen);
}

for (const [path, sf] of files) {
  function visit(node) {
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      ts.isIdentifier(node.expression)
    ) {
      const id = resolve(path, node.expression.text);
      if (id) {
        const key = ts.isPropertyAccessExpression(node)
          ? node.name.text
          : node.argumentExpression &&
              (ts.isStringLiteralLike(node.argumentExpression) ||
                ts.isNumericLiteral(node.argumentExpression))
            ? node.argumentExpression.text
            : null;
        if (!readers.has(id)) readers.set(id, new Set());
        readers.get(id).add(key ?? '*');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

const unused = [];
for (const [id, keys] of sheets) {
  const [path, sheet] = id.split('\0');
  const read = readers.get(id) ?? new Set();
  if (read.has('*')) continue;
  for (const [key, line] of keys) {
    if (!read.has(key)) unused.push(`${path}:${line} ${sheet}.${key}`);
  }
}
if (unused.length) {
  console.error(`Unused StyleSheet keys:\n${unused.join('\n')}`);
  process.exitCode = 1;
}
