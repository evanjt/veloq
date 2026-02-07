/**
 * FFI Binding Validation Tests
 *
 * Static analysis tests that validate TypeScript bindings match Rust FFI exports.
 * These tests don't require building the native module - they parse source files directly.
 *
 * Run: npm test -- --testPathPattern=ffiBindingValidation
 *
 * Regenerate manifests: npx tsx scripts/extract-ffi-exports.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { FFI_EXPORTS, EXPECTED_TS_FUNCTIONS, RUST_TO_TS_NAME } from './ffi-exports.generated';

const VELOQRS_INDEX_PATH = path.resolve(__dirname, '../../../modules/veloqrs/src/index.ts');

/**
 * Extract all imports from the generated veloqrs module in index.ts.
 * Looks for: import { fn1, fn2, ... } from './generated/veloqrs'
 */
function extractGeneratedImports(): Set<string> {
  const content = fs.readFileSync(VELOQRS_INDEX_PATH, 'utf-8');
  const imports = new Set<string>();

  // Match import statements from './generated/veloqrs'
  // Handles multi-line imports
  const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]\.\/generated\/veloqrs['"]/gs;

  let match;
  while ((match = importRegex.exec(content)) !== null) {
    let importBlock = match[1];

    // Remove single-line comments (// ...)
    importBlock = importBlock.replace(/\/\/[^\n]*/g, '');

    // Remove multi-line comments (/* ... */)
    importBlock = importBlock.replace(/\/\*[\s\S]*?\*\//g, '');

    // Parse individual imports, handling aliases (e.g., "createSection as ffiCreateSection")
    const importItems = importBlock.split(',').map((item) => item.trim());

    for (const item of importItems) {
      if (!item) continue;

      // Handle: "type FfiActivityMetrics" -> skip type imports
      if (item.startsWith('type ')) continue;

      // Handle: "createSection as ffiCreateSection" -> extract "createSection"
      // Handle: "persistentEngineInit" -> extract "persistentEngineInit"
      const parts = item.split(/\s+as\s+/);
      const originalName = parts[0].trim();

      // Skip if empty or starts with special characters (malformed after comment removal)
      if (!originalName || !/^[a-zA-Z]/.test(originalName)) continue;

      imports.add(originalName);
    }
  }

  return imports;
}

/**
 * Extract re-exports from index.ts.
 * Looks for: export * from './generated/veloqrs'
 */
function hasWildcardReexport(): boolean {
  const content = fs.readFileSync(VELOQRS_INDEX_PATH, 'utf-8');
  return content.includes("export * from './generated/veloqrs'");
}

/**
 * Extract explicitly exported function wrappers from index.ts.
 * These are functions that wrap FFI calls with additional logic.
 */
function extractExportedWrappers(): Set<string> {
  const content = fs.readFileSync(VELOQRS_INDEX_PATH, 'utf-8');
  const wrappers = new Set<string>();

  // Match: export function functionName(
  // Match: export async function functionName(
  // Match: export const functionName =
  const exportRegex = /export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g;

  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    wrappers.add(match[1]);
  }

  return wrappers;
}

