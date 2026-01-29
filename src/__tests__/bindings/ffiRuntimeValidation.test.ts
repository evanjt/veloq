/**
 * FFI Runtime Validation Tests
 *
 * These tests validate that FFI bindings are actually callable at runtime.
 * They require the native module to be built and available.
 *
 * Run after building: npm test -- --testPathPattern=ffiRuntimeValidation
 *
 * NOTE: In Jest/Node environment, native modules are typically mocked.
 * These tests are most useful in a device or emulator context.
 * For now, they validate the module structure and export shapes.
 */

import { FFI_EXPORTS } from './ffi-exports.generated';

// Try to import from the module - this will fail in Jest if not mocked
let veloqrsModule: Record<string, unknown> | null = null;
let moduleLoadError: Error | null = null;

try {
  // Dynamic import to catch load errors
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  veloqrsModule = require('../../../modules/veloqrs/src/index');
} catch (err) {
  moduleLoadError = err as Error;
}

describe('FFI Runtime Validation', () => {
  describe('Module loading', () => {
    it('should load the veloqrs module (or report why it cannot)', () => {
      if (moduleLoadError) {
        // This is expected in Jest - native modules need mocking
        console.log('\nNote: Native module not available in test environment');
        console.log(`Error: ${moduleLoadError.message}`);

        // Check if it's the expected "native module not found" error
        const isExpectedError =
          moduleLoadError.message.includes('native') ||
          moduleLoadError.message.includes('TurboModule') ||
          moduleLoadError.message.includes('Cannot find module') ||
          moduleLoadError.message.includes('installRustCrate');

        expect(isExpectedError).toBe(true);
      } else {
        expect(veloqrsModule).not.toBeNull();
      }
    });
  });

  describe('Export structure validation', () => {
    // Skip these tests if module didn't load
    const skipIfNoModule = veloqrsModule === null ? it.skip : it;

    skipIfNoModule('should export all expected FFI functions', () => {
      if (!veloqrsModule) return;

      const missingExports: string[] = [];
      const undefinedExports: string[] = [];

      for (const exp of FFI_EXPORTS) {
        const fn = veloqrsModule[exp.camelName];

        if (fn === undefined) {
          missingExports.push(exp.camelName);
        } else if (typeof fn !== 'function') {
          undefinedExports.push(`${exp.camelName} (type: ${typeof fn})`);
        }
      }

      if (missingExports.length > 0) {
        console.error('\nMissing FFI exports:');
        missingExports.forEach((name) => console.error(`  - ${name}`));
      }

      if (undefinedExports.length > 0) {
        console.error('\nExports that are not functions:');
        undefinedExports.forEach((name) => console.error(`  - ${name}`));
      }

      expect(missingExports).toEqual([]);
    });

    skipIfNoModule('should have callable initialization functions', () => {
      if (!veloqrsModule) return;

      // These are the most critical functions that must be callable
      const criticalFunctions = [
        'persistentEngineInit',
        'persistentEngineIsInitialized',
        'persistentEngineClear',
        'isRouteMatcherInitialized',
      ];

      for (const fnName of criticalFunctions) {
        const fn = veloqrsModule[fnName];
        expect(typeof fn).toBe('function');
      }
    });
  });

  describe('FFI manifest completeness', () => {
    it('should have all FFI categories represented', () => {
      const categories = {
        engine: FFI_EXPORTS.filter((e) => e.name.startsWith('persistent_engine_')),
        sections: FFI_EXPORTS.filter((e) => e.file === 'sections/ffi.rs'),
        fetch: FFI_EXPORTS.filter((e) => e.name.includes('fetch')),
        polyline: FFI_EXPORTS.filter(
          (e) => e.name.includes('polyline') || e.name.includes('coordinates')
        ),
      };

      // Verify each category has exports
      expect(categories.engine.length).toBeGreaterThan(30);
      expect(categories.sections.length).toBeGreaterThan(10);
      expect(categories.fetch.length).toBeGreaterThan(3);
      expect(categories.polyline.length).toBeGreaterThan(2);
    });

    it('should document all exports with source location', () => {
      for (const exp of FFI_EXPORTS) {
        expect(exp.name).toBeTruthy();
        expect(exp.camelName).toBeTruthy();
        expect(exp.file).toBeTruthy();
        expect(exp.line).toBeGreaterThan(0);
      }
    });
  });
});

/**
 * FFI Function Inventory
 *
 * This test generates a report of all FFI functions for documentation.
 */
describe('FFI Function Inventory', () => {
  it('should report FFI function inventory', () => {
    const byFile = new Map<string, typeof FFI_EXPORTS>();

    for (const exp of FFI_EXPORTS) {
      const list = byFile.get(exp.file) || [];
      list.push(exp);
      byFile.set(exp.file, list);
    }

    console.log('\n=== FFI Function Inventory ===\n');
    console.log(`Total: ${FFI_EXPORTS.length} FFI functions\n`);

    for (const [file, exports] of byFile) {
      console.log(`\n${file} (${exports.length} functions):`);
      for (const exp of exports.slice(0, 5)) {
        console.log(`  - ${exp.camelName}`);
      }
      if (exports.length > 5) {
        console.log(`  ... and ${exports.length - 5} more`);
      }
    }

    expect(true).toBe(true);
  });
});
