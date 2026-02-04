#!/usr/bin/env npx tsx
/**
 * FFI Boundary Audit Script
 *
 * Compares Rust #[uniffi::export] functions with TypeScript imports
 * to detect unused exports or missing wrappers.
 *
 * Also checks for missing @see annotations on wrapper functions.
 *
 * Usage:
 *   npx tsx modules/veloqrs/scripts/audit-ffi.ts           # Human-readable output
 *   npx tsx modules/veloqrs/scripts/audit-ffi.ts --vscode  # VSCode Problems format
 *
 * The --vscode flag outputs in a format that VSCode's problem matcher can parse,
 * allowing issues to appear in the Problems panel.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const VELOQRS_ROOT = path.resolve(__dirname, '..');
const RUST_SRC = path.join(VELOQRS_ROOT, 'rust/veloqrs/src');
const TS_WRAPPER = path.join(VELOQRS_ROOT, 'src/index.ts');

// Check for VSCode output mode
const VSCODE_MODE = process.argv.includes('--vscode');

interface FfiExport {
  name: string;
  file: string;
  line: number;
  absolutePath: string;
}

interface WrapperFunction {
  name: string;
  line: number;
  ffiCalls: string[];
  hasSeeAnnotation: boolean;
  seeTargets: string[];
}

// Convert snake_case to camelCase (UniFFI convention)
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// Find all #[uniffi::export] functions in Rust code
function findRustExports(): FfiExport[] {
  const exports: FfiExport[] = [];

  try {
    const result = execSync(
      `grep -rn "#\\[uniffi::export\\]" "${RUST_SRC}" -A 2`,
      { encoding: 'utf-8' }
    );

    const lines = result.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('#[uniffi::export]')) {
        // Parse file:line format
        const match = line.match(/^(.+?):(\d+):/);
        if (match) {
          const absolutePath = match[1];
          const file = match[1].replace(RUST_SRC + '/', '');
          const lineNum = parseInt(match[2], 10);

          // Look for function name in next few lines
          for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const fnMatch = lines[j].match(/pub fn (\w+)/);
            if (fnMatch) {
              exports.push({
                name: fnMatch[1],
                file,
                line: lineNum + (j - i),
                absolutePath: absolutePath.replace(`:${lineNum}`, ''),
              });
              break;
            }
          }
        }
      }
    }
  } catch (e) {
    if (!VSCODE_MODE) {
      console.error('Error finding Rust exports:', e);
    }
  }

  return exports;
}

// Find FFI function usage in TypeScript
function findTsUsages(): Set<string> {
  const usages = new Set<string>();

  try {
    const content = fs.readFileSync(TS_WRAPPER, 'utf-8');

    // Find imports from generated/veloqrs
    const importMatch = content.match(/import \{[\s\S]*?\} from '\.\/generated\/veloqrs'/);
    if (importMatch) {
      const imports = importMatch[0];
      // Extract function names (camelCase)
      const funcMatches = imports.matchAll(/(\w+)(?:\s+as\s+\w+)?[,}]/g);
      for (const match of funcMatches) {
        usages.add(match[1]);
      }
    }

    // Find dynamic requires
    const requireMatches = content.matchAll(/generated\.(\w+)/g);
    for (const match of requireMatches) {
      usages.add(match[1]);
    }
  } catch (e) {
    if (!VSCODE_MODE) {
      console.error('Error reading TypeScript wrapper:', e);
    }
  }

  return usages;
}

// Build a map of FFI function names (camelCase) to their Rust locations
function buildFfiLocationMap(exports: FfiExport[]): Map<string, FfiExport> {
  const map = new Map<string, FfiExport>();
  for (const exp of exports) {
    const camelName = snakeToCamel(exp.name);
    map.set(camelName, exp);
  }
  return map;
}

// Find wrapper functions that call FFI functions and check for @see annotations
function findWrapperFunctions(ffiLocationMap: Map<string, FfiExport>): WrapperFunction[] {
  const wrappers: WrapperFunction[] = [];

  try {
    const content = fs.readFileSync(TS_WRAPPER, 'utf-8');
    const lines = content.split('\n');

    // Known FFI function names (camelCase)
    const ffiFunctions = new Set(ffiLocationMap.keys());

    // Track JSDoc block state
    let inJsDoc = false;
    let jsDocStartLine = 0;
    let jsDocContent = '';
    let seeTargets: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Track JSDoc blocks
      if (line.includes('/**')) {
        inJsDoc = true;
        jsDocStartLine = lineNum;
        jsDocContent = line;
        seeTargets = [];
      } else if (inJsDoc) {
        jsDocContent += '\n' + line;
        // Look for @see annotations
        const seeMatch = line.match(/@see\s+(.+)/);
        if (seeMatch) {
          seeTargets.push(seeMatch[1].trim());
        }
        if (line.includes('*/')) {
          inJsDoc = false;
        }
      }

      // Look for function/method definitions
      const funcMatch = line.match(
        /^\s*(?:async\s+)?(?:function\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{?$/
      ) || line.match(
        /^\s*(?:async\s+)?(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^{]+)?\s*=>/
      );

      // Also match class method definitions
      const methodMatch = line.match(
        /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{$/
      );

      const match = funcMatch || methodMatch;

      if (match) {
        const funcName = match[1];

        // Skip keywords, constructor, private methods, utility functions
        const keywords = ['if', 'for', 'while', 'switch', 'catch', 'with', 'constructor'];
        if (keywords.includes(funcName) || funcName.startsWith('_')) {
          continue;
        }

        // Scan function body for FFI calls (next 50 lines or until closing brace)
        const ffiCalls: string[] = [];
        let braceCount = 0;
        let foundOpenBrace = false;

        for (let j = i; j < Math.min(i + 100, lines.length); j++) {
          const bodyLine = lines[j];

          // Track braces to find function end
          for (const char of bodyLine) {
            if (char === '{') {
              braceCount++;
              foundOpenBrace = true;
            } else if (char === '}') {
              braceCount--;
            }
          }

          // Look for FFI function calls
          for (const ffiFunc of ffiFunctions) {
            if (bodyLine.includes(ffiFunc + '(')) {
              if (!ffiCalls.includes(ffiFunc)) {
                ffiCalls.push(ffiFunc);
              }
            }
          }

          // Stop at function end
          if (foundOpenBrace && braceCount === 0) {
            break;
          }
        }

        // Only track functions that call FFI functions
        if (ffiCalls.length > 0) {
          wrappers.push({
            name: funcName,
            line: lineNum,
            ffiCalls,
            hasSeeAnnotation: seeTargets.length > 0,
            seeTargets,
          });
        }

        // Reset JSDoc tracking after function definition
        seeTargets = [];
      }
    }
  } catch (e) {
    if (!VSCODE_MODE) {
      console.error('Error finding wrapper functions:', e);
    }
  }

  return wrappers;
}

