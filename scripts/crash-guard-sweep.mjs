#!/usr/bin/env node
// Static sweep for the latent-crash patterns this codebase's audit checked by hand.
// Exits non-zero on (a)(b)(c); the Rust (d) check is advisory only.
//
//   (a) Math.max(...x)/Math.min(...x) without a nearby length guard or `||` seed.
//       Math.max([]) is -Infinity and Math.min([]) is +Infinity, which leak into
//       chart domains and date math as silent NaN/Infinity.
//   (b) A React hook called after an early `return` at a component's top-level depth
//       (the SeasonComparison Rules-of-Hooks class: hook count changes when data loads).
//   (c) JSON.parse not inside try/catch and not via the safeJsonParse helper.
//   (d) Rust .unwrap()/.expect( inside a #[uniffi::export] body (advisory warnings).
//
// Usage:
//   node scripts/crash-guard-sweep.mjs                 # full src/** tree (CI)
//   node scripts/crash-guard-sweep.mjs file1 file2     # only these files (pre-commit)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const RUST_DIR = path.join(ROOT, 'modules/veloqrs/rust/veloqrs/src');

const HOOK_NAMES = ['useMemo', 'useState', 'useEffect', 'useCallback', 'useRef'];
// How many preceding source lines to scan for a guard before a Math.max(...x) site.
const GUARD_WINDOW = 12;

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'generated') continue;
      walk(full, exts, out);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

// Replace string/template/regex literals and comments with spaces so structural
// scanning (braces, keywords) never trips over text inside them. Length and line
// breaks are preserved so reported line numbers stay accurate.
function stripNoise(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  const blank = (start, end) => {
    for (let k = start; k < end && k < n; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      let j = i + 2;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
    } else if (c === '/' && next === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, n));
      i = j + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === quote) break;
        // Template literals can contain ${...} with real code, but for our
        // structural scan treating them as opaque is safe and conservative.
        j++;
      }
      blank(i, Math.min(j + 1, n));
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === '\n') line++;
  }
  return line;
}

// Per-line brace depth, computed on noise-stripped source.
function braceDepths(clean) {
  const lines = clean.split('\n');
  const depthAtLineStart = [];
  let depth = 0;
  for (const line of lines) {
    depthAtLineStart.push(depth);
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
  }
  return depthAtLineStart;
}

