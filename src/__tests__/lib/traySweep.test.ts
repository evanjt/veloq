/**
 * Scenario: the background task has enriched an activity notification and
 * sweeps the tray so the placeholder and the FCM-posted push do not sit beside
 * the entry that replaces them.
 *
 * Expected behaviour: it dismisses what it is replacing and leaves everything
 * else alone. Matching the FCM push by what it lacks swept the sticky sync
 * banner and every insight routed by section or route, because none of them
 * carry an `activityId` either (`B145`).
 */

import { shouldDismissForActivity } from '@/features/insights/lib/traySweep';

const ACTIVITY = 'i999';
const TAP = { activityId: ACTIVITY, route: `/activity/${ACTIVITY}`, activity_id: ACTIVITY };

describe('the tray sweep', () => {
  it('dismisses the on-device entry it is replacing', () => {
    expect(shouldDismissForActivity(`activity-${ACTIVITY}`, TAP, ACTIVITY)).toBe(true);
  });

  it('dismisses the FCM push for this activity, however it is wrapped', () => {
    for (const data of [
      TAP,
      { dataString: JSON.stringify(TAP) },
      { body: JSON.stringify(TAP) },
      { data: TAP },
    ]) {
      expect(shouldDismissForActivity('fcm-generated-id', data, ACTIVITY)).toBe(true);
    }
  });

  it('leaves the sync progress banner up', () => {
    expect(shouldDismissForActivity('sync-progress', undefined, ACTIVITY)).toBe(false);
  });

  it('leaves an insight routed by section alone', () => {
    expect(shouldDismissForActivity('insight-1', { sectionId: 'sec_1' }, ACTIVITY)).toBe(false);
  });

  it('leaves an insight routed only by a route alone', () => {
    expect(shouldDismissForActivity('insight-2', { route: '/insights' }, ACTIVITY)).toBe(false);
  });

  it('leaves another activity alone, by identifier and by payload', () => {
    expect(shouldDismissForActivity('activity-i111', { activityId: 'i111' }, ACTIVITY)).toBe(false);
    expect(shouldDismissForActivity('fcm-generated-id', { activityId: 'i111' }, ACTIVITY)).toBe(
      false
    );
  });

  it('leaves an entry it cannot read alone rather than guessing', () => {
    expect(shouldDismissForActivity('unknown', undefined, ACTIVITY)).toBe(false);
    expect(shouldDismissForActivity('unknown', {}, ACTIVITY)).toBe(false);
    expect(shouldDismissForActivity('unknown', { title: 'hello' }, ACTIVITY)).toBe(false);
  });
});
