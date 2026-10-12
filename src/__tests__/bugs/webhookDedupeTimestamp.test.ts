/**
 * Scenario: wellness, fitness and sport-settings events carry no activity, so
 * a key built from athlete, type and activity alone is the same for every such
 * event in the dedupe window. A weight entry at 07:00 and an HRV entry at
 * 07:03 then read as one event delivered twice, and the second sends no push.
 *
 * Expected behaviour: the event timestamp is part of the key, so two distinct
 * events differ while a re-delivery of one event still matches itself.
 */

import { dedupeKey } from '../../../oauth-proxy/src/keys';

describe('the webhook dedupe key', () => {
  it('separates two events of one type with no activity', () => {
    const weight = dedupeKey('i123', 'WELLNESS_UPDATED', undefined, '2026-10-10T07:00:00Z');
    const hrv = dedupeKey('i123', 'WELLNESS_UPDATED', undefined, '2026-10-10T07:03:00Z');
    expect(weight).not.toBe(hrv);
  });

  it('separates two analyses of one activity', () => {
    const first = dedupeKey('i123', 'ACTIVITY_ANALYZED', '9001', '2026-10-10T07:00:00Z');
    const second = dedupeKey('i123', 'ACTIVITY_ANALYZED', '9001', '2026-10-10T07:02:00Z');
    expect(first).not.toBe(second);
  });

  it('matches a re-delivery of the same event', () => {
    const delivered = dedupeKey('i123', 'ACTIVITY_UPLOADED', '9001', '2026-10-10T07:00:00Z');
    const redelivered = dedupeKey('i123', 'ACTIVITY_UPLOADED', '9001', '2026-10-10T07:00:00Z');
    expect(redelivered).toBe(delivered);
  });

  it('stays stable when the event has no timestamp', () => {
    const once = dedupeKey('i123', 'FITNESS_UPDATED', undefined, undefined);
    const twice = dedupeKey('i123', 'FITNESS_UPDATED', undefined, undefined);
    expect(once).toBe(twice);
    expect(once).toBe('dedup:i123:FITNESS_UPDATED:none:none');
  });
});
