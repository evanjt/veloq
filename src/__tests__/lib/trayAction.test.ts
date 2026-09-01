/**
 * Scenario: the background task has finished and has to decide what to do with
 * the tray. There are three outcomes and they were two, which is how a failed
 * ingest reposted a notification whose body was its own title over a generic
 * entry that was already correct (`B149`).
 */

import { trayActionFor } from '@/features/insights/lib/traySweep';

describe('what the task does with the tray', () => {
  it('posts the enriched entry when it has something to say', () => {
    expect(trayActionFor('Route PR on Lake Loop', false)).toBe('post');
  });

  it('clears the old entries without posting when the app is already open', () => {
    expect(trayActionFor('Route PR on Lake Loop', true)).toBe('dismiss-only');
  });

  /// The generic entry already up is the right notification, so it stays.
  it('leaves the tray alone when there is nothing to say', () => {
    expect(trayActionFor('', false)).toBe('leave');
    expect(trayActionFor('   ', false)).toBe('leave');
  });

  it('leaves the tray alone with nothing to say even in the foreground', () => {
    expect(trayActionFor('', true)).toBe('leave');
  });
});
