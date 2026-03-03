import {
  safeJsonParse,
  safeJsonParseWithSchema,
  isValidRecord,
  type SchemaValidator,
} from '@/lib/utils/validation';

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    const result = safeJsonParse('{"a":1,"b":"two"}', {});
    expect(result).toEqual({ a: 1, b: 'two' });
  });

  it('returns fallback for invalid JSON', () => {
    const fallback = { default: true };
    const result = safeJsonParse('not valid json', fallback);
    expect(result).toEqual(fallback);
  });

  it('returns fallback for null input', () => {
    const fallback = { default: true };
    const result = safeJsonParse(null, fallback);
    expect(result).toEqual(fallback);
  });

  it('returns fallback when parsed value is null', () => {
    const fallback = { default: true };
    const result = safeJsonParse('null', fallback);
    expect(result).toEqual(fallback);
  });
});

describe('safeJsonParseWithSchema', () => {
  interface TestData {
    name: string;
    value: number;
  }

  const isTestData: SchemaValidator<TestData> = (value): value is TestData => {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.name === 'string' && typeof obj.value === 'number';
  };

  const fallback: TestData = { name: 'default', value: 0 };

  it('parses and validates correct data', () => {
    const json = '{"name":"test","value":42}';
    const result = safeJsonParseWithSchema(json, isTestData, fallback);
    expect(result).toEqual({ name: 'test', value: 42 });
  });

  it('returns fallback for invalid schema', () => {
    const json = '{"name":"test","value":"not a number"}';
    const result = safeJsonParseWithSchema(json, isTestData, fallback);
    expect(result).toEqual(fallback);
  });

  it('returns fallback for null input', () => {
    const result = safeJsonParseWithSchema(null, isTestData, fallback);
    expect(result).toEqual(fallback);
  });
});

describe('isValidRecord', () => {
  it('validates correct records', () => {
    const validKeys = new Set(['a', 'b', 'c']);
    const validValues = new Set([1, 2, 3]);

    const result = isValidRecord({ a: 1, b: 2 }, validKeys, validValues);
    expect(result).toBe(true);
  });

  it('rejects invalid keys', () => {
    const validKeys = new Set(['a', 'b']);
    const validValues = new Set([1, 2, 3]);

    const result = isValidRecord({ a: 1, invalidKey: 2 }, validKeys, validValues);
    expect(result).toBe(false);
  });

  it('rejects invalid values', () => {
    const validKeys = new Set(['a', 'b']);
    const validValues = new Set([1, 2]);

    const result = isValidRecord({ a: 1, b: 999 }, validKeys, validValues);
    expect(result).toBe(false);
  });

  it('rejects non-objects', () => {
    const validKeys = new Set(['a']);
    const validValues = new Set([1]);

    expect(isValidRecord(null, validKeys, validValues)).toBe(false);
    expect(isValidRecord(undefined, validKeys, validValues)).toBe(false);
    expect(isValidRecord('string', validKeys, validValues)).toBe(false);
    expect(isValidRecord(123, validKeys, validValues)).toBe(false);
    expect(isValidRecord([], validKeys, validValues)).toBe(true); // Empty array is an object
  });

  it('accepts empty records', () => {
    const validKeys = new Set(['a', 'b']);
    const validValues = new Set([1, 2]);

    const result = isValidRecord({}, validKeys, validValues);
    expect(result).toBe(true);
  });
});
