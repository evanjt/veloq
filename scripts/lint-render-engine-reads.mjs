#!/usr/bin/env node
// An engine call made while React is rendering runs on every re-render of that
// screen, holds the engine lock on the JavaScript thread, and is invisible to
// React Query's cache. The power and pace curve hooks read a body at render and
// again inside their queryFn, so a re-render cost two FFI calls for a value the
// cache already held. This encodes the rule that catches the class.
//
// A read is render-time when it runs synchronously inside a hook (use*) or a
// component (PascalCase) with no deferring boundary between the two. Boundaries
// that defer are useEffect, useLayoutEffect, useCallback, a queryFn, an event
// handler, or any callback passed somewhere the scanner cannot see run. Wrappers
// that do NOT defer, because React runs them during render, are useMemo, a
// useState or useReducer initialiser, and an immediately invoked function.
//
// Each read is classified:
//   direct   the call sits in the hook or component body itself, or in an
//            IIFE, or is a bare argument to a hook. Runs on every render.
//   helper   the call is inside a module-level function that a hook or
//            component calls directly at render, in this file or in one it
//            imports the helper from. One hop only, but an import that is a
//            bare re-export is followed through to the module that defines it,
//            because a barrel is not a hop anybody wrote.
//   memo     the call sits inside useMemo. Runs when the deps change, so it is
//            only as fresh as its key. Deps that name the reader
//            `useEngineRead` hands back, a caller's refresh key, or a
//            precomputed value the caller passes instead of the read, pass.
//            Deps that name none of those never re-run after a sync, so the
//            screen shows what was true at mount: those fail.
//
//            A memo whose only re-read key is the counter a
//            `useEngineSubscription` call in the same function returned fails
//            too. That trigger is a key the memo body never reads, so
//            `exhaustive-deps` calls it an unnecessary dependency, the site
//            takes a per-line disable to keep it, and the clean-looking fix,
//            deleting it, silently freezes the read at mount. `useEngineRead`
//            is the same key said in a way the body uses. A key the caller
//            passes in, `refreshKey` or `tick`, is not a trigger this function
//            subscribed to and is left alone.
//   init     the call sits in a useState or useReducer lazy initialiser. Runs
//            once per mount, before the first paint. Reported, not failed.
//
// An engine read is a call through getEngine(), getNativeModule(), a binding
// initialised from one of those or from useEngineReady(), which returns the
// same handle, one of those held in a useMemo, useRef or useState, the `engine`
// veloqrs exports, or a parameter named engine. Reads inside a boundary are not
// reported.
//
// `direct` and `helper` reads fail the run unless the file is in ALLOWLIST with
// a reason, and so does an unkeyed `memo` read unless the file is in
// MEMO_ALLOWLIST. A bare-trigger `memo` read always fails. Keyed `memo` and
// `init` reads are printed under --verbose and never fail.

import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { treeView } from './lib/indexedSources.mjs';
import {
  HANDLE_CALLS,
  isEngineHandleExpression,
  isHandleCall,
  isVeloqrsEngineName,
} from './lib/engineReach.mjs';

// `--root` points the lint at another tree, so the rule itself can be tested.
const rootArg = process.argv.indexOf('--root');
const ROOT =
  rootArg === -1
    ? join(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.argv[rootArg + 1]);
const SRC = join(ROOT, 'src');
const VERBOSE = process.argv.includes('--verbose');
const JSON_OUT = process.argv.includes('--json');

// Files whose render-time read is known, measured, and deliberate. Each entry
// carries the reason so the next reader does not re-derive it. An entry is a
// debt, not an exemption, and comes out when its read moves into a screen read.
const ALLOWLIST = new Map([
  // Re-reads once when the engine opens after the row mounted, guarded by the
  // ready nonce, so it is one extra read per open and not one per render.
  [
    'src/features/settings/components/StreamHistoryRow.tsx',
    'one re-read per engine open, nonce guarded',
  ],
]);

