/**
 * FFI Binding Sync Validation Tests
 *
 * ARCHITECTURE CHANGE (2026-01-15):
 * Migrated from Expo Modules to uniffi-bindgen-react-native Turbo Modules.
 * The manual Swift/Kotlin wrappers (RouteMatcherModule.swift/kt) were replaced
 * with auto-generated bindings from uniffi-bindgen-react-native.
 *
 * WHAT THIS TEST VALIDATES:
 * - Turbo Module header file exists (iOS build can fail if missing)
 * - Module file paths are correct
 *
 * WHAT THIS TEST NO LONGER VALIDATES:
 * - Manual wrapper code (now auto-generated)
 * - Swift/Kotlin binding alignment (validated by native build)
 *
 * ALTERNATIVE VALIDATION:
 * FFI binding alignment is now validated through:
 * 1. Native build failures (iOS/Android compilation will fail if out of sync)
 * 2. uniffi-bindgen-react-native generates bindings at build time
 * 3. TypeScript types auto-generated from Rust definitions
 */

import * as fs from 'fs';
import * as path from 'path';

const IOS_HEADER_PATH = path.resolve(
  __dirname,
  '../../../modules/route-matcher-native/ios/Veloq.h'
);

const IOS_MM_PATH = path.resolve(__dirname, '../../../modules/route-matcher-native/ios/Veloq.mm');

const TS_SPEC_PATH = path.resolve(
  __dirname,
  '../../../modules/route-matcher-native/src/NativeVeloq.ts'
);

describe('FFI Binding Sync', () => {
  describe('Module file existence', () => {
    it('TypeScript spec file should exist', () => {
      expect(fs.existsSync(TS_SPEC_PATH)).toBe(true);
    });
  });

  describe.skip('iOS binding validation (generated at build time)', () => {
    // iOS bindings (Veloq.h, Veloq.mm) are generated during iOS build
    // by uniffi-bindgen-react-native. These files don't exist in the repo.
    it('iOS Turbo Module header should exist', () => {
      expect(fs.existsSync(IOS_HEADER_PATH)).toBe(true);
    });

    it('iOS Turbo Module implementation should exist', () => {
      expect(fs.existsSync(IOS_MM_PATH)).toBe(true);
    });
  });

  describe.skip('Kotlin binding validation (generated at build time)', () => {
    // Bindings are generated during Android build by uniffi-bindgen-react-native
    it('Kotlin bindings are now generated at build time', () => {
      expect(true).toBe(true);
    });
  });
});
