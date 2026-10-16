/**
 * Scenario: a restore fails in the engine, the converter, the file system or
 * this side's own checks, and each of those throws its own English.
 *
 * Expected behaviour: every failure is named by one refusal word, so the alert
 * and the backup row word it in the athlete's language and no thrown message
 * reaches either.
 */

import { RestoreRefusedError, restoreRefusal } from '@/features/settings/lib/restoreRefusal';

function engineError(tag: string, message: string): Error {
  return Object.assign(new Error(message), { tag, inner: { msg: message } });
}

describe('naming a restore refusal', () => {
  it('keeps the refusal a typed throw carries', () => {
    expect(restoreRefusal(new RestoreRefusedError('missing'))).toBe('missing');
    expect(restoreRefusal(new RestoreRefusedError('unavailable'))).toBe('unavailable');
    expect(restoreRefusal(new RestoreRefusedError('signInRequired'))).toBe('signInRequired');
  });

  it("names the engine's account refusal, whichever variant carries it", () => {
    expect(restoreRefusal(engineError('Database', 'Record belongs to another athlete'))).toBe(
      'differentAccount'
    );
    expect(restoreRefusal(new Error('Record belongs to another athlete'))).toBe('differentAccount');
  });

  it("names the engine's signed-out refusal and a closed engine as a sign-in", () => {
    expect(restoreRefusal(engineError('NotFound', 'Sign in before importing a backup'))).toBe(
      'signInRequired'
    );
    expect(restoreRefusal(engineError('NotInitialized', 'Engine not initialised'))).toBe(
      'signInRequired'
    );
  });

  it('names anything else a failed import rather than passing its message on', () => {
    expect(restoreRefusal(engineError('Database', 'disk I/O error'))).toBe('failed');
    expect(restoreRefusal(new Error('Corrupt backup: invalid decisions'))).toBe('failed');
    expect(restoreRefusal(new Error('Invalid backup file format'))).toBe('failed');
    expect(restoreRefusal('nope')).toBe('failed');
    expect(restoreRefusal(undefined)).toBe('failed');
  });
});