// A memo dep that makes the read re-run when the engine's data changes. A
// refresh counter the caller passes is the key, however it is named; a
// precomputed value is the caller having already read it, so the memo's own
// read is the fallback path and stays as stale as its input. A screen bundle
// hoisted out of its wrapper into a local is the same thing under the other
// name the codebase uses for it, and keys on the array rather than on the
// literal the screen rebuilds each render, so `bundled` counts too.
const REREAD_DEP = /trigger|refresh|refetch|reload|nonce|revision|version|tick/i;
const PRECOMPUTED_DEP = /precomputed|bundled/i;
const KEYED_DEP = new RegExp(`${REREAD_DEP.source}|${PRECOMPUTED_DEP.source}`, 'i');

// The reader `useEngineRead` hands back. Its identity changes when a subscribed
// event fires and at no other time, so a memo depending on it re-runs then and
// the body genuinely reads it: the same key, said in a way `exhaustive-deps`
// can also agree with. Named `readSomething` by convention, which is what this
// matches.
const KEYED_READER = /(^|[^A-Za-z])read[A-Z]/;

const isKeyedDep = (text) => KEYED_DEP.test(text) || KEYED_READER.test(text);

// Does a memo's dep list carry something that re-runs it after a sync?
function memoIsKeyed(deps) {
  if (!deps || deps === '(none)') return false;
  const inner = deps.replace(/^\[|\]$/g, '').trim();
  if (inner === '') return false;
  return isKeyedDep(inner);
}

// The deps that re-read a memo, when every one of them is a bare
// `useEngineSubscription` trigger: the names, or null. A subscription result
// counts under any name, since the call and not the spelling makes it a
// trigger. A precomputed value is not a re-read key: the memo's own read is
// the fallback for when the caller passed none, and the trigger is then the
// only thing that re-runs it.
function bareTriggers(depsNode) {
  if (!depsNode || !ts.isArrayLiteralExpression(depsNode)) return null;
  const triggers = [];
  for (const el of depsNode.elements) {
    const trigger = ts.isIdentifier(el) && initialiserCalls(el, 'useEngineSubscription');
    if (trigger) triggers.push(el.text);
    else if (REREAD_DEP.test(el.getText()) || KEYED_READER.test(el.getText())) return null;
  }
  return triggers.length > 0 ? triggers : null;
}

// Files whose useMemo read is keyed on its inputs alone by design, with the
// reason. Same rule as ALLOWLIST: an entry is a debt.
const MEMO_ALLOWLIST = new Map([
  // Feeds a useState initialiser and is named for it: one read per mount, with
  // its own refresh path for everything after.
  ['src/features/activity/hooks/useActivityBoundsCache.ts', 'initial value, refreshed elsewhere'],
]);

// Hooks whose callback React runs during render. useMemo runs it whenever the
// deps change. useState and useReducer run a lazy initialiser once per mount,
// which is the cost of an effect without the extra frame. A bare expression
// argument, useRef(engine.x()) or useState(engine.x()), has no function in
// between and is caught as direct.
const LAZY_INIT = new Set(['useState', 'useReducer']);

const tree = treeView(ROOT, ['src']);

function walk(dir) {
  return tree.files(dir, (rel) => {
    const parts = rel.split('/');
    const name = parts[parts.length - 1];
    if (parts.slice(0, -1).some((part) => part === '__tests__' || part === '__mocks__'))
      return false;
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !/\.d\.ts$/.test(name);
  });
}

const rel = (p) => relative(ROOT, p);

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

// The name a function is bound to: its own name, or the const it is assigned to,
// or the property it is the value of.
function functionName(fn) {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  const p = fn.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text;
  // export default function () {} or React.memo(function Name() {}) / forwardRef
  if (p && ts.isCallExpression(p)) {
    const gp = p.parent;
    if (gp && ts.isVariableDeclaration(gp) && ts.isIdentifier(gp.name)) return gp.name.text;
  }
  return null;
}

const isHookName = (n) => /^use[A-Z0-9]/.test(n);
const isComponentName = (n) => /^[A-Z]/.test(n);

