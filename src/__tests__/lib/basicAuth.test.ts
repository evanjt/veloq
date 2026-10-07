/**
 * Scenario: a Basic credential whose password holds accented or non-Latin-1 text.
 * Expected behaviour: the header carries the base64 of the UTF-8 bytes (RFC 7617)
 * and never throws.
 */

import { basicAuthHeader } from '@/shared/net/basicAuth';

const expected = (s: string) => `Basic ${Buffer.from(s, 'utf8').toString('base64')}`;

describe('basicAuthHeader', () => {
  it.each([
    ['ascii', 'u', 'secret1'],
    ['latin-1', 'u', 'pä55'],
    ['non-latin-1', 'u', 'pałac'],
    ['astral', 'u', 'pw😀x'],
    ['empty password', 'u', ''],
  ])('encodes %s as UTF-8', (_n, user, pass) => {
    expect(basicAuthHeader(user, pass)).toBe(expected(`${user}:${pass}`));
  });

  it('sends the two UTF-8 bytes for a Latin-1 letter', () => {
    const b64 = basicAuthHeader('u', 'pä55').replace('Basic ', '');
    expect([...Buffer.from(b64, 'base64')]).toEqual([...Buffer.from('u:pä55', 'utf8')]);
    expect(Buffer.from(b64, 'base64').includes(0xc3)).toBe(true);
  });

  it('replaces a lone surrogate instead of throwing', () => {
    expect(basicAuthHeader('u', 'a\ud800b')).toBe(expected('u:a�b'));
  });
});