// Output for VSCode Problems panel
// Format: file:line:column: severity: message
function outputVSCode(
  unused: FfiExport[],
  used: FfiExport[],
  total: number,
  missingSeeAnnotations: { wrapper: WrapperFunction; ffiExport: FfiExport }[]
) {
  for (const exp of unused) {
    const tsName = snakeToCamel(exp.name);
    // VSCode problem matcher format: file:line:col: severity: message
    console.log(
      `${exp.absolutePath}:${exp.line}:1: warning: FFI export '${exp.name}' (${tsName}) is not used in TypeScript`
    );
  }

  // Output missing @see annotations
  for (const { wrapper, ffiExport } of missingSeeAnnotations) {
    // Format: @see rust fn_name in file:line - searchable and informative
    console.log(
      `${TS_WRAPPER}:${wrapper.line}:1: warning: Missing @see. Add: @see rust ${ffiExport.name} in ${ffiExport.file}:${ffiExport.line}`
    );
  }

  // Summary as info
  const issues = unused.length + missingSeeAnnotations.length;
  if (issues > 0) {
    console.log(
      `${TS_WRAPPER}:1:1: info: FFI audit: ${used.length}/${total} exports used, ${unused.length} unused, ${missingSeeAnnotations.length} missing @see`
    );
  }
}

