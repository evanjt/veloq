/**
 * Scenario: the engine announces a Garmin ride the phone pulled itself as an
 * owed post-ride notification on `bodyStored`.
 *
 * Expected behaviour: the entry is posted once with the engine's own text; a
 * repeat announcement, another kind of body, an unreadable entry and an empty
 * one post nothing.
 */

import { createPulledRidePoster } from '@/features/insights/lib/pulledRideNotification';

function setup(entry: { title: string; body: string } | null = { title: 'Ride', body: 'A PR' }) {
  const present = jest.fn(async (_id: string, _title: string, _body: string) => undefined);
  const readEntry = jest.fn((_id: string) => entry);
  return { present, readEntry, post: createPulledRidePoster({ readEntry, present }) };
}

const owed = { kind: 'ride_notification', activityId: 'src-garmin-7001' };

describe('the pulled ride notification poster', () => {
  it('posts the engine entry for an owed ride, once', async () => {
    const { post, present } = setup();

    expect(await post(owed)).toBe(true);
    expect(present).toHaveBeenCalledWith('src-garmin-7001', 'Ride', 'A PR');

    expect(await post(owed)).toBe(false);
    expect(present).toHaveBeenCalledTimes(1);
  });

  it('posts nothing for a body that is not an owed ride', async () => {
    const { post, present, readEntry } = setup();

    expect(await post({ kind: 'activity_detail', activityId: 'src-garmin-7001' })).toBe(false);
    expect(await post({ kind: 'ride_notification' })).toBe(false);
    expect(await post(undefined)).toBe(false);
    expect(readEntry).not.toHaveBeenCalled();
    expect(present).not.toHaveBeenCalled();
  });

  it('posts nothing when the entry is empty or unreadable', async () => {
    for (const entry of [null, { title: 'Ride', body: '  ' }]) {
      const { post, present } = setup(entry);
      expect(await post(owed)).toBe(false);
      expect(present).not.toHaveBeenCalled();
    }
  });

  it('posts a ride again after a failed post', async () => {
    const { post, present } = setup();
    present.mockRejectedValueOnce(new Error('tray refused'));

    expect(await post(owed)).toBe(false);
    expect(await post(owed)).toBe(true);
  });
});
