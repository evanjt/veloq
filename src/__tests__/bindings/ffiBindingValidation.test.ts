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
  const files = ['index.ts', 'EngineClient.ts'];
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
  BasemapManager: 'basemap.rs',
  SyncManager: 'sync.rs',
  RecordingManager: 'recordings.rs',
  RouteGroupingPreview: 'preview.rs',
  SectionPreview: 'preview.rs',
};

const STANDALONE_EXPORTS = FFI_EXPORTS.filter((e) => !e.object);
const METHOD_EXPORTS = FFI_EXPORTS.filter((e) => e.object);

describe('FFI Binding Validation', () => {
  describe('Standalone flat exports', () => {
    it('should have the expected standalone flat exports', () => {
      // Non-object-method standalone functions (download progress, fetch
      // lifecycle including its cancel, polyline overlap, backup validation,
      // elevation backfill start, pause, resume, paused, progress and
      // remaining,
      // the seven detector-cutover calls: pending, running, start, cancel,
      // progress, diff and change-card support, the two connectivity calls,
      // and the
      // quarantine report). Adjust if a new standalone is added - but prefer
      // putting engine-coupled logic on a UniFFI Object.
      //
      // The connectivity pair is standalone on purpose. It is a process-wide
      // value the network provider pushes before `initWithPath` has run, so
      // an engine method would drop the very first edge. The quarantine report
      // is standalone for the same reason: it is written during init, before
      // there is a handle to hang it on, and it says the library that handle
      // opens is not the one the athlete had.
      //
      // The four stream-backfill calls sit here for the same reason the
      // elevation ones do, and beside them: the pass is a detached thread
      // holding a process-global slot, and its start, stop and progress are
      // all reads of that slot rather than of a handle.
      //
      // `get_fetch_run_progress` is standalone beside the global read it
      // narrows: the download queue is process state in `http`, not engine
      // state, and a caller polling its own run must not queue behind the
      // engine lock to do it.
      //
      // `fetch_and_index_activity` sits beside the rest of that fetch
      // lifecycle, for the reason `cancel_fetch_and_store` does. It is the
      // blocking single-activity sibling of `start_fetch_and_store`, over the
      // same fetch and the same store, and its caller is the case that pair
      // cannot serve: a push handler in Kotlin or Swift holding an activity
      // id, a budget in seconds and no run loop to poll a global slot on.
      // Hanging it on an object would make that handler build a handle across
      // the FFI first, an allocation and a failure mode inside that budget,
      // for a call that is one shot rather than a session.
      expect(STANDALONE_EXPORTS.length).toBe(28);
    });

    it('should include the known standalone FFI functions', () => {
      const names = new Set(STANDALONE_EXPORTS.map((e) => e.name));
      expect(names.has('get_download_progress')).toBe(true);
      expect(names.has('validate_backup_database')).toBe(true);
      expect(names.has('start_fetch_and_store')).toBe(true);
      expect(names.has('take_fetch_and_store_result')).toBe(true);
      // A fetch that could not be called off stranded the progress flag and
      // spun the reader at 10 Hz for the rest of the session.
      expect(names.has('cancel_fetch_and_store')).toBe(true);
      // Standalone with the rest of the fetch lifecycle it belongs to: it
      // flips a process-wide flag in `http` and never touches the engine, so
      // an engine method would be the wrong home and would queue behind the
      // lock the cancel exists to stop taking.
      expect(names.has('cancel_fetch_and_store')).toBe(true);
      // One id in, a summary out, blocking. The native push handler this was
      // built for has no run loop to poll the global slot the batch reports
      // through, so the composition it needs lives beside that batch.
      expect(names.has('fetch_and_index_activity')).toBe(true);
      // A caller queued behind a 500-activity sync used to poll the global
      // flag and watch someone else's numbers long after its own had landed.
      expect(names.has('get_fetch_run_progress')).toBe(true);
      expect(names.has('compute_polyline_overlap')).toBe(true);
      // Deleted with the synthetic detection illustration, its only caller.
      // Named here so a re-add has to answer for itself rather than ride in
      // on a bumped count.
      expect(names.has('detect_sections_standalone')).toBe(false);
      expect(names.has('start_elevation_backfill')).toBe(true);
      expect(names.has('pause_elevation_backfill')).toBe(true);
      // A pause with no inverse held detection for the rest of the process,
      // with a force-quit as the only exit. This is that inverse.
      expect(names.has('resume_elevation_backfill')).toBe(true);
      expect(names.has('is_elevation_backfill_paused')).toBe(true);
      expect(names.has('get_elevation_backfill_progress')).toBe(true);
      expect(names.has('get_elevation_backfill_remaining')).toBe(true);
      expect(names.has('start_stream_backfill')).toBe(true);
      // Tens of megabytes on the athlete's own connection, so unlike the
      // elevation pass nothing starts this at launch and the stop is the
      // control that matters.
      expect(names.has('stop_stream_backfill')).toBe(true);
      expect(names.has('get_stream_backfill_progress')).toBe(true);
      expect(names.has('get_stream_backfill_remaining')).toBe(true);
      expect(names.has('is_cutover_pending')).toBe(true);
      expect(names.has('is_cutover_running')).toBe(true);
      expect(names.has('start_detector_cutover')).toBe(true);
      // A cut that could not be stopped left a force-quit as the only lever,
      // and the in-flight token undid that on the next launch. This is the
      // lever.
      expect(names.has('cancel_detector_cutover')).toBe(true);
      expect(names.has('get_cutover_progress')).toBe(true);
      expect(names.has('get_cutover_diff')).toBe(true);
      expect(names.has('take_quarantine_report')).toBe(true);
      expect(names.has('set_network_online')).toBe(true);
      expect(names.has('get_network_push')).toBe(true);
      // A whole-catalogue rollback is not offered: the detector keeps moving,
      // so restoring is per section.
      expect(names.has('restore_from_cutover_archive')).toBe(false);
      // A cut is a cold detect, so it must never be callable inline.
      expect(names.has('run_detector_cutover')).toBe(false);
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
      // count is whatever the generator found - assert a sensible lower bound
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
    // Both sides - the Rust method and the TS client method - must exist so
    // demo fixtures can seed WeightTraining activities without network calls.
    const STRENGTH_RS = path.resolve(
      __dirname,
      '../../../modules/veloqrs/rust/veloqrs/src/objects/strength.rs'
    );
    const ROUTE_ENGINE_CLIENT_TS = path.join(VELOQRS_SRC_DIR, 'EngineClient.ts');

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

  // The manifest is extracted from Rust source and the bindings are generated
  // from a compiled library, so the two can disagree and nothing noticed. An
  // export whose signature the generator refuses leaves the manifest naming a
  // function the bindings do not have: it is callable from no TypeScript, the
  // app still starts because a uniffi checksum is per item, and the suite passed.
  describe('Generated bindings cover the manifest', () => {
    const GENERATED_PATH = path.join(VELOQRS_SRC_DIR, 'generated', 'veloqrs.ts');

    /** Every function the generated module exports, by name. */
    function generatedFunctions(): Set<string> {
      const source = fs.readFileSync(GENERATED_PATH, 'utf-8');
      const names = new Set<string>();
      for (const m of source.matchAll(/^export (?:async )?function (\w+)/gm)) {
        names.add(m[1]);
      }
      return names;
    }

    // Only standalone exports. A method lives on a generated class and is not a
    // module-level function, so the manifest's own `object` field is what
    // separates the two rather than a guess from the name.
    const standalone = FFI_EXPORTS.filter((exp) => !exp.object);

    it('generates a function for every standalone export in the manifest', () => {
      const generated = generatedFunctions();
      const missing = standalone
        .filter((exp) => !generated.has(exp.camelName))
        .map((exp) => `${exp.camelName} (${exp.file}:${exp.line})`);

      if (missing.length > 0) {
        console.error(
          'In the manifest and absent from the generated bindings. Run `npm run ffi:generate`; ' +
            'if it fails, the export signature is what it refuses:'
        );
        missing.forEach((name) => console.error(`  - ${name}`));
      }

      expect(missing).toEqual([]);
    });

    it('generates no standalone function the manifest does not name', () => {
      const named = new Set(standalone.map((exp) => exp.camelName));
      // The generated module also exports its own helpers and converters, which
      // are not FFI functions. Only names the manifest has ever used are
      // compared, so a deleted export is caught and a helper is not reported.
      const rustNames = new Set(Object.values(RUST_TO_TS_NAME));
      const orphans = [...generatedFunctions()].filter(
        (name) => rustNames.has(name) && !named.has(name)
      );

      expect(orphans).toEqual([]);
    });
  });

  // The manifest carries each export's arity and return type so `npm run
  // ffi:check` can detect signature drift, not just added/removed names.
  describe('Signature manifest', () => {
    it('records arity and return type for every export', () => {
      for (const exp of FFI_EXPORTS) {
        expect(typeof exp.paramCount).toBe('number');
        expect(exp.paramCount).toBeGreaterThanOrEqual(0);
        expect(typeof exp.returnType).toBe('string');
        expect(exp.returnType.length).toBeGreaterThan(0);
      }
    });
  });
});
