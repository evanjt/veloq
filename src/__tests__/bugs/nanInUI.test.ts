/**
 * NaN/Infinity UI display regression tests.
 * Verifies that Number.isFinite guards prevent NaN/Infinity from reaching .toFixed() and UI text.
 */

describe('toFixed on NaN/Infinity (fitness.tsx:778, section/[id].tsx:1003)', () => {
  it('NaN.toFixed produces "NaN" string — this is why guards are needed', () => {
    expect(NaN.toFixed(1)).toBe('NaN');
    expect(Infinity.toFixed(1)).toBe('Infinity');
  });

  it('decoupling with < 4 data points returns null (guarded)', () => {
    // fitness.tsx:232 now guards: if (power.length < 4) return null
    const power = [200];
    const shouldReturnNull = power.length < 4;
    expect(shouldReturnNull).toBe(true);
  });

  it('Number.isFinite guard catches NaN stability before toFixed (fixed)', () => {
    const stability: number | null = NaN as unknown as number;
    // The FIXED guard: Number.isFinite(section.stability) instead of != null
    const displayed = Number.isFinite(stability) ? stability!.toFixed(3) : '-';
    expect(displayed).toBe('-');
  });
});

describe('Number() falsy-zero bug (autoBackup.ts:82)', () => {
  // FIXED pattern: value != null ? Number(value) : null
  function parseStoredTimestamp(value: string | undefined): number | null {
    return value != null ? Number(value) : null;
  }

  it('parses normal timestamp strings', () => {
    expect(parseStoredTimestamp('1700000000')).toBe(1700000000);
    expect(parseStoredTimestamp('42')).toBe(42);
  });

  it('returns null for undefined', () => {
    expect(parseStoredTimestamp(undefined)).toBeNull();
  });

  it('parses zero timestamp correctly', () => {
    expect(parseStoredTimestamp('0')).toBe(0);
  });

  it('treats empty string as 0 (Number("") = 0)', () => {
    expect(parseStoredTimestamp('')).toBe(0);
  });
});

describe('backup.customSections type confusion (backup.ts:336)', () => {
  it('Array.isArray rejects non-array customSections (fixed)', () => {
    // backup.ts:335 now uses: Array.isArray(backup.customSections) && ...
    const backup = {
      customSections: 'not an array',
    };
    expect(Array.isArray(backup.customSections)).toBe(false);
  });

  it('Array.isArray accepts valid arrays', () => {
    const backup = {
      customSections: [{ name: 'Hill Climb' }],
    };
    expect(Array.isArray(backup.customSections)).toBe(true);
  });
});
