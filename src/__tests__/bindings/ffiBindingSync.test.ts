/**
 * FFI Binding Sync Validation Tests
 *
 * Validates that the TypeScript spec file exists for the native module.
 *
 * iOS/Android bindings are auto-generated at build time by uniffi-bindgen-react-native,
 * so binding alignment is validated by native compilation (build fails if out of sync).
 */

import * as fs from 'fs';
import * as path from 'path';

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
});