// (a) Math.max(...x) / Math.min(...x) lacking a guard.
// A site is considered guarded when, within GUARD_WINDOW preceding lines (or on
// the same line), there is a `.length` check, an early `if (...) return`, or a
// `|| seed` / `?? seed` fallback. We only flag the bare spread form `Math.max(...`.
function checkMathSpread(file, rawLines, cleanLines, findings) {
  const spread = /Math\.(?:max|min)\(\s*\.\.\./;
  for (let idx = 0; idx < cleanLines.length; idx++) {
    const clean = cleanLines[idx];
    if (!spread.test(clean)) continue;

    const start = Math.max(0, idx - GUARD_WINDOW);
    const windowText = cleanLines.slice(start, idx + 1).join('\n');

    const hasLengthGuard = /\.length\b/.test(windowText);
    const hasSeed = /(?:\|\||\?\?)\s*[-\d]/.test(clean) || /,\s*[-\d]/.test(clean);
    const hasEarlyReturn = /\breturn\b/.test(windowText) && hasLengthGuard;

    if (hasLengthGuard || hasSeed || hasEarlyReturn) continue;

    findings.push({
      kind: 'a',
      file,
      line: idx + 1,
      text: rawLines[idx].trim(),
      msg: 'Math.max/min spread without a length guard or seed (-Infinity/Infinity on empty array)',
    });
  }
}

// (b) Hook called after an early return at a component's top-level body depth.
// Components are PascalCase functions/arrows. We find each component's opening
// brace and its body depth, then walk lines: once a `return` appears at body
// depth, any later hook call at body depth is a Rules-of-Hooks hazard.
function checkHooksAfterReturn(file, rawLines, clean, findings) {
  const depths = braceDepths(clean);
  const cleanLines = clean.split('\n');

  // Component declarations: `function Foo(`, `export function Foo(`,
  // `const Foo = (...) =>`, `const Foo = memo(`, `const Foo = forwardRef(`.
  const compDecl =
    /(?:export\s+(?:default\s+)?)?(?:function\s+([A-Z]\w*)\s*[(<]|const\s+([A-Z]\w*)\s*=\s*(?:React\.)?(?:memo|forwardRef)?\s*\(?\s*(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>))/;

  for (let i = 0; i < cleanLines.length; i++) {
    const m = compDecl.exec(cleanLines[i]);
    if (!m) continue;

    // Find the body open brace from this declaration onward.
    let openLine = -1;
    let openCol = -1;
    for (let j = i; j < cleanLines.length && j < i + 6; j++) {
      const from = j === i ? m.index : 0;
      const braceIdx = cleanLines[j].indexOf('{', from);
      if (braceIdx !== -1) {
        openLine = j;
        openCol = braceIdx;
        break;
      }
    }
    if (openLine === -1) continue;

    // Interior of the body sits at this depth; the closing brace line is one below.
    const bodyDepth = depths[openLine] + countBefore(cleanLines[openLine], openCol, '{', '}') + 1;

    let seenReturn = false;
    for (let j = openLine + 1; j < cleanLines.length; j++) {
      const lineStartDepth = depths[j];
      // Component body ended once a line starts below the body's interior depth.
      if (lineStartDepth < bodyDepth) break;

      const line = cleanLines[j];
      const atBodyDepth = lineStartDepth === bodyDepth;

      // Flag hooks only when a return was seen on a *prior* body line, so a
      // legitimate `return useMemo(...)` on the same line is not a false hit.
      if (seenReturn && atBodyDepth) {
        for (const hook of HOOK_NAMES) {
          const re = new RegExp('\\b' + hook + '\\s*\\(');
          if (re.test(line)) {
            findings.push({
              kind: 'b',
              file,
              line: j + 1,
              text: rawLines[j].trim(),
              msg: `${hook} called after an early return in component (Rules-of-Hooks hazard)`,
            });
            break;
          }
        }
      }
      if (atBodyDepth && /\breturn\b/.test(line)) {
        seenReturn = true;
      }
    }
  }
}

function countBefore(line, col, openCh, closeCh) {
  let net = 0;
  for (let k = 0; k < col; k++) {
    if (line[k] === openCh) net++;
    else if (line[k] === closeCh) net--;
  }
  return net;
}

// (c) JSON.parse not inside try/catch and not via safeJsonParse.
// JSON.parse(JSON.stringify(...)) is a deep-clone idiom that cannot throw on the
// stringified input, so it is exempt. Try coverage is tracked by depth: a site is
// safe if it sits inside the brace range opened by a `try {`.
function checkJsonParse(file, rawLines, clean, findings) {
  const cleanLines = clean.split('\n');

  // Build per-line "inside a try block" flag via a depth stack of try openings.
  const insideTry = new Array(cleanLines.length).fill(false);
  let depth = 0;
  const tryDepths = [];
  for (let i = 0; i < cleanLines.length; i++) {
    const line = cleanLines[i];
    // A try on this line opens at the current depth (its `{` increments depth).
    const tryHere = /\btry\b\s*\{/.test(line) || /\btry\b\s*$/.test(line);
    insideTry[i] = tryDepths.length > 0;
    if (tryHere) tryDepths.push(depth);
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (tryDepths.length && depth === tryDepths[tryDepths.length - 1]) {
          tryDepths.pop();
        }
      }
    }
    // Re-evaluate after processing the line so a try opened here covers the body.
    if (tryHere) insideTry[i] = true;
  }

  for (let i = 0; i < cleanLines.length; i++) {
    const line = cleanLines[i];
    let from = 0;
    let col;
    while ((col = line.indexOf('JSON.parse', from)) !== -1) {
      from = col + 10;
      const rest = line.slice(col);
      // Deep-clone idiom JSON.parse(JSON.stringify(...)) cannot throw on the input.
      if (/^JSON\.parse\(\s*JSON\.stringify/.test(rest)) continue;
      if (insideTry[i]) continue;
      // Already guarded via the safeJsonParse helper definition itself.
      if (/safeJsonParse/.test(line)) continue;
      findings.push({
        kind: 'c',
        file,
        line: i + 1,
        text: rawLines[i].trim(),
        msg: 'JSON.parse outside try/catch (use safeJsonParse or wrap in try/catch)',
      });
    }
  }
}

// (d) Rust .unwrap()/.expect( inside a #[uniffi::export] body. Advisory only.
function checkRustUnwrap(file, rawLines, clean, findings) {
  const cleanLines = clean.split('\n');
  const depths = braceDepths(clean);

  let i = 0;
  while (i < cleanLines.length) {
    if (!/#\[uniffi::export\]/.test(cleanLines[i])) {
      i++;
      continue;
    }
    // Find the block this attribute applies to (impl ... { or fn ... {).
    let openLine = -1;
    for (let j = i + 1; j < cleanLines.length && j < i + 8; j++) {
      if (cleanLines[j].includes('{')) {
        openLine = j;
        break;
      }
    }
    if (openLine === -1) {
      i++;
      continue;
    }
    const blockDepth = depths[openLine];
    // Scan until the block closes back to blockDepth.
    let j = openLine + 1;
    for (; j < cleanLines.length; j++) {
      if (depths[j] <= blockDepth && j > openLine) break;
      if (/\.unwrap\(\)|\.expect\(/.test(cleanLines[j])) {
        findings.push({
          kind: 'd',
          file,
          line: j + 1,
          text: rawLines[j].trim(),
          msg: 'unwrap/expect reachable from #[uniffi::export] (panic crosses the FFI boundary)',
        });
      }
    }
    i = j;
  }
}

function scanTsFile(file, findings) {
  const raw = fs.readFileSync(file, 'utf8');
  const clean = stripNoise(raw);
  const rawLines = raw.split('\n');
  const cleanLines = clean.split('\n');
  const rel = path.relative(ROOT, file);

  checkMathSpread(rel, rawLines, cleanLines, findings);
  checkHooksAfterReturn(rel, rawLines, clean, findings);
  checkJsonParse(rel, rawLines, clean, findings);
}

function scanRustFile(file, findings) {
  const raw = fs.readFileSync(file, 'utf8');
  const clean = stripNoise(raw);
  const rawLines = raw.split('\n');
  const rel = path.relative(ROOT, file);
  checkRustUnwrap(rel, rawLines, clean, findings);
}

function resolveTargets(args) {
  const ts = [];
  const rust = [];
  if (args.length === 0) {
    for (const f of walk(SRC_DIR, ['.ts', '.tsx'])) {
      if (f.includes(`${path.sep}__tests__${path.sep}`) || f.endsWith('.test.ts') || f.endsWith('.test.tsx')) {
        continue;
      }
      ts.push(f);
    }
    for (const f of walk(RUST_DIR, ['.rs'])) rust.push(f);
    return { ts, rust };
  }
  // Explicit file list (pre-commit changed files). Filter to relevant trees.
  for (const a of args) {
    const abs = path.resolve(ROOT, a);
    if (!fs.existsSync(abs)) continue;
    const within = (dir) => abs.startsWith(dir + path.sep);
    if ((abs.endsWith('.ts') || abs.endsWith('.tsx')) && within(SRC_DIR)) {
      if (abs.includes(`${path.sep}__tests__${path.sep}`) || abs.endsWith('.test.ts') || abs.endsWith('.test.tsx')) {
        continue;
      }
      ts.push(abs);
    } else if (abs.endsWith('.rs') && within(RUST_DIR)) {
      rust.push(abs);
    }
  }
  return { ts, rust };
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const { ts, rust } = resolveTargets(args);

  const findings = [];
  for (const f of ts) scanTsFile(f, findings);
  for (const f of rust) scanRustFile(f, findings);

  const blocking = findings.filter((f) => f.kind !== 'd');
  const advisory = findings.filter((f) => f.kind === 'd');

  const labels = {
    a: 'Math.max/min spread',
    b: 'hook after early return',
    c: 'unguarded JSON.parse',
    d: 'Rust unwrap/expect in FFI export',
  };

  for (const f of blocking) {
    console.error(`error [${f.kind}] ${f.file}:${f.line}  ${labels[f.kind]}\n    ${f.msg}\n    ${f.text}`);
  }
  for (const f of advisory) {
    console.warn(`warning [${f.kind}] ${f.file}:${f.line}  ${labels[f.kind]}\n    ${f.msg}\n    ${f.text}`);
  }

  const counts = { a: 0, b: 0, c: 0, d: 0 };
  for (const f of findings) counts[f.kind]++;

  console.log('\ncrash-guard-sweep summary');
  console.log(`  scanned: ${ts.length} TS/TSX, ${rust.length} Rust`);
  console.log(`  (a) Math.max/min spread:            ${counts.a}`);
  console.log(`  (b) hook after early return:        ${counts.b}`);
  console.log(`  (c) unguarded JSON.parse:           ${counts.c}`);
  console.log(`  (d) Rust unwrap/expect in export:   ${counts.d} (advisory)`);

  if (blocking.length > 0) {
    console.log(`\n${blocking.length} blocking issue(s). Fix or guard before commit.`);
    process.exit(1);
  }
  console.log('\nno blocking crash-guard issues.');
}

main();
