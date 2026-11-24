import { engineErrorText } from '@/shared/native/engineError';

describe('engineErrorText', () => {
  it('names an engine failure by its tag', () => {
    expect(engineErrorText({ tag: 'Busy' })).toBe('Busy');
  });

  it('falls back to the string form of an error the engine did not tag', () => {
    expect(engineErrorText(new Error('deadline passed'))).toBe('Error: deadline passed');
    expect(engineErrorText('plain text')).toBe('plain text');
  });

  it('does not read a tag the engine does not list', () => {
    expect(engineErrorText({ tag: 'Unlisted' })).toBe('[object Object]');
  });
});
