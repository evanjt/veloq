import { errorMessage } from '@/shared/format/errorMessage';

describe('errorMessage', () => {
  it('reads the message of an Error', () => {
    expect(errorMessage(new Error('disk full'))).toBe('disk full');
  });

  it('stringifies anything else', () => {
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});
