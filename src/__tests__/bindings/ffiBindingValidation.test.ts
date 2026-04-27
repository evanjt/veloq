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
import {
  FFI_EXPORTS,
  EXPECTED_TS_FUNCTIONS,
  RUST_TO_TS_NAME,
  UNIFFI_OBJECTS,
} from './ffi-exports.generated';

const VELOQRS_SRC_DIR = path.resolve(__dirname, '../../../modules/veloqrs/src');
const VELOQRS_INDEX_PATH = path.join(VELOQRS_SRC_DIR, 'index.ts');
const RUST_OBJECTS_DIR = path.resolve(
  __dirname,
  '../../../modules/veloqrs/rust/veloqrs/src/objects'
);

/**
 * Extract all imports from the generated veloqrs module across all wrapper files.
 * Looks for: import { fn1, fn2, ... } from './generated/veloqrs'
 */
function extractGeneratedImports(): Set<string> {
  const files = ['index.ts', 'RouteEngineClient.ts'];
  const imports = new Set<string>();

  for (const file of files) {
    const filePath = path.join(VELOQRS_SRC_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    extractImportsFromContent(content, imports);
  }

  return imports;
}

function extractImportsFromContent(content: string, imports: Set<string>): void {
  const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]\.\/generated\/veloqrs['"]/gs;

  let match;
  while ((match = importRegex.exec(content)) !== null) {
    let importBlock = match[1];
    importBlock = importBlock.replace(/\/\/[^\n]*/g, '');
    importBlock = importBlock.replace(/\/\*[\s\S]*?\*\//g, '');

    const importItems = importBlock.split(',').map((item) => item.trim());

    for (const item of importItems) {
      if (!item) continue;
      if (item.startsWith('type ')) continue;

      const parts = item.split(/\s+as\s+/);
      const originalName = parts[0].trim();
      if (!originalName || !/^[a-zA-Z]/.test(originalName)) continue;

      imports.add(originalName);
    }
  }
}

function hasWildcardReexport(): boolean {
  const content = fs.readFileSync(VELOQRS_INDEX_PATH, 'utf-8');
  return /export \* from ['"]\.\/generated\/veloqrs['"]/.test(content);
}

// Object name -> source file mapping (not a simple PascalCase→snake_case
// because of historical naming, e.g. HeatmapManager lives in `tiles.rs`).
const OBJECT_SOURCE_FILES: Record<string, string> = {
  VeloqEngine: 'engine.rs',
  SectionManager: 'sections.rs',
  ActivityManager: 'activities.rs',
  RouteManager: 'routes.rs',
  MapManager: 'maps.rs',
  FitnessManager: 'fitness.rs',
  SettingsManager: 'settings.rs',
  DetectionManager: 'detection.rs',
  StrengthManager: 'strength.rs',
  HeatmapManager: 'tiles.rs',
};

const STANDALONE_EXPORTS = FFI_EXPORTS.filter((e) => !e.object);
const METHOD_EXPORTS = FFI_EXPORTS.filter((e) => e.object);

describe('FFI Binding Validation', () => {
  describe('Standalone flat exports', () => {
    it('should have the expected five standalone flat exports', () => {
      // The domain-object migration left exactly five non-object-method
      // standalone functions (download progress, fetch lifecycle, polyline
      // overlap, match strictness). Adjust if a new standalone is added —
      // but prefer putting engine-coupled logic on a UniFFI Object.
      expect(STANDALONE_EXPORTS.length).toBe(5);
    });

    it('should include the known standalone FFI functions', () => {
      const names = new Set(STANDALONE_EXPORTS.map((e) => e.name));
      expect(names.has('get_download_progress')).toBe(true);
      expect(names.has('validate_backup_database')).toBe(true);
      expect(names.has('start_fetch_and_store')).toBe(true);
      expect(names.has('take_fetch_and_store_result')).toBe(true);
      expect(names.has('compute_polyline_overlap')).toBe(true);
    });

    it('should have exports sourced from ffi.rs and persistence/mod.rs', () => {
      const files = new Set(STANDALONE_EXPORTS.map((e) => e.file));
      expect(files.has('ffi.rs')).toBe(true);
      expect(files.has('persistence/mod.rs')).toBe(true);
    });

    it('should have correct snake_case to camelCase conversion', () => {
      expect(RUST_TO_TS_NAME['get_download_progress']).toBe('getDownloadProgress');
      expect(RUST_TO_TS_NAME['compute_polyline_overlap']).toBe('computePolylineOverlap');
    });
  });

  describe('UniFFI Objects', () => {
    it('should discover all domain objects from Rust source', () => {
      // Detected by scanning `#[uniffi::export] impl Foo` blocks. The exact
      // count is whatever the generator found — assert a sensible lower bound
      // and that every discovered object has a file mapping in this test.
      expect(UNIFFI_OBJECTS.length).toBeGreaterThanOrEqual(8);
    });

    it('should have Rust source files for each object', () => {
      const missing: string[] = [];
      for (const obj of UNIFFI_OBJECTS) {
        const fileName = OBJECT_SOURCE_FILES[obj];
        if (!fileName) {
          missing.push(`${obj} -> no mapping (add to OBJECT_SOURCE_FILES)`);
          continue;
        }
        const filePath = path.join(RUST_OBJECTS_DIR, fileName);
        if (!fs.existsSync(filePath)) {
          missing.push(`${obj} -> ${fileName}`);
        }
      }
      expect(missing).toEqual([]);
    });

    it('should have #[uniffi::export] impl blocks in each object file', () => {
      const missingExport: string[] = [];
      for (const obj of UNIFFI_OBJECTS) {
        const fileName = OBJECT_SOURCE_FILES[obj];
        if (!fileName) continue;
        const filePath = path.join(RUST_OBJECTS_DIR, fileName);
        if (!fs.existsSync(filePath)) continue;
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.includes('#[uniffi::export]')) {
          missingExport.push(obj);
        }
      }
      expect(missingExport).toEqual([]);
    });

    it('every impl-method export should reference a known UniFFI Object', () => {
      const knownObjects = new Set(UNIFFI_OBJECTS);
      const orphans = METHOD_EXPORTS.filter(
        (e) => !knownObjects.has(e.object as (typeof UNIFFI_OBJECTS)[number])
      );
      expect(orphans.map((e) => `${e.object}::${e.name}`)).toEqual([]);
    });
  });

  describe('TypeScript index.ts structure', () => {
    it('should exist', () => {
      expect(fs.existsSync(VELOQRS_INDEX_PATH)).toBe(true);
    });

    it('should have wildcard re-export from generated module', () => {
      expect(hasWildcardReexport()).toBe(true);
    });

    it('should import standalone functions in index.ts', () => {
      const imports = extractGeneratedImports();
      expect(imports.size).toBeGreaterThan(0);
    });
  });

  describe('FFI function coverage', () => {
    let tsImports: Set<string>;

    beforeAll(() => {
      tsImports = extractGeneratedImports();
    });

    it('should import standalone flat functions used in index.ts', () => {
      const standaloneFunctions = ['getDownloadProgress'];

      const missing: string[] = [];
      for (const fn of standaloneFunctions) {
        if (!tsImports.has(fn)) {
          missing.push(fn);
        }
      }

      expect(missing).toEqual([]);
    });
  });

  describe('Strength FFI contract (US-T1/T2)', () => {
    // Guards that the demo-mode insertion path stays wired end-to-end.
    // Both sides — the Rust method and the TS client method — must exist so
    // demo fixtures can seed WeightTraining activities without network calls.
    const STRENGTH_RS = path.resolve(
      __dirname,
      '../../../modules/veloqrs/rust/veloqrs/src/objects/strength.rs'
    );
    const ROUTE_ENGINE_CLIENT_TS = path.join(VELOQRS_SRC_DIR, 'RouteEngineClient.ts');

    it('Rust StrengthManager exposes bulk_insert_exercise_sets', () => {
      const source = fs.readFileSync(STRENGTH_RS, 'utf-8');
      expect(source).toMatch(/fn bulk_insert_exercise_sets\s*\(/);
      expect(source).toMatch(/Vec<FfiExerciseSet>/);
    });

    it('TS client wraps bulkInsertExerciseSets', () => {
      const source = fs.readFileSync(ROUTE_ENGINE_CLIENT_TS, 'utf-8');
      expect(source).toMatch(/bulkInsertExerciseSets\s*\(/);
      expect(source).toContain('strength().bulkInsertExerciseSets');
    });
  });

  describe('Binding alignment validation', () => {
    it('should not have function imports that do not exist in Rust exports', () => {
      const tsImports = extractGeneratedImports();
      const orphanImports: string[] = [];

      for (const importName of tsImports) {
        // Skip types (PascalCase starting with capital)
        if (/^[A-Z]/.test(importName)) continue;

        if (!EXPECTED_TS_FUNCTIONS.has(importName)) {
          orphanImports.push(importName);
        }
      }

      if (orphanImports.length > 0) {
        console.error('\nOrphan function imports (not in Rust exports):');
        orphanImports.forEach((name) => console.error(`  - ${name}`));
      }

      expect(orphanImports).toEqual([]);
    });
  });
});

describe('FFI Manifest Freshness', () => {
  it('should have a non-trivial number of exports from Rust source', () => {
    // The manifest is auto-generated from `#[uniffi::export]` attributes
    // (both standalone `pub fn` and methods inside `#[uniffi::export] impl`
    // blocks). If this ever drops to a handful again, the extractor has
    // regressed — see scripts/extract-ffi-exports.ts.
    expect(FFI_EXPORTS.length).toBeGreaterThan(50);
  });
});