// Does the callee of this call resolve to an engine handle?
//   getEngine()?.foo(...)   getEngine().foo(...)   engine.foo(...)
//   getNativeModule()?.foo(...)  engine?.foo(...)
function engineReadName(call) {
  let callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return null;
  const member = ts.isPropertyAccessExpression(callee) ? callee.name.text : '[]';
  let root = callee.expression;
  // Strip nested member access: engine.sections.list() style. Each level is
  // also asked whether it is itself the engine, which is how `V.engine.x()`
  // and `require('veloqrs').engine.x()` are met before the walk loses them.
  for (;;) {
    if (isEngineHandleExpression(root)) return member;
    if (
      ts.isPropertyAccessExpression(root) ||
      ts.isNonNullExpression(root) ||
      ts.isParenthesizedExpression(root)
    ) {
      root = root.expression;
    } else {
      break;
    }
  }
  if (ts.isCallExpression(root) && ts.isIdentifier(root.expression)) {
    if (root.expression.text === 'getEngine' || root.expression.text === 'getNativeModule')
      return member;
    return null;
  }
  if (ts.isIdentifier(root) && bindsEngine(root)) return member;
  return null;
}

// The nearest declaration of this identifier's name, climbing the scopes:
// { param } for a function parameter, { loop } for a for-of or for-in
// variable, { decl } for a variable declaration, or null when none is in view.
function nearestBinding(id) {
  const name = id.text;
  for (let scope = id.parent; scope; scope = scope.parent) {
    if (isFunctionLike(scope)) {
      for (const param of scope.parameters) {
        if (ts.isIdentifier(param.name) && param.name.text === name) return { param };
      }
    }
    if (ts.isForOfStatement(scope) || ts.isForInStatement(scope)) {
      const init = scope.initializer;
      if (ts.isVariableDeclarationList(init)) {
        for (const d of init.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === name) return { loop: d };
        }
      }
    }
    const statements =
      ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope)
        ? scope.statements
        : null;
    if (!statements) continue;
    for (const st of statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name) return { decl: d };
        // `const [client] = useState(() => getEngine())`: the state is the
        // first element, and it is what the initialiser returned.
        const first = ts.isArrayBindingPattern(d.name) ? d.name.elements[0] : null;
        const firstName = first && ts.isBindingElement(first) ? first.name : null;
        if (firstName && ts.isIdentifier(firstName) && firstName.text === name) return { decl: d };
      }
    }
  }
  return null;
}

// Is this identifier a variable whose initialiser is itself a call to one of
// these names? Only the initialiser counts: a memo whose body happens to
// mention getEngine binds an array or a map, not the handle.
function initialiserCalls(id, ...callees) {
  const init = nearestBinding(id)?.decl?.initializer;
  if (!init) return false;
  return new RegExp(`^\\(*(?:${callees.join('|')})\\s*\\(`).test(init.getText());
}

// Hooks that hold whatever their argument or callback gives them. A handle kept
// in one is still the handle: a memo with no deps computes it once, which is
// exactly the `getEngine()` it wraps.
const HOLDS_VALUE = new Set(['useMemo', 'useRef', 'useState']);

const unwrap = (node) => {
  let n = node;
  while (
    ts.isParenthesizedExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isSatisfiesExpression(n)
  ) {
    n = n.expression;
  }
  return n;
};

const calleeName = (call) => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
};

// What a callback hands back: its expression body, or every top-level return.
function returnedExpressions(fn) {
  if (!ts.isBlock(fn.body)) return [fn.body];
  return fn.body.statements
    .filter(ts.isReturnStatement)
    .flatMap((r) => (r.expression ? [r.expression] : []));
}

// `useMemo(() => getEngine(), [])`, `useRef(getEngine())` or its `.current`,
// `useState(() => getEngine())`: a handle held in a hook.
function holdsHandle(init) {
  let n = unwrap(init);
  if (ts.isPropertyAccessExpression(n) && n.name.text === 'current') n = unwrap(n.expression);
  if (!ts.isCallExpression(n) || !HOLDS_VALUE.has(calleeName(n))) return false;
  const arg = n.arguments[0];
  if (!arg) return false;
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
    const returned = returnedExpressions(arg);
    return returned.length > 0 && returned.every(isHandleCall);
  }
  return isHandleCall(arg);
}

