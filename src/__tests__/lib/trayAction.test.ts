/**
 * Scenario: the background task has finished and has to decide what to do with
 * the tray. There are three outcomes and they were two, which is how a failed
 * ingest reposted a notification whose body was its own title over a generic
 * entry that was already correct.
 *
 * An empty body now means two different things and the tray does the opposite
 * in each. An ingest that failed knows nothing, so the generic entry it would
 * replace is the best thing standing and it stays. An ingest that worked and
 * found nothing worth announcing has to take that generic entry down, or
 * dropping the floor rung leaves the athlete with "Activity Recorded" for good.
 */

import { trayActionFor } from '@/features/insights/lib/traySweep';

describe('what the task does with the tray', () => {
  it('posts the enriched entry when it has something to say', () => {
    expect(trayActionFor('Route PR on Lake Loop', false, true)).toBe('post');
  });

  it('clears the old entries without posting when the app is already open', () => {
    expect(trayActionFor('Route PR on Lake Loop', true, true)).toBe('dismiss-only');
  });

  /// The generic entry already up is the best thing known, so it stays.
  it('leaves the tray alone when the ingest failed and it knows nothing', () => {
    expect(trayActionFor('', false, false)).toBe('leave');
    expect(trayActionFor('   ', false, false)).toBe('leave');
  });

  it('leaves the tray alone after a failed ingest even in the foreground', () => {
    expect(trayActionFor('', true, false)).toBe('leave');
  });

  it('takes the generic entry down when the ride was read and was unremarkable', () => {
    expect(trayActionFor('', false, true)).toBe('dismiss-only');
    expect(trayActionFor('   ', true, true)).toBe('dismiss-only');
  });
});