// Human-readable output
function outputHuman(
  unused: FfiExport[],
  used: FfiExport[],
  total: number,
  missingSeeAnnotations: { wrapper: WrapperFunction; ffiExport: FfiExport }[]
) {
  console.log('🔍 FFI Boundary Audit\n');
  console.log('Rust source:', RUST_SRC);
  console.log('TS wrapper:', TS_WRAPPER);
  console.log('');
  console.log(`Found ${total} Rust FFI exports`);
  console.log(`Found ${used.length + unused.length} analyzed\n`);

  if (unused.length > 0) {
    console.log('⚠️  Unused Rust exports (not imported in TypeScript):');
    console.log('');
    for (const exp of unused) {
      console.log(`   ${exp.name}`);
      console.log(`      → ${exp.file}:${exp.line}`);
    }
    console.log('');
  }

  if (missingSeeAnnotations.length > 0) {
    console.log('⚠️  Missing @see annotations on wrapper functions:');
    console.log('');
    for (const { wrapper, ffiExport } of missingSeeAnnotations) {
      console.log(`   ${wrapper.name}() at line ${wrapper.line}`);
      console.log(`      calls: ${wrapper.ffiCalls.join(', ')}`);
      console.log(`      add: @see rust ${ffiExport.name} in ${ffiExport.file}:${ffiExport.line}`);
    }
    console.log('');
  }

  console.log(`✅ ${used.length}/${total} exports are used in TypeScript`);
  if (missingSeeAnnotations.length === 0) {
    console.log(`✅ All wrapper functions have @see annotations`);
  } else {
    console.log(`⚠️  ${missingSeeAnnotations.length} wrapper functions missing @see annotations`);
  }

  // Generate markdown table for documentation
  console.log('\n📋 FFI Mapping Table:\n');
  console.log('| TypeScript | Rust Function | Location |');
  console.log('|------------|---------------|----------|');

  for (const exp of used.sort((a, b) => a.name.localeCompare(b.name))) {
    const tsName = snakeToCamel(exp.name);
    console.log(`| \`${tsName}\` | \`${exp.name}\` | ${exp.file}:${exp.line} |`);
  }

  if (unused.length > 0) {
    console.log('\n⚠️  Consider removing unused exports or adding TypeScript wrappers');
  }
}

// Main audit
function audit() {
  const rustExports = findRustExports();
  const tsUsages = findTsUsages();

  // Check for unused Rust exports
  const unused: FfiExport[] = [];
  const used: FfiExport[] = [];

  for (const exp of rustExports) {
    const camelName = snakeToCamel(exp.name);
    if (tsUsages.has(camelName)) {
      used.push(exp);
    } else {
      unused.push(exp);
    }
  }

  // Build location map for @see checking
  const ffiLocationMap = buildFfiLocationMap(rustExports);

  // Find wrapper functions and check @see annotations
  const wrappers = findWrapperFunctions(ffiLocationMap);

  // Find wrappers missing @see annotations
  const missingSeeAnnotations: { wrapper: WrapperFunction; ffiExport: FfiExport }[] = [];

  for (const wrapper of wrappers) {
    if (!wrapper.hasSeeAnnotation && wrapper.ffiCalls.length > 0) {
      // Get the first FFI call's Rust location for the @see suggestion
      const firstCall = wrapper.ffiCalls[0];
      const ffiExport = ffiLocationMap.get(firstCall);
      if (ffiExport) {
        missingSeeAnnotations.push({ wrapper, ffiExport });
      }
    }
  }

  if (VSCODE_MODE) {
    outputVSCode(unused, used, rustExports.length, missingSeeAnnotations);
  } else {
    outputHuman(unused, used, rustExports.length, missingSeeAnnotations);
  }

  // Exit with error if there are issues
  if (unused.length > 0 || missingSeeAnnotations.length > 0) {
    process.exit(1);
  }
}

audit();