// Is this identifier bound to an engine handle? A `const engine = getEngine()`
// is a handle, and so is `useEngineReady()`, which returns the same one, the
// same call held in a useMemo, a useRef or a useState, the `engine` `veloqrs`
// exports, and a parameter called engine. A loop variable or a destructured
// field is not, whatever it is called.
function bindsEngine(id) {
  const binding = nearestBinding(id);
  if (binding?.param) return /engine$/i.test(id.text);
  if (!binding) return isVeloqrsEngineName(id);
  if (initialiserCalls(id, ...HANDLE_CALLS)) return true;
  const init = binding.decl?.initializer;
  return init ? holdsHandle(init) || isEngineHandleExpression(init) : false;
}

// Where does a callback passed as an argument run? Returns 'render' when React
// runs it during render, 'boundary' when it is deferred or unknown.
function classifyCallbackArg(fn) {
  const p = fn.parent;
  // IIFE: (() => engine.x())()
  if (
    ts.isParenthesizedExpression(p) &&
    ts.isCallExpression(p.parent) &&
    p.parent.expression === p
  ) {
    return 'iife';
  }
  if (ts.isCallExpression(p) && p.arguments.includes(fn)) {
    const callee = p.expression;
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : null;
    if (name === 'useMemo') return 'memo';
    if (name && LAZY_INIT.has(name) && p.arguments[0] === fn) return 'init';
    return 'boundary';
  }
  return 'boundary';
}

// Climb from a call to the function it executes in at render time. Returns
// { owner, kind } where owner is the enclosing hook/component/helper function
// and kind is 'direct' | 'memo' | null (null = behind a boundary).
function renderContext(node) {
  let kind = 'direct';
  let deps = null;
  let triggers = null;
  let cur = node.parent;
  while (cur) {
    if (isFunctionLike(cur)) {
      const name = functionName(cur);
      if (name && (isHookName(name) || isComponentName(name))) {
        return { owner: name, kind, fn: cur, deps, triggers };
      }
      // Anonymous or helper-named function: what is it passed to?
      const where = classifyCallbackArg(cur);
      if (where === 'boundary') {
        // A named module-level helper is a candidate for the one-hop check.
        if (
          (name && ts.isSourceFile(cur.parent)) ||
          (name && cur.parent && ts.isVariableDeclaration(cur.parent))
        ) {
          return { owner: name, kind: 'helper-body', fn: cur };
        }
        return { owner: name, kind: null, fn: cur };
      }
      if (where === 'memo') {
        kind = 'memo';
        const args = cur.parent.arguments;
        deps = args.length > 1 ? args[1].getText() : '(none)';
        triggers = bareTriggers(args[1]);
      } else if (where === 'init') {
        kind = 'init';
      }
      // 'iife' is transparent: still direct.
    }
    cur = cur.parent;
  }
  return { owner: null, kind: null, fn: null };
}

function isModuleLevelFunction(fn) {
  if (ts.isFunctionDeclaration(fn) && ts.isSourceFile(fn.parent)) return true;
  const p = fn.parent;
  return (
    p &&
    ts.isVariableDeclaration(p) &&
    p.parent &&
    ts.isVariableDeclarationList(p.parent) &&
    p.parent.parent &&
    ts.isVariableStatement(p.parent.parent) &&
    ts.isSourceFile(p.parent.parent.parent)
  );
}

