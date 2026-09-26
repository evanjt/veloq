/**
 * Scenario: the push device endpoints took an athlete id out of the request
 * body and wrote against it with no authentication at all. Anyone who could
 * reach auth.veloq.fit could unregister another athlete's device, or register
 * their own push token against that athlete's id and receive notifications
 * carrying their activity names and figures.
 *
 * Expected behaviour: the caller proves which athlete it speaks for by handing
 * over the intervals.icu credential it already holds, which is resolved
 * against the API, and the body's athlete id has to be that athlete.
 */

import { authoriseDevice, credentialHeader } from '../../../oauth-proxy/src/deviceAuth';

const OWN = 'i350768';
const OTHER = 'i999999';

/** Stands in for intervals.icu: the credential names its athlete, nothing else does. */
const owner = async (header: string) =>
  header === 'Bearer token-of-own' || header === 'Basic a2V5' ? OWN : null;

describe('reading the credential off a request', () => {
  it('keeps a bearer and a basic credential, which are the two sign-ins the app has', () => {
    expect(credentialHeader('Bearer abc123')).toBe('Bearer abc123');
    expect(credentialHeader('Basic a2V5')).toBe('Basic a2V5');
  });

  it('accepts the scheme in any case, which is what RFC 7235 says', () => {
    expect(credentialHeader('bearer abc123')).toBe('bearer abc123');
  });

  it('trims, so a header with surrounding space is still forwarded', () => {
    expect(credentialHeader('  Bearer abc123  ')).toBe('Bearer abc123');
  });

  it('refuses a header with no scheme, another scheme, or nothing after it', () => {
    expect(credentialHeader('abc123')).toBeNull();
    expect(credentialHeader('Digest abc123')).toBeNull();
    expect(credentialHeader('Bearer ')).toBeNull();
    expect(credentialHeader('Bearer   ')).toBeNull();
    expect(credentialHeader(null)).toBeNull();
  });
});

describe('authorising a device registration', () => {
  it('lets an athlete write against their own id', async () => {
    await expect(authoriseDevice('Bearer token-of-own', OWN, owner)).resolves.toEqual({
      ok: true,
      athleteId: OWN,
    });
  });

  it('lets an athlete signed in with a personal API key write against their own id', async () => {
    await expect(authoriseDevice('Basic a2V5', OWN, owner)).resolves.toEqual({
      ok: true,
      athleteId: OWN,
    });
  });

  it('refuses a token that resolves to a different athlete', async () => {
    const result = await authoriseDevice('Bearer token-of-own', OTHER, owner);
    expect(result).toEqual({ ok: false, status: 403, error: 'Athlete mismatch' });
  });

  it('refuses a request with no Authorization header', async () => {
    const result = await authoriseDevice(null, OWN, owner);
    expect(result).toEqual({ ok: false, status: 401, error: 'Missing credential' });
  });

  it('refuses a credential intervals.icu does not recognise', async () => {
    const result = await authoriseDevice('Bearer forged', OWN, owner);
    expect(result).toEqual({ ok: false, status: 401, error: 'Invalid credential' });
  });

  /// The resolver throws when intervals.icu is unreachable. An outage must not
  /// read as a valid caller.
  it('refuses when the athlete cannot be resolved at all', async () => {
    const unreachable = async () => {
      throw new Error('network down');
    };
    const result = await authoriseDevice('Bearer token-of-own', OWN, unreachable);
    expect(result).toEqual({ ok: false, status: 401, error: 'Invalid credential' });
  });

  it('resolves the token once, not once per field it checks', async () => {
    const spy = jest.fn(owner);
    await authoriseDevice('Bearer token-of-own', OWN, spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('the header the app sends with a device registration', () => {
  const { authorizationHeader } = require('@/features/settings/lib/pushTokenRegistration');

  it('is a bearer for an OAuth sign-in', () => {
    expect(authorizationHeader({ authMethod: 'oauth', accessToken: 'tok', apiKey: null })).toBe(
      'Bearer tok'
    );
  });

  it('is basic API_KEY:<key> for an API-key sign-in, which is what intervals.icu reads', () => {
    const header = authorizationHeader({
      authMethod: 'apiKey',
      accessToken: null,
      apiKey: 'secret',
    });
    expect(header).toBe(`Basic ${Buffer.from('API_KEY:secret').toString('base64')}`);
  });

  it('is nothing when there is no credential to send', () => {
    expect(authorizationHeader({ authMethod: null, accessToken: null, apiKey: null })).toBeNull();
    expect(
      authorizationHeader({ authMethod: 'oauth', accessToken: '  ', apiKey: null })
    ).toBeNull();
  });
});
