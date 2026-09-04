/**
 * Scenario: `npm run ffi:unused` is how an unreachable FFI export is meant to
 * be found. It printed "0 functions are exported from Rust but not used",
 * which reads as a clean bill of health and was really a parse that matched
 * nothing: the manifest is Prettier-formatted to single quotes and the regex
 * looked for double.
 *
 * Expected behaviour: the report reads every export the manifest declares, and
 * counts a caller only where a caller would actually be, so a zero is a
 * finding rather than the default.
 */

import { FFI_EXPORTS } from '../bindings/ffi-exports.generated';
import {
  OWNED_ELSEWHERE,
  exportedNames,
  isCallerFile,
  isDelegateFile,
  reachOf,
} from '../../../scripts/lib/ffiUsage';

describe('the FFI usage report', () => {
  it('reads every export the manifest declares', () => {
    expect(exportedNames()).toHaveLength(FFI_EXPORTS.length);
    expect(exportedNames().length).toBeGreaterThan(200);
  });

  it('reads the names themselves, not a subset that happened to match', () => {
    expect(exportedNames()).toEqual(FFI_EXPORTS.map((e) => e.camelName));
  });

  describe('what counts as a caller', () => {
    it.each([
      'src/features/routes/hooks/useSectionRescan.ts',
      'src/app/(tabs)/index.tsx',
      'src/shared/native/engine.ts',
    ])('counts %s', (file) => {
      expect(isCallerFile(file)).toBe(true);
    });

    it.each([
      // The delegate layer forwards every export by name, so counting it
      // scores a delegated-and-never-called export as used. That is the
      // second reason this report under-reported.
      'modules/veloqrs/src/delegates/routes.ts',
      'modules/veloqrs/src/generated/veloqrs.ts',
      'src/__tests__/bindings/ffi-exports.generated.ts',
      'src/__tests__/hooks/useSectionRescan.test.ts',
    ])('does not count %s', (file) => {
      expect(isCallerFile(file)).toBe(false);
    });

    it('tells the delegate layer apart from the rest', () => {
      expect(isDelegateFile('modules/veloqrs/src/delegates/routes.ts')).toBe(true);
      expect(isDelegateFile('modules/veloqrs/src/generated/veloqrs.ts')).toBe(false);
      expect(isDelegateFile('src/features/routes/hooks/useSectionRescan.ts')).toBe(false);
    });
  });

  describe('how far an export reaches', () => {
    it('is called when the app names it', () => {
      expect(reachOf(3, 1)).toBe('called');
    });

    it('is delegated when only the forwarding layer names it', () => {
      // Not the same as used: the delegate renames as it forwards, so this is
      // an export whose screen, if it has one, calls it by another name.
      expect(reachOf(0, 2)).toBe('delegated');
    });

    it('is unreachable when nothing names it at all', () => {
      expect(reachOf(0, 0)).toBe('unreachable');
    });
  });

  it('allowlists only exports that still exist, so the list cannot rot', () => {
    const declared = new Set(FFI_EXPORTS.map((e) => e.camelName));
    for (const name of Object.keys(OWNED_ELSEWHERE)) {
      expect(declared.has(name)).toBe(true);
    }
  });

  it('names a reason for every allowlisted export', () => {
    expect(Object.keys(OWNED_ELSEWHERE).length).toBeGreaterThan(0);
    for (const reason of Object.values(OWNED_ELSEWHERE)) {
      expect(reason).toMatch(/\S/);
    }
  });
});