function parseFile(file) {
  const src = tree.text(file);
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const findings = [];
  // Module-level helpers that read the engine in their own body (no boundary).
  const helperReads = new Map(); // name -> [{member,line}]
  // Calls from render context to a local identifier: owner -> [{callee,line}]
  const renderCalls = [];
  // What a name in this file was imported as: name -> module specifier.
  const imports = new Map();
  // A bare re-export, `export { x } from './y'`: name -> module specifier.
  const reexports = new Map();

  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const clause = st.importClause;
      const named = clause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) imports.set(el.name.text, st.moduleSpecifier.text);
      }
    } else if (
      ts.isExportDeclaration(st) &&
      st.moduleSpecifier &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      st.exportClause &&
      ts.isNamedExports(st.exportClause)
    ) {
      for (const el of st.exportClause.elements) {
        reexports.set(el.name.text, st.moduleSpecifier.text);
      }
    }
  }

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const member = engineReadName(node);
      if (member) {
        const ctx = renderContext(node);
        if (ctx.kind === 'direct' || ctx.kind === 'memo' || ctx.kind === 'init') {
          findings.push({
            file: rel(file),
            line: line(node),
            owner: ctx.owner,
            member,
            kind: ctx.kind,
            deps: ctx.deps,
            triggers: ctx.triggers,
          });
        } else if (ctx.kind === 'helper-body' && ctx.fn && isModuleLevelFunction(ctx.fn)) {
          if (!helperReads.has(ctx.owner)) helperReads.set(ctx.owner, []);
          helperReads.get(ctx.owner).push({ member, line: line(node) });
        }
      } else if (ts.isIdentifier(node.expression)) {
        const ctx = renderContext(node);
        if (ctx.kind === 'direct' || ctx.kind === 'memo' || ctx.kind === 'init') {
          renderCalls.push({
            callee: node.expression.text,
            owner: ctx.owner,
            line: line(node),
            kind: ctx.kind,
            deps: ctx.deps,
            triggers: ctx.triggers,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  return { file, findings, helperReads, renderCalls, imports, reexports };
}

// `@/x` is `src/x`; anything else relative is relative to the importing file.
// A directory resolves through its `index`. Returns null for a package.
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

// The reads of `name` as the module that defines it sees them, following bare
// re-exports so a barrel does not hide the definition. Bounded, so a cycle of
// re-exports cannot spin.
function helperReadsOf(modules, file, name, seen = new Set()) {
  const mod = modules.get(file);
  if (!mod || seen.has(file)) return null;
  seen.add(file);
  const own = mod.helperReads.get(name);
  if (own) return { reads: own, file };
  const onward = mod.reexports.get(name);
  if (!onward) return null;
  const next = resolveImport(file, onward);
  return next ? helperReadsOf(modules, next, name, seen) : null;
}

// Join every render-time call to a plain identifier with the helper it names,
// in this file or in the one it was imported from.
function joinHelpers(modules) {
  const out = [];
  for (const mod of modules.values()) {
    for (const c of mod.renderCalls) {
      const local = mod.helperReads.get(c.callee);
      let found = local ? { reads: local, file: mod.file } : null;
      if (!found) {
        const spec = mod.imports.get(c.callee);
        const target = spec ? resolveImport(mod.file, spec) : null;
        if (target) found = helperReadsOf(modules, target, c.callee);
      }
      if (!found) continue;
      for (const r of found.reads) {
        out.push({
          file: rel(mod.file),
          line: c.line,
          owner: c.owner,
          member: r.member,
          kind: c.kind === 'direct' ? 'helper' : c.kind,
          via: `${c.callee}:${r.line}`,
          deps: c.deps,
          triggers: c.triggers,
        });
      }
    }
  }
  return out;
}

function main() {
  const modules = new Map();
  for (const file of walk(SRC)) modules.set(file, parseFile(file));
  const all = [...modules.values()].flatMap((m) => m.findings).concat(joinHelpers(modules));
  const failing = all.filter((f) => f.kind === 'direct' || f.kind === 'helper');
  const bareTrigger = all.filter((f) => f.kind === 'memo' && f.triggers);
  const memo = all.filter((f) => f.kind === 'memo' && !f.triggers && memoIsKeyed(f.deps));
  const unkeyedMemo = all.filter((f) => f.kind === 'memo' && !f.triggers && !memoIsKeyed(f.deps));
  const init = all.filter((f) => f.kind === 'init');

  if (JSON_OUT) {
    console.log(JSON.stringify(all, null, 2));
    return;
  }

  const fmt = (f) =>
    `  ${f.file}:${f.line}  ${f.owner ?? '?'}  engine.${f.member}` +
    (f.via ? `  via ${f.via}` : '') +
    (f.deps ? `  deps ${f.deps.replace(/\s+/g, ' ')}` : '');

  if (VERBOSE && memo.length > 0) {
    console.log('Engine reads inside a keyed useMemo (reported, not failed):');
    for (const f of memo) console.log(fmt(f));
    console.log('');
  }
  if (VERBOSE && init.length > 0) {
    console.log('Engine reads in a useState initialiser, once per mount (reported, not failed):');
    for (const f of init) console.log(fmt(f));
    console.log('');
  }

  const allowed = failing.filter((f) => ALLOWLIST.has(f.file));
  const violations = failing.filter((f) => !ALLOWLIST.has(f.file));
  const allowedMemo = unkeyedMemo.filter((f) => MEMO_ALLOWLIST.has(f.file));
  const memoViolations = unkeyedMemo.filter((f) => !MEMO_ALLOWLIST.has(f.file));

  if (VERBOSE && allowed.length > 0) {
    console.log('Allowlisted render-time engine reads:');
    for (const f of allowed) console.log(`${fmt(f)}  (${ALLOWLIST.get(f.file)})`);
    console.log('');
  }

  if (VERBOSE && allowedMemo.length > 0) {
    console.log('Allowlisted unkeyed useMemo engine reads:');
    for (const f of allowedMemo) console.log(`${fmt(f)}  (${MEMO_ALLOWLIST.get(f.file)})`);
    console.log('');
  }

  // An allowlist entry whose file exists but no longer holds a read is stale.
  const stale = [
    ...[...ALLOWLIST.keys()].filter(
      (k) => tree.has(join(ROOT, k)) && !failing.some((f) => f.file === k)
    ),
    ...[...MEMO_ALLOWLIST.keys()].filter(
      (k) => tree.has(join(ROOT, k)) && !unkeyedMemo.some((f) => f.file === k)
    ),
  ];
  if (stale.length > 0) {
    console.error('Stale ALLOWLIST entries (no render-time read in the file any more):');
    for (const k of stale) console.error(`  ${k}`);
    console.error('');
    process.exit(1);
  }

  if (violations.length > 0) {
    console.error('Engine reads during render (run on every re-render, bypass the query cache):');
    for (const f of violations) console.error(fmt(f));
    console.error('');
    console.error('Fix: move the read into a useQuery queryFn, a useEffect, or an event handler,');
    console.error('     or read it in a useMemo keyed on a reader from useEngineRead. If the read');
    console.error('     must stay, add the file to ALLOWLIST in this script with the reason.');
    process.exit(1);
  }

  if (bareTrigger.length > 0) {
    console.error(
      'Engine reads inside a useMemo keyed only on a bare useEngineSubscription trigger:'
    );
    for (const f of bareTrigger) console.error(`${fmt(f)}  trigger ${f.triggers.join(', ')}`);
    console.error('');
    console.error('Fix: take a reader from useEngineRead for the same events, read through it');
    console.error('     in the memo, and put the reader in the deps in place of the trigger.');
    console.error('     The body then uses its key, so no exhaustive-deps disable is needed.');
    process.exit(1);
  }

  if (memoViolations.length > 0) {
    console.error('Engine reads inside a useMemo that nothing re-runs (stale after a sync):');
    for (const f of memoViolations) console.error(fmt(f));
    console.error('');
    console.error('Fix: take a reader from useEngineRead for the event that announces');
    console.error('     this data and put it in the deps, or take the value precomputed from a');
    console.error('     caller that already read it. If the read must stay unkeyed, add the file');
    console.error('     to MEMO_ALLOWLIST in this script with the reason.');
    process.exit(1);
  }

  console.log('lint-render-engine-reads: OK');
  console.log(
    `  render-time reads: 0, memo reads: ${memo.length}, unkeyed memo reads: ${allowedMemo.length}, initialiser reads: ${init.length}, allowlisted: ${allowed.length} in ${ALLOWLIST.size} file(s)`
  );
}

main();
