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
//   helper   the call is inside a module-local function that a hook or
//            component calls directly at render. One hop only.
//   memo     the call sits inside useMemo. Runs when the deps change, so it is
//            fine with a stable key and the B164 shape with an unstable one.
//            Reported, not failed: the trigger-counter hooks in useEngine.ts are
//            this shape on purpose and a subscription is what changes the key.
//   init     the call sits in a useState or useReducer lazy initialiser. Runs
//            once per mount, before the first paint. Reported, not failed.
//
// An engine read is a call through getEngine(), getNativeModule(), a binding
// initialised from one of those, or a parameter named engine. Reads inside a
// boundary are not reported.
//
// `direct` and `helper` reads fail the run unless the file is in ALLOWLIST with
// a reason. `memo` and `init` reads are printed under --verbose and never fail.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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
// carries the reason so the next reader does not re-derive it. An entry with an
// open audit item is a debt, not an exemption, and comes out when the item
// closes.
const ALLOWLIST = new Map([
  // Re-reads once when the engine opens after the row mounted, guarded by the
  // ready nonce, so it is one extra read per open and not one per render.
  [
    'src/features/settings/components/StreamHistoryRow.tsx',
    'one re-read per engine open, nonce guarded',
  ],
]);

// Hooks whose callback React runs during render. useMemo runs it whenever the
// deps change. useState and useReducer run a lazy initialiser once per mount,
// which is the cost of an effect without the extra frame. A bare expression
// argument, useRef(engine.x()) or useState(engine.x()), has no function in
// between and is caught as direct.
const LAZY_INIT = new Set(['useState', 'useReducer']);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === '__tests__' || name === '__mocks__') continue;
      out.push(...walk(full));
    } else if (
      /\.tsx?$/.test(name) &&
      !/\.(test|spec)\.tsx?$/.test(name) &&
      !/\.d\.ts$/.test(name)
    ) {
      out.push(full);
    }
  }
  return out;
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
  // Strip one level of nested member access: engine.sections.list() style.
  while (
    ts.isPropertyAccessExpression(root) ||
    ts.isNonNullExpression(root) ||
    ts.isParenthesizedExpression(root)
  ) {
    root = root.expression;
  }
  if (ts.isCallExpression(root) && ts.isIdentifier(root.expression)) {
    if (root.expression.text === 'getEngine' || root.expression.text === 'getNativeModule')
      return member;
    return null;
  }
  if (ts.isIdentifier(root) && bindsEngine(root)) return member;
  return null;
}

// Is this identifier bound to an engine handle? Climb the scopes to the nearest
// declaration of the name. A `const engine = getEngine()` is a handle, and so
// is a parameter called engine. A loop variable or a destructured field is not,
// whatever it is called.
function bindsEngine(id) {
  const name = id.text;
  for (let scope = id.parent; scope; scope = scope.parent) {
    if (isFunctionLike(scope)) {
      for (const param of scope.parameters) {
        if (ts.isIdentifier(param.name) && param.name.text === name) return /engine$/i.test(name);
      }
    }
    if (ts.isForOfStatement(scope) || ts.isForInStatement(scope)) {
      const init = scope.initializer;
      if (ts.isVariableDeclarationList(init)) {
        for (const d of init.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === name) return false;
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
        if (!ts.isIdentifier(d.name) || d.name.text !== name) continue;
        return (
          d.initializer !== undefined &&
          /\b(?:getEngine|getNativeModule)\s*\(/.test(d.initializer.getText())
        );
      }
    }
  }
  return false;
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
  let cur = node.parent;
  while (cur) {
    if (isFunctionLike(cur)) {
      const name = functionName(cur);
      if (name && (isHookName(name) || isComponentName(name))) {
        return { owner: name, kind, fn: cur, deps };
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

function scanFile(file) {
  const src = readFileSync(file, 'utf8');
  if (!/getEngine|getNativeModule|\bengine\b/.test(src)) return [];
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

  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

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
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  for (const c of renderCalls) {
    const reads = helperReads.get(c.callee);
    if (!reads) continue;
    for (const r of reads) {
      findings.push({
        file: rel(file),
        line: c.line,
        owner: c.owner,
        member: r.member,
        kind: c.kind === 'direct' ? 'helper' : c.kind,
        via: `${c.callee}:${r.line}`,
        deps: c.deps,
      });
    }
  }
  return findings;
}

function main() {
  const all = walk(SRC).flatMap(scanFile);
  const failing = all.filter((f) => f.kind === 'direct' || f.kind === 'helper');
  const memo = all.filter((f) => f.kind === 'memo');
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
    console.log('Engine reads inside useMemo (reported, not failed):');
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

  if (VERBOSE && allowed.length > 0) {
    console.log('Allowlisted render-time engine reads:');
    for (const f of allowed) console.log(`${fmt(f)}  (${ALLOWLIST.get(f.file)})`);
    console.log('');
  }

  // An allowlist entry whose file exists but no longer holds a read is stale.
  const stale = [...ALLOWLIST.keys()].filter(
    (k) => existsSync(join(ROOT, k)) && !failing.some((f) => f.file === k)
  );
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
    console.error(
      '     or key it on a subscription trigger inside useMemo. If the read must stay,'
    );
    console.error('     add the file to ALLOWLIST in this script with the audit item and reason.');
    process.exit(1);
  }

  console.log('lint-render-engine-reads: OK');
  console.log(
    `  render-time reads: 0, memo reads: ${memo.length}, initialiser reads: ${init.length}, allowlisted: ${allowed.length} in ${ALLOWLIST.size} file(s)`
  );
}

main();
