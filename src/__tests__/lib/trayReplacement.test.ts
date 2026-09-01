/**
 * Scenario: the background task has an enriched activity notification ready
 * and the tray holds the FCM-posted push plus an older on-device entry.
 *
 * Expected behaviour: the replacement goes up before anything comes down. The
 * task can be killed at any point by an OEM battery policy or an expiring iOS
 * extension budget, and dismissing first left the athlete with an empty tray
 * and no record the activity arrived (`B147`).
 */

import { replaceActivityTrayEntry, type TrayEntry } from '@/features/insights/lib/traySweep';

const ACTIVITY = 'i999';
const TAP = { activityId: ACTIVITY, route: `/activity/${ACTIVITY}` };

function tray(entries: TrayEntry[]) {
  const order: string[] = [];
  const dismissed: string[] = [];
  return {
    order,
    dismissed,
    listPresented: async () => entries,
    dismiss: async (identifier: string) => {
      order.push(`dismiss:${identifier}`);
      dismissed.push(identifier);
    },
    present: async () => {
      order.push('present');
    },
  };
}

const PRESENT: TrayEntry[] = [
  { identifier: 'fcm-generated-id', data: TAP },
  { identifier: `activity-${ACTIVITY}`, data: TAP },
  { identifier: 'sync-progress', data: undefined },
];

describe('replacing the activity tray entry', () => {
  it('posts the replacement before dismissing anything', async () => {
    const t = tray(PRESENT);

    await replaceActivityTrayEntry({ activityId: ACTIVITY, ...t });

    expect(t.order[0]).toBe('present');
    expect(t.order).toContain('dismiss:fcm-generated-id');
  });

  it('leaves the entry the fresh post replaced in place', async () => {
    const t = tray(PRESENT);

    await replaceActivityTrayEntry({ activityId: ACTIVITY, ...t });

    expect(t.dismissed).not.toContain(`activity-${ACTIVITY}`);
  });

  it('leaves the sync banner alone', async () => {
    const t = tray(PRESENT);

    await replaceActivityTrayEntry({ activityId: ACTIVITY, ...t });

    expect(t.dismissed).not.toContain('sync-progress');
  });

  /// A killed task between the two steps is the case this ordering exists for.
  it('dismisses nothing when the post fails, so the tray keeps what it had', async () => {
    const t = tray(PRESENT);

    const posted = await replaceActivityTrayEntry({
      activityId: ACTIVITY,
      ...t,
      present: async () => {
        throw new Error('notification budget exhausted');
      },
    });

    expect(posted).toBe(false);
    expect(t.dismissed).toEqual([]);
  });

  it('clears this activity when there is nothing to post, and only this activity', async () => {
    const t = tray([...PRESENT, { identifier: 'insight-1', data: { sectionId: 'sec_1' } }]);

    const posted = await replaceActivityTrayEntry({ activityId: ACTIVITY, ...t, present: null });

    expect(posted).toBe(false);
    expect(t.dismissed.sort()).toEqual([`activity-${ACTIVITY}`, 'fcm-generated-id']);
  });

  it('still posts when the tray cannot be read', async () => {
    const t = tray(PRESENT);

    const posted = await replaceActivityTrayEntry({
      activityId: ACTIVITY,
      ...t,
      listPresented: async () => {
        throw new Error('no permission');
      },
    });

    expect(posted).toBe(true);
    expect(t.order).toEqual(['present']);
  });

  it('does not let one failed dismiss stop the rest', async () => {
    const t = tray([
      { identifier: 'fcm-one', data: TAP },
      { identifier: 'fcm-two', data: TAP },
    ]);

    await replaceActivityTrayEntry({
      activityId: ACTIVITY,
      ...t,
      present: null,
      dismiss: async (identifier: string) => {
        if (identifier === 'fcm-one') throw new Error('gone already');
        t.dismissed.push(identifier);
      },
    });

    expect(t.dismissed).toEqual(['fcm-two']);
  });
});
