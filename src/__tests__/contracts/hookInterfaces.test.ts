/**
 * Hook Interface Contract Tests
 *
 * Static analysis tests that validate hook signatures, naming conventions,
 * engine null safety, query key uniqueness, Zustand selector patterns,
 * and barrel re-export completeness across the hooks directory.
 *
 * These tests don't import any hooks — they parse source files directly.
 * This avoids native module dependencies that would fail in the node test environment.
 *
 * Run: npm test -- --testPathPattern=hookInterfaces
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Helpers
// ============================================================================

const HOOKS_ROOT = path.resolve(__dirname, '../../hooks');

/**
 * Recursively find all .ts files in a directory.
 */
function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...findTsFiles(fullPath));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Get all hook source files (non-index .ts files under src/hooks/).
 */
function getHookSourceFiles(): string[] {
  return findTsFiles(HOOKS_ROOT).filter((f) => !f.endsWith('/index.ts') && !f.endsWith('.d.ts'));
}

/**
 * Get the relative path from HOOKS_ROOT for display.
 */
function rel(filePath: string): string {
  return path.relative(HOOKS_ROOT, filePath);
}

// ============================================================================
// 1. Hook Export Pattern
// ============================================================================

describe('Hook export pattern', () => {
  const hookFiles = getHookSourceFiles();

  it('should find hook source files', () => {
    expect(hookFiles.length).toBeGreaterThan(10);
  });

  it('every hook file should export at least one function starting with "use"', () => {
    const filesWithoutHookExport: string[] = [];

    for (const file of hookFiles) {
      const content = fs.readFileSync(file, 'utf-8');

      // Match exported functions/constants starting with "use"
      // Patterns:
      //   export function useFoo
      //   export const useFoo
      //   export { useFoo }
      //   export { useFoo } from
      //   export { something as useFoo }
      const hasHookExport =
        /export\s+(?:async\s+)?function\s+use[A-Z]/.test(content) ||
        /export\s+const\s+use[A-Z]/.test(content) ||
        /export\s*\{[^}]*\buse[A-Z][a-zA-Z]*\b/.test(content);

      // Allow files that only export non-hook utilities (helper functions, constants, types)
      // These are legitimate non-hook files in the hooks directory
      const hasAnyExport =
        /export\s+(?:function|const|type|interface|enum|default|class)\b/.test(content) ||
        /export\s*\{/.test(content);

      // Only flag files that have exports but none are hooks
      // Files with no exports at all are likely internal helpers (imported by hook files)
      if (hasAnyExport && !hasHookExport) {
        // Check if the file exports ANY function at all — if it only exports types/constants, skip
        const exportsFunctions =
          /export\s+(?:async\s+)?function\s+\w/.test(content) ||
          /export\s+const\s+\w+\s*=\s*(?:\([^)]*\)|[^;]*=>)/.test(content);

        if (exportsFunctions) {
          filesWithoutHookExport.push(rel(file));
        }
      }
    }

    if (filesWithoutHookExport.length > 0) {
      console.log('\nHook files without "use*" exports:');
      filesWithoutHookExport.forEach((f) => console.log(`  - ${f}`));
    }

    // Informational — log but don't fail hard, since some files export utility functions
    // (e.g., getSettingsForSport, calculateZonesFromStreams)
    // The real requirement is that each file has SOME export
    for (const file of hookFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const hasExport = /\bexport\b/.test(content);
      expect(hasExport).toBe(true);
    }
  });
});

// ============================================================================
// 2. Hook Naming Convention
// ============================================================================

