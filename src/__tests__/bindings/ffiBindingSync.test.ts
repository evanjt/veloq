/**
 * FFI Binding Sync Validation Tests
 *
 * ARCHITECTURE CHANGE (2026-01-07):
 * Auto-generated Kotlin bindings (route_matcher.kt, ~7082 lines) were removed
 * from git and are now generated at build time. The Kotlin module is now a
 * thin Expo Modules wrapper that imports from uniffi.route_matcher.* package.
 *
 * WHAT THIS TEST VALIDATES:
 * - Swift wrapper file exists (iOS build can fail if missing)
 * - Module file paths are correct
 *
 * WHAT THIS TEST NO LONGER VALIDATES:
 * - Kotlin data class field counts (bindings now generated at build time)
 * - Swift/Kotlin parameter alignment (requires build artifacts)
 *
 * ALTERNATIVE VALIDATION:
 * FFI binding alignment is now validated through:
 * 1. Native build failures (iOS/Android compilation will fail if out of sync)
 * 2. Integration tests that exercise the FFI boundary
 * 3. Manual verification when updating UniFFI scaffolding
 *
 * See commit f2bd3dc: "Remove auto-generated Kotlin bindings from git"
 */

import * as fs from 'fs';
import * as path from 'path';

const SWIFT_MODULE_PATH = path.resolve(
  __dirname,
  '../../../modules/route-matcher-native/ios/RouteMatcherModule.swift'
);

// NOTE: Auto-generated Kotlin bindings are no longer in git (removed 2026-01-07)
// This test now only validates file existence. Build failures will catch FFI mismatches.

describe('FFI Binding Sync', () => {
  describe('Module file existence', () => {
    it('Swift module file should exist', () => {
      expect(fs.existsSync(SWIFT_MODULE_PATH)).toBe(true);
    });

    it('Swift module should be substantial (not empty/stub)', () => {
      const stats = fs.statSync(SWIFT_MODULE_PATH);
      // The Swift wrapper module should be at least 10KB
      expect(stats.size).toBeGreaterThan(10000);
    });
  });

  describe.skip('Kotlin binding validation (deprecated)', () => {
    it('Kotlin bindings are now generated at build time', () => {
      // This test suite is skipped because:
      // 1. Auto-generated bindings (~7082 lines) removed from git in commit f2bd3dc
      // 2. Bindings are now generated during Android build by UniFFI
      // 3. Validation happens through native build failures instead
      //
      // To validate FFI alignment manually:
      // - Build Android: ./gradlew assembleDebug
      // - Build iOS: pod install + native build
      // - If FFI is out of sync, compilation will fail
      expect(true).toBe(true);
    });
  });
});
