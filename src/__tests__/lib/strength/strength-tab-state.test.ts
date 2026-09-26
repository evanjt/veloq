/**
 * Scenario: an athlete who trains with weights installs the app and has not
 * been online since. No FIT has been fetched, so no set is cached, so the
 * Strength tab is not pushed at all and there is no surface to retry from.
 *
 * Expected behaviour: activities the engine knows are strength and has not
 * fetched are enough for the tab, which then says what it is waiting for
 * rather than that no strength workout exists.
 */
import { strengthTabState } from '@/features/strength/lib/strengthTabState';

describe('strengthTabState', () => {
  it('is ready when sets are cached', () => {
    expect(strengthTabState({ hasSets: true, unfetchedCount: 0 })).toBe('ready');
  });

  it('stays ready when sets are cached and more are still coming', () => {
    expect(strengthTabState({ hasSets: true, unfetchedCount: 4 })).toBe('ready');
  });

  it('waits when nothing is cached but the engine knows of strength activities', () => {
    expect(strengthTabState({ hasSets: false, unfetchedCount: 1 })).toBe('awaiting');
  });

  it('is hidden when the athlete has no strength activities at all', () => {
    expect(strengthTabState({ hasSets: false, unfetchedCount: 0 })).toBe('hidden');
  });
});
