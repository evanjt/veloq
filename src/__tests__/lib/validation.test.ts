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

  it('returns fallback for undefined input', () => {
    const fallback = { default: true };
    const result = safeJsonParse(undefined, fallback);
    expect(result).toEqual(fallback);
  });

  it('returns fallback for empty string', () => {
    const fallback = { default: true };
    const result = safeJsonParse('', fallback);
    expect(result).toEqual(fallback);
  });

  it('returns fallback when parsed value is null', () => {
    const fallback = { default: true };
    const result = safeJsonParse('null', fallback);
    expect(result).toEqual(fallback);
  });

  it('handles arrays', () => {
    const result = safeJsonParse<number[]>('[1,2,3]', []);
    expect(result).toEqual([1, 2, 3]);
  });

  it('handles primitives', () => {
    expect(safeJsonParse('"hello"', '')).toBe('hello');
    expect(safeJsonParse('42', 0)).toBe(42);
    expect(safeJsonParse('true', false)).toBe(true);
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

  it('returns fallback for missing required fields', () => {
    const json = '{"name":"test"}';
    const result = safeJsonParseWithSchema(json, isTestData, fallback);
    expect(result).toEqual(fallback);
  });

  it('returns fallback for null input', () => {
    const result = safeJsonParseWithSchema(null, isTestData, fallback);
    expect(result).toEqual(fallback);
  });

  it('returns fallback for invalid JSON', () => {
    const result = safeJsonParseWithSchema('invalid', isTestData, fallback);
    expect(result).toEqual(fallback);
  });

  it('handles arrays with element validation', () => {
    type NumberArray = number[];
    const isNumberArray: SchemaValidator<NumberArray> = (value): value is NumberArray => {
      if (!Array.isArray(value)) return false;
      return value.every((v) => typeof v === 'number');
    };

    const result = safeJsonParseWithSchema('[1,2,3]', isNumberArray, []);
    expect(result).toEqual([1, 2, 3]);

    const invalidResult = safeJsonParseWithSchema('[1,"two",3]', isNumberArray, []);
    expect(invalidResult).toEqual([]);
  });

  it('handles nested objects', () => {
    interface NestedData {
      outer: {
        inner: string;
      };
    }

    const isNestedData: SchemaValidator<NestedData> = (value): value is NestedData => {
      if (typeof value !== 'object' || value === null) return false;
      const obj = value as Record<string, unknown>;
      if (typeof obj.outer !== 'object' || obj.outer === null) return false;
      const outer = obj.outer as Record<string, unknown>;
      return typeof outer.inner === 'string';
    };

    const fallbackNested: NestedData = { outer: { inner: '' } };

    const validResult = safeJsonParseWithSchema(
      '{"outer":{"inner":"hello"}}',
      isNestedData,
      fallbackNested
    );
    expect(validResult).toEqual({ outer: { inner: 'hello' } });

    const invalidResult = safeJsonParseWithSchema(
      '{"outer":{"inner":123}}',
      isNestedData,
      fallbackNested
    );
    expect(invalidResult).toEqual(fallbackNested);
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