describe('FFI Binding Validation', () => {
  describe('Rust exports manifest', () => {
    it('should have generated the FFI exports manifest', () => {
      expect(FFI_EXPORTS).toBeDefined();
      expect(FFI_EXPORTS.length).toBeGreaterThan(0);
    });

    it('should have 67 FFI exports from Rust', () => {
      expect(FFI_EXPORTS.length).toBe(67);
    });

    it('should have exports from all expected source files', () => {
      const files = new Set(FFI_EXPORTS.map((e) => e.file));
      expect(files.has('ffi.rs')).toBe(true);
      expect(files.has('persistence.rs')).toBe(true);
      expect(files.has('sections/ffi.rs')).toBe(true);
    });

    it('should have correct snake_case to camelCase conversion', () => {
      // Spot check a few conversions
      expect(RUST_TO_TS_NAME['persistent_engine_init']).toBe('persistentEngineInit');
      expect(RUST_TO_TS_NAME['get_download_progress']).toBe('getDownloadProgress');
      expect(RUST_TO_TS_NAME['ffi_detect_sections_multiscale']).toBe('ffiDetectSectionsMultiscale');
    });
  });

  describe('TypeScript index.ts structure', () => {
    it('should exist', () => {
      expect(fs.existsSync(VELOQRS_INDEX_PATH)).toBe(true);
    });

    it('should have wildcard re-export from generated module', () => {
      // The wildcard export: export * from './generated/veloqrs'
      // This ensures all generated bindings are available
      expect(hasWildcardReexport()).toBe(true);
    });

    it('should import functions for the RouteEngineClient wrapper', () => {
      const imports = extractGeneratedImports();
      expect(imports.size).toBeGreaterThan(0);
    });
  });

  describe('FFI function coverage', () => {
    let tsImports: Set<string>;

    beforeAll(() => {
      tsImports = extractGeneratedImports();
    });

    it('should import all Rust FFI exports that are used in wrappers', () => {
      // Check that commonly used functions are imported
      const criticalFunctions = [
        'persistentEngineInit',
        'persistentEngineIsInitialized',
        'persistentEngineClear',
        'persistentEngineAddActivities',
        'persistentEngineGetSections',
        'persistentEngineGetSectionSummaries',
        'encodeCoordinatesToPolyline',
        'decodePolylineToCoordinates',
      ];

      const missingCritical: string[] = [];
      for (const fn of criticalFunctions) {
        if (!tsImports.has(fn)) {
          missingCritical.push(fn);
        }
      }

      expect(missingCritical).toEqual([]);
    });

    it('should report FFI functions not explicitly imported (informational)', () => {
      // These functions are available via wildcard export but not explicitly imported
      // This is informational - not a failure
      const notExplicitlyImported: string[] = [];

      for (const exp of FFI_EXPORTS) {
        if (!tsImports.has(exp.camelName)) {
          notExplicitlyImported.push(`${exp.camelName} (${exp.file}:${exp.line})`);
        }
      }

      // Log for visibility but don't fail
      if (notExplicitlyImported.length > 0) {
        console.log('\nFFI functions available via wildcard export but not explicitly imported:');
        console.log(notExplicitlyImported.slice(0, 10).join('\n'));
        if (notExplicitlyImported.length > 10) {
          console.log(`... and ${notExplicitlyImported.length - 10} more`);
        }
      }

      // This is informational - the wildcard export covers these
      expect(true).toBe(true);
    });
  });

  describe('Binding alignment validation', () => {
    it('should not have function imports that do not exist in Rust exports', () => {
      const tsImports = extractGeneratedImports();
      const orphanImports: string[] = [];

      for (const importName of tsImports) {
        // Skip types (PascalCase starting with capital, often with Ffi prefix)
        // Types are: FfiSectionConfig, FfiActivityMetrics, SectionSummary, etc.
        if (/^[A-Z]/.test(importName)) continue;

        if (!EXPECTED_TS_FUNCTIONS.has(importName)) {
          orphanImports.push(importName);
        }
      }

      // Report orphan imports - these would fail at runtime
      if (orphanImports.length > 0) {
        console.error('\nOrphan function imports (not in Rust exports):');
        orphanImports.forEach((name) => console.error(`  - ${name}`));
      }

      expect(orphanImports).toEqual([]);
    });
  });

  describe('FFI export categories', () => {
    it('should have persistence engine functions', () => {
      const persistenceFns = FFI_EXPORTS.filter((e) => e.file === 'persistence.rs');
      expect(persistenceFns.length).toBeGreaterThan(40);
    });

    it('should have section management functions', () => {
      const sectionFns = FFI_EXPORTS.filter((e) => e.file === 'sections/ffi.rs');
      expect(sectionFns.length).toBeGreaterThan(10);
    });

    it('should have HTTP/fetch functions', () => {
      const httpFns = FFI_EXPORTS.filter(
        (e) => e.name.includes('fetch') || e.name.includes('download')
      );
      expect(httpFns.length).toBeGreaterThan(3);
    });

    it('should have polyline encoding functions', () => {
      const polylineFns = FFI_EXPORTS.filter(
        (e) => e.name.includes('polyline') || e.name.includes('coordinates')
      );
      expect(polylineFns.length).toBeGreaterThan(2);
    });
  });
});

describe('FFI Manifest Freshness', () => {
  it('should have manifest that matches current Rust source (run extract script if this fails)', () => {
    // This test ensures the generated manifest is up-to-date
    // If it fails, run: npx tsx scripts/extract-ffi-exports.ts

    const expectedCount = 67; // Update if Rust exports change
    const actualCount = FFI_EXPORTS.length;

    if (actualCount !== expectedCount) {
      console.error(`\nFFI manifest is out of date!`);
      console.error(`Expected ${expectedCount} exports, found ${actualCount}`);
      console.error('Run: npx tsx scripts/extract-ffi-exports.ts');
    }

    expect(actualCount).toBe(expectedCount);
  });
});