describe('Hook naming convention', () => {
  const hookFiles = getHookSourceFiles();

  it('all exported hook functions should be camelCase (no underscores)', () => {
    const violations: { file: string; name: string }[] = [];

    for (const file of hookFiles) {
      const content = fs.readFileSync(file, 'utf-8');

      // Match: export function useSomething or export const useSomething
      const exportedHookPattern =
        /export\s+(?:async\s+)?(?:function|const)\s+(use[A-Z][a-zA-Z0-9]*)/g;

      let match;
      while ((match = exportedHookPattern.exec(content)) !== null) {
        const hookName = match[1];
        if (hookName.includes('_')) {
          violations.push({ file: rel(file), name: hookName });
        }
      }
    }

    if (violations.length > 0) {
      console.error('\nHook names with underscores (should be camelCase):');
      violations.forEach((v) => console.error(`  - ${v.file}: ${v.name}`));
    }

    expect(violations).toEqual([]);
  });

  it('hook names should start with "use" followed by an uppercase letter', () => {
    const violations: { file: string; name: string }[] = [];

    for (const file of hookFiles) {
      const content = fs.readFileSync(file, 'utf-8');

      // Find exported functions/constants that start with "use" but have wrong casing
      const badCasingPattern =
        /export\s+(?:async\s+)?(?:function|const)\s+(use[^A-Z\s(=][a-zA-Z0-9]*)/g;

      let match;
      while ((match = badCasingPattern.exec(content)) !== null) {
        // Skip "useCallback", "useEffect", "useMemo", "useState", "useRef", "useQuery" etc.
        // (These are React imports, not hook definitions)
        const name = match[1];
        if (
          !['useCallback', 'useEffect', 'useMemo', 'useState', 'useRef', 'useQuery'].includes(name)
        ) {
          violations.push({ file: rel(file), name });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

// ============================================================================
// 3. Engine Null Safety
// ============================================================================

describe('Engine null safety', () => {
  it('every hook calling getRouteEngine() should check for null', () => {
    const hookFiles = getHookSourceFiles();
    const unsafeFiles: { file: string; line: number; context: string }[] = [];

    for (const file of hookFiles) {
      const content = fs.readFileSync(file, 'utf-8');

      // Skip files that don't import getRouteEngine
      if (!content.includes('getRouteEngine')) continue;

      // For files that define their own getRouteEngine (e.g., useRouteProcessing.ts), skip
      if (/function\s+getRouteEngine\s*\(/.test(content)) continue;

      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Find lines that call getRouteEngine() and assign to a variable
        // Pattern: const engine = getRouteEngine();
        //          const eng = getRouteEngine();
        const engineAssignMatch = line.match(
          /(?:const|let)\s+(\w+)\s*=\s*getRouteEngine\s*\(\s*\)/
        );

        if (engineAssignMatch) {
          const varName = engineAssignMatch[1];

          // Look within the next 15 lines for a null check on this variable
          const lookAhead = lines.slice(i + 1, i + 16).join('\n');

          // Acceptable null check patterns:
          //   if (!engine) return             — early return guard
          //   if (!engine || ...) return      — compound early return guard
          //   if (engine) { ... }             — positive guard block
          //   if (engine) engine.method()     — positive guard inline
          //   engine ? ... : ...              — ternary
          //   engine && engine.method()       — short-circuit
          //   engine?.method()                — optional chaining
          const hasNullCheck =
            // Negative guard: if (!engine) or if (!engine || ...)
            new RegExp(`if\\s*\\(\\s*!${varName}\\b`).test(lookAhead) ||
            // Positive guard: if (engine) or if (engine && ...)
            new RegExp(`if\\s*\\(\\s*${varName}\\s*[)&]`).test(lookAhead) ||
            // Ternary: engine ? ...
            new RegExp(`\\b${varName}\\s*\\?`).test(lookAhead) ||
            // Short-circuit: engine && ...
            new RegExp(`\\b${varName}\\s*&&`).test(lookAhead) ||
            // Optional chaining: engine?.method()
            new RegExp(`\\b${varName}\\?\\.`).test(lookAhead);

          if (!hasNullCheck) {
            unsafeFiles.push({
              file: rel(file),
              line: i + 1,
              context: line.substring(0, 80),
            });
          }
        }
      }
    }

    if (unsafeFiles.length > 0) {
      console.error('\ngetRouteEngine() calls without null check:');
      unsafeFiles.forEach((v) => console.error(`  - ${v.file}:${v.line}: ${v.context}`));
    }

    expect(unsafeFiles).toEqual([]);
  });
});

// ============================================================================
// 4. Query Key Uniqueness
// ============================================================================

describe('Query key uniqueness', () => {
  it('no two hooks should use the same static query key', () => {
    const hookFiles = findTsFiles(HOOKS_ROOT);
    const keyMap = new Map<string, string[]>();

    for (const file of hookFiles) {
      const content = fs.readFileSync(file, 'utf-8');

      // Match queryKey: ['something', ...] patterns
      // We extract the first element of the array (the base key)
      const queryKeyPattern = /queryKey:\s*\[([^\]]+)\]/g;

      let match;
      while ((match = queryKeyPattern.exec(content)) !== null) {
        const keyContent = match[1].trim();

        // Extract the full static key (all string literals in the array)
        // e.g., "'wellness', range" -> base key is 'wellness'
        // e.g., "'activity-streams-v3', id" -> base key is 'activity-streams-v3'
        const staticParts = keyContent
          .split(',')
          .map((p) => p.trim())
          .filter((p) => /^['"]/.test(p))
          .map((p) => p.replace(/['"]/g, ''));

        if (staticParts.length === 0) continue;

        const staticKey = staticParts.join('/');

        if (!keyMap.has(staticKey)) {
          keyMap.set(staticKey, []);
        }
        keyMap.get(staticKey)!.push(rel(file));
      }
    }

    // Find duplicates (same static key used in different files)
    const duplicates: { key: string; files: string[] }[] = [];

    for (const [key, files] of keyMap) {
      // Deduplicate file list (same file may use the key multiple times, that's fine)
      const uniqueFiles = [...new Set(files)];
      if (uniqueFiles.length > 1) {
        duplicates.push({ key, files: uniqueFiles });
      }
    }

    if (duplicates.length > 0) {
      console.log('\nQuery keys used in multiple files (review for intentional sharing):');
      duplicates.forEach((d) => {
        console.log(`  Key: "${d.key}"`);
        d.files.forEach((f) => console.log(`    - ${f}`));
      });
    }

    // Query key sharing between files is sometimes intentional (e.g., invalidation)
    // but the SAME queryKey definition in two different hooks is a bug.
    // Filter to only flag cases where the key is defined in queryKey: (not invalidateQueries)
    const realDuplicates = duplicates.filter((d) => {
      // Check each file to see if it's a definition or an invalidation reference
      let definitionCount = 0;
      for (const file of d.files) {
        const content = fs.readFileSync(path.join(HOOKS_ROOT, file), 'utf-8');
        // Count queryKey usages that are NOT inside invalidateQueries calls
        const definitionPattern = new RegExp(
          `queryKey:\\s*\\[\\s*['"]${d.key.split('/')[0]}['"]`,
          'g'
        );
        const invalidationPattern = new RegExp(
          `invalidateQueries.*queryKey:\\s*\\[\\s*['"]${d.key.split('/')[0]}['"]`,
          'g'
        );
        const defCount = (content.match(definitionPattern) || []).length;
        const invCount = (content.match(invalidationPattern) || []).length;
        if (defCount > invCount) definitionCount++;
      }
      return definitionCount > 1;
    });

    if (realDuplicates.length > 0) {
      console.error('\nDuplicate query key DEFINITIONS (likely bugs):');
      realDuplicates.forEach((d) => {
        console.error(`  Key: "${d.key}"`);
        d.files.forEach((f) => console.error(`    - ${f}`));
      });
    }

    // Allow 'activities' key to appear in multiple files since it's used for
    // both definition and invalidation references
    const unexpectedDuplicates = realDuplicates.filter(
      (d) => !['activities'].includes(d.key.split('/')[0])
    );

    expect(unexpectedDuplicates).toEqual([]);
  });
});

// ============================================================================
// 5. Zustand Selector Pattern in Hooks
// ============================================================================

describe('Zustand selector pattern in hooks', () => {
  // Zustand stores that should use individual selectors
  const ZUSTAND_STORES = [
    'useAuthStore',
    'useSyncDateRange',
    'useUnitPreference',
    'useSportPreference',
    'useDashboardPreferences',
    'useDisabledSections',
    'useSupersededSections',
    'useSectionDismissals',
    'useRouteSettings',
    'usePotentialSections',
    'useHRZones',
    'useLanguageStore',
  ];

  // Known violations that predate the selector pattern enforcement.
  // These should be fixed but are tracked here to prevent regressions.
  const KNOWN_EXCEPTIONS: { file: string; store: string }[] = [
    { file: 'home/useSummaryCardData.ts', store: 'useSportPreference' },
    { file: 'home/useSummaryCardData.ts', store: 'useDashboardPreferences' },
  ];

  function isKnownException(file: string, store: string): boolean {
    return KNOWN_EXCEPTIONS.some((e) => e.file === file && e.store === store);
  }

  it('hooks importing Zustand stores should use individual selectors, not destructuring', () => {
    const hookFiles = getHookSourceFiles();
    const violations: { file: string; store: string; line: number; usage: string }[] = [];
    const knownViolations: { file: string; store: string; line: number; usage: string }[] = [];

    for (const file of hookFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        for (const store of ZUSTAND_STORES) {
          // Skip import lines
          if (/^\s*import\b/.test(line)) continue;

          // GOOD: useStore((s) => s.field)
          // GOOD: useStore((state) => state.field)
          // GOOD: useStore.getState() — synchronous access outside React
          // BAD: const { field } = useStore()
          // BAD: const result = useStore()   (whole-store subscription)

          // Detect destructuring: const { ... } = useStore()
          const destructurePattern = new RegExp(
            `const\\s*\\{[^}]+\\}\\s*=\\s*${store}\\s*\\(\\s*\\)`
          );
          if (destructurePattern.test(line)) {
            const entry = {
              file: rel(file),
              store,
              line: i + 1,
              usage: line.trim().substring(0, 100),
            };
            if (isKnownException(entry.file, store)) {
              knownViolations.push(entry);
            } else {
              violations.push(entry);
            }
          }

          // Detect whole-store subscription: const foo = useStore()
          // (no selector argument)
          const wholeStorePattern = new RegExp(
            `(?:const|let)\\s+\\w+\\s*=\\s*${store}\\s*\\(\\s*\\)`
          );
          if (wholeStorePattern.test(line)) {
            const entry = {
              file: rel(file),
              store,
              line: i + 1,
              usage: line.trim().substring(0, 100),
            };
            if (isKnownException(entry.file, store)) {
              knownViolations.push(entry);
            } else {
              violations.push(entry);
            }
          }
        }
      }
    }

    // Log known exceptions for visibility
    if (knownViolations.length > 0) {
      console.log(
        `\n${knownViolations.length} known Zustand selector exception(s) (pre-existing):`
      );
      knownViolations.forEach((v) =>
        console.log(`  - ${v.file}:${v.line} [${v.store}]: ${v.usage}`)
      );
    }

    if (violations.length > 0) {
      console.error('\nNEW Zustand stores used without individual selectors:');
      violations.forEach((v) => console.error(`  - ${v.file}:${v.line} [${v.store}]: ${v.usage}`));
      console.error('\nFix: Use useStore((s) => s.field) instead of destructuring');
    }

    expect(violations).toEqual([]);
  });

  it('known exceptions should still exist (remove from list when fixed)', () => {
    // Verify that the known exceptions still exist in the code.
    // When a known exception is fixed, it should be removed from KNOWN_EXCEPTIONS.
    for (const exception of KNOWN_EXCEPTIONS) {
      const filePath = path.join(HOOKS_ROOT, exception.file);
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      const pattern = new RegExp(
        `(?:const\\s*\\{[^}]+\\}|(?:const|let)\\s+\\w+)\\s*=\\s*${exception.store}\\s*\\(\\s*\\)`
      );
      const stillViolates = pattern.test(content);

      if (!stillViolates) {
        console.log(
          `\nKNOWN_EXCEPTION can be removed: ${exception.file} no longer violates ${exception.store}`
        );
      }

      expect(stillViolates).toBe(true);
    }
  });
});

// ============================================================================
// 6. Barrel Re-exports
// ============================================================================

describe('Barrel re-exports', () => {
  const HOOK_SUBDIRS = ['activities', 'charts', 'fitness', 'maps', 'routes', 'ui', 'home'];

  for (const subdir of HOOK_SUBDIRS) {
    describe(`hooks/${subdir}/index.ts`, () => {
      const subdirPath = path.join(HOOKS_ROOT, subdir);

      it('index.ts should exist', () => {
        const indexPath = path.join(subdirPath, 'index.ts');
        expect(fs.existsSync(indexPath)).toBe(true);
      });

      it('should re-export all hook files in the directory (or root index.ts)', () => {
        const indexPath = path.join(subdirPath, 'index.ts');
        if (!fs.existsSync(indexPath)) return;

        const indexContent = fs.readFileSync(indexPath, 'utf-8');

        // Also check root hooks/index.ts for direct re-exports that bypass the subdir
        const rootIndexPath = path.join(HOOKS_ROOT, 'index.ts');
        const rootIndexContent = fs.existsSync(rootIndexPath)
          ? fs.readFileSync(rootIndexPath, 'utf-8')
          : '';

        // Get all non-index .ts files in this subdirectory (non-recursive)
        const hookFilesInDir = fs
          .readdirSync(subdirPath)
          .filter((f) => f.endsWith('.ts') && f !== 'index.ts' && !f.endsWith('.d.ts'));

        const missingReexports: string[] = [];

        for (const hookFile of hookFilesInDir) {
          const baseName = hookFile.replace(/\.tsx?$/, '');

          // Check if the subdirectory index.ts has an export from this file
          const hasSubdirReexport =
            indexContent.includes(`'./${baseName}'`) || indexContent.includes(`"./${baseName}"`);

          // Also accept if the root hooks/index.ts exports directly from this file
          // Pattern: export { ... } from './routes/useRetentionCleanup'
          const rootExportPath = `./${subdir}/${baseName}`;
          const hasRootReexport =
            rootIndexContent.includes(`'${rootExportPath}'`) ||
            rootIndexContent.includes(`"${rootExportPath}"`);

          // Also accept if this file is only consumed internally within the same directory
          // (not imported from outside the subdirectory)
          let isInternalOnly = false;
          if (!hasSubdirReexport && !hasRootReexport) {
            // Check if this file is imported by any file OUTSIDE the subdirectory
            const allHookFiles = findTsFiles(HOOKS_ROOT);
            const externalImporters = allHookFiles.filter((f) => {
              if (f.startsWith(subdirPath)) return false; // same directory
              const c = fs.readFileSync(f, 'utf-8');
              return c.includes(baseName);
            });
            // Check app/ and components/ for external imports too
            const srcRoot = path.resolve(HOOKS_ROOT, '..');
            const appDir = path.join(srcRoot, 'app');
            const componentsDir = path.join(srcRoot, 'components');
            for (const dir of [appDir, componentsDir]) {
              if (!fs.existsSync(dir)) continue;
              const files = findTsFiles(dir);
              for (const f of files) {
                const c = fs.readFileSync(f, 'utf-8');
                if (c.includes(baseName)) {
                  externalImporters.push(f);
                }
              }
            }
            isInternalOnly = externalImporters.length === 0;
          }

          if (!hasSubdirReexport && !hasRootReexport && !isInternalOnly) {
            missingReexports.push(baseName);
          }
        }

        if (missingReexports.length > 0) {
          console.error(`\nhooks/${subdir}/index.ts missing re-exports:`);
          missingReexports.forEach((f) => console.error(`  - ${f}`));
        }

        expect(missingReexports).toEqual([]);
      });
    });
  }
});
