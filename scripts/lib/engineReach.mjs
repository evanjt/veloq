// What reaches the engine, said once.
//
// Two guards ask it: the ratchet that counts the files reaching the engine
// directly, and the lint that fails an engine call made while React renders.
// Each kept its own list, so a form one counted the other passed, and a hook
// that reached the engine in a way only one of them knew was invisible to the
// other. Both read this module, so a new door is added in one place.
//
// The doors: the shared engine module under any path spelling (the alias, a
// relative path, `require`, a dynamic `import`), the `useEngineReady` hook,
// the `engine` `veloqrs` exports however it is taken (a named import, a
// `require` destructure, a property read off the module, a namespace import or
// a variable holding the module), and `EngineClient.getInstance()`. The
// class's statics set process-wide switches and hold no instance, so they are
// not a door.

import ts from 'typescript';

/** What `git grep` looks for to find candidates, POSIX extended. */
export const ENGINE_CANDIDATE_ERE = 'native/engine|veloqrs|getInstance|useEngineReady';

/** Calls that return the engine handle. */
export const HANDLE_CALLS = new Set(['getEngine', 'getNativeModule', 'useEngineReady']);

const VELOQRS = 'veloqrs';

/** The shared engine module, by the alias or by any relative path to it. */
export const isEngineModuleSpecifier = (spec) => /(^|\/)native\/engine$/.test(spec);

const unwrap = (node) => {
  let n = node;
  while (
    ts.isParenthesizedExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isSatisfiesExpression(n) ||
    ts.isAwaitExpression(n)
  ) {
    n = n.expression;
  }
  return n;
};

const isStringArg = (call, text) =>
  call.arguments.length >= 1 &&
  ts.isStringLiteralLike(call.arguments[0]) &&
  (text === undefined ? true : call.arguments[0].text === text);

const isRequireCall = (n) =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require';

const isDynamicImport = (n) =>
  ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword;

/** `require('x')` or `import('x')`, with the specifier. */
function loaderSpecifier(node) {
  const n = unwrap(node);
  if ((isRequireCall(n) || isDynamicImport(n)) && isStringArg(n)) return n.arguments[0].text;
  return null;
}

const calleeName = (call) => {
  const c = call.expression;
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c)) return c.name.text;
  return null;
};

/** `EngineClient.getInstance()`, with any `?.` and a module read in front. */
function isInstanceCall(n) {
  if (!ts.isCallExpression(n)) return false;
  const c = n.expression;
  return (
    ts.isPropertyAccessExpression(c) &&
    c.name.text === 'getInstance' &&
    (unwrap(c.expression).getText() === 'EngineClient' ||
      (ts.isPropertyAccessExpression(unwrap(c.expression)) &&
        unwrap(c.expression).name.text === 'EngineClient'))
  );
}

const cache = new WeakMap();

/**
 * The names a file binds to `veloqrs`: `engine` names (the export itself, under
 * any alias, or taken by a `require` destructure) and `module` names (a
 * namespace import, or a variable holding the `require` or dynamic import).
 * Scope is ignored on purpose: a name bound to the module anywhere in the file
 * is read as bound everywhere, which can only over-count a file that shadows it.
 */
export function veloqrsBindings(sourceFile) {
  const hit = cache.get(sourceFile);
  if (hit) return hit;
  const engine = new Set();
  const module = new Set();
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === VELOQRS
    ) {
      const named = node.importClause?.namedBindings;
      if (named && ts.isNamespaceImport(named)) module.add(named.name.text);
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          if ((el.propertyName ?? el.name).text === 'engine') engine.add(el.name.text);
        }
      }
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression) &&
      node.moduleReference.expression.text === VELOQRS
    ) {
      module.add(node.name.text);
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrap(node.initializer);
      if (loaderSpecifier(init) === VELOQRS) {
        if (ts.isIdentifier(node.name)) module.add(node.name.text);
        if (ts.isObjectBindingPattern(node.name)) {
          for (const el of node.name.elements) {
            const key = el.propertyName ?? el.name;
            if (ts.isIdentifier(key) && key.text === 'engine' && ts.isIdentifier(el.name)) {
              engine.add(el.name.text);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const found = { engine, module };
  cache.set(sourceFile, found);
  return found;
}

/** Is this expression the `veloqrs` module itself? */
function isVeloqrsModule(node, bindings) {
  const n = unwrap(node);
  if (ts.isIdentifier(n)) return bindings.module.has(n.text);
  return loaderSpecifier(n) === VELOQRS;
}

/**
 * Is this expression the engine handle, by a form that needs no other
 * binding's initialiser: the `engine` export, a property read of it off the
 * module, or `EngineClient.getInstance()`.
 */
export function isEngineHandleExpression(node) {
  const n = unwrap(node);
  const bindings = veloqrsBindings(n.getSourceFile());
  if (ts.isIdentifier(n)) return bindings.engine.has(n.text);
  if (ts.isPropertyAccessExpression(n)) {
    return n.name.text === 'engine' && isVeloqrsModule(n.expression, bindings);
  }
  if (ts.isElementAccessExpression(n)) {
    return (
      ts.isStringLiteralLike(n.argumentExpression) &&
      n.argumentExpression.text === 'engine' &&
      isVeloqrsModule(n.expression, bindings)
    );
  }
  return isInstanceCall(n);
}

/** Is this identifier the `engine` export, under whatever name it was taken? */
export function isVeloqrsEngineName(id) {
  return veloqrsBindings(id.getSourceFile()).engine.has(id.text);
}

/** Does this call return the engine handle: `getEngine()`, `useEngineReady()` and the like? */
export function isHandleCall(node) {
  const n = unwrap(node);
  if (!ts.isCallExpression(n)) return false;
  return (
    (ts.isIdentifier(n.expression) && HANDLE_CALLS.has(n.expression.text)) || isInstanceCall(n)
  );
}

/**
 * Does this source reach the engine by any door? Parsed and not matched as
 * text, so a long import Prettier broke over lines and a form in a comment or
 * a string both read as what they are.
 */
export function reachesEngine(source, fileName = 'file.tsx') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = veloqrsBindings(sf);
  if (bindings.engine.size > 0) return true;
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (isEngineModuleSpecifier(node.moduleSpecifier.text)) found = true;
      const named = node.importClause?.namedBindings;
      if (
        named &&
        ts.isNamedImports(named) &&
        named.elements.some((el) => (el.propertyName ?? el.name).text === 'useEngineReady')
      ) {
        found = true;
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression) &&
      isEngineModuleSpecifier(node.moduleReference.expression.text)
    ) {
      found = true;
    } else if (ts.isCallExpression(node)) {
      const spec = loaderSpecifier(node);
      if (spec !== null && isEngineModuleSpecifier(spec)) found = true;
      else if (calleeName(node) === 'useEngineReady' && ts.isIdentifier(node.expression)) {
        found = true;
      } else if (isInstanceCall(node)) found = true;
    } else if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      isEngineHandleExpression(node)
    ) {
      found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
