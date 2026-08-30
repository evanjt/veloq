import {
  safeJsonParse,
  safeJsonParseWithSchema,
  type SchemaValidator,
} from '@/shared/validation/validation';

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    const result = safeJsonParse('{"a":1,"b":"two"}', {});
    expect(result).toEqual({ a: 1, b: 'two' });
  });

  it('returns fallback for invalid JSON, null input, or parsed-null', () => {
    const fallback = { default: true };
    expect(safeJsonParse('not valid json', fallback)).toEqual(fallback);
    expect(safeJsonParse(null, fallback)).toEqual(fallback);
    expect(safeJsonParse('null', fallback)).toEqual(fallback);
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

  it('returns fallback for schema failure or null input', () => {
    expect(
      safeJsonParseWithSchema('{"name":"test","value":"not a number"}', isTestData, fallback)
    ).toEqual(fallback);
    expect(safeJsonParseWithSchema(null, isTestData, fallback)).toEqual(fallback);
  });
});
