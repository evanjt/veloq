import { resolve, relative, dirname, extname, join, sep } from 'node:path';
import ts from 'typescript';

import { trackedText, treeView } from './lib/indexedSources.mjs';

const rootArg = process.argv.indexOf('--root');
const root = resolve(rootArg < 0 ? '.' : process.argv[rootArg + 1]);
const packageJson = JSON.parse(trackedText(root, 'package.json'));
const entryPath = resolve(root, packageJson.main);
const tree = treeView(root, ['src', packageJson.main]);

function parse(path) {
  const source = tree.text(path);
  if (source === undefined)
    throw new Error(`Background task entry cannot read ${relative(root, path)}`);
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
}

function definesTask(path) {
  let found = false;
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { expression, name } = node.expression;
      if (
        ts.isIdentifier(expression) &&
        expression.text === 'TaskManager' &&
        name.text === 'defineTask'
      ) {
        found = true;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parse(path));
  return found;
}

// Inline requires evaluate a module on first use, so an import that binds a name
// is deferred until the name is read, which a headless launch never does. Only a
// bare import, which binds nothing, stays in place at launch.
function entryImports() {
  const imported = new Set();
  for (const statement of parse(entryPath).statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    if (statement.importClause) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith('.')) continue;
    const importedPath = resolve(dirname(entryPath), specifier);
    imported.add(extname(importedPath) ? importedPath : `${importedPath}.ts`);
  }
  return imported;
}

const taskFiles = tree
  .files(join(root, 'src'))
  .filter((path) => /\.[jt]sx?$/.test(path) && !path.endsWith('.d.ts'))
  .filter((path) => !relative(root, path).split(sep).includes('__tests__'))
  .filter(definesTask);
const imported = entryImports();
const missing = taskFiles.filter((path) => !imported.has(path));
if (missing.length) {
  throw new Error(
    `Background task modules not imported for their side effect (a bare import) in ${relative(root, entryPath)}: ${missing.map((path) => relative(root, path)).join(', ')}`
  );
}
