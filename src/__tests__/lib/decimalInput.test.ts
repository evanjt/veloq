import { parseDecimalInput } from '@/shared/format/decimalInput';

describe('a typed decimal', () => {
  it('reads a comma or a point as the decimal separator', () => {
    expect(parseDecimalInput('10,5')).toBe(10.5);
    expect(parseDecimalInput('10.5')).toBe(10.5);
    expect(parseDecimalInput(' 42 ')).toBe(42);
    expect(parseDecimalInput(',5')).toBe(0.5);
  });

  it('reads a trailing separator as the whole number before it', () => {
    expect(parseDecimalInput('5,')).toBe(5);
    expect(parseDecimalInput('5.')).toBe(5);
  });

  it('keeps the sign, leaving the range to the caller', () => {
    expect(parseDecimalInput('-5')).toBe(-5);
    expect(parseDecimalInput('0')).toBe(0);
  });

  it('is null when nothing was typed', () => {
    expect(parseDecimalInput('')).toBeNull();
    expect(parseDecimalInput('   ')).toBeNull();
    expect(parseDecimalInput(',')).toBeNull();
  });

  it('is null rather than a truncated number when the text is not one number', () => {
    for (const text of [
      '10abc',
      '10,5,1',
      '10.5.1',
      '1,234.5',
      '1.234,5',
      '10 5',
      'abc',
      'NaN',
      'Infinity',
      '1e3',
      '0x10',
    ]) {
      expect(parseDecimalInput(text)).toBeNull();
    }
  });
});
