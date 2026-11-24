/**
 * Scenario: the engine announces a Garmin ride the phone pulled itself as an
 * owed post-ride notification on `bodyStored`.
 *
 * Expected behaviour: the entry is posted once with the engine's own text; a
 * repeat announcement, another kind of body, a missing entry and an untitled
 * one post nothing. A quiet ride's plain entry is posted.
 */

import { createPulledRidePoster } from '@/features/insights/lib/pulledRideNotification';

function setup(entry: { title: string; body: string } | null = { title: 'Ride', body: 'A PR' }) {
  const present = jest.fn(async (_id: string, _title: string, _body: string) => undefined);
  const readEntry = jest.fn((_id: string) => entry);
  const confirm = jest.fn((_id: string, _title: string, _body: string) => undefined);
  return {
    present,
    readEntry,
    confirm,
    post: createPulledRidePoster({ readEntry, present, confirm }),
  };
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

  it('posts the plain entry of a quiet ride, even with no name to give', async () => {
    for (const body of ['Morning Ride', '']) {
      const { post, present } = setup({ title: 'Ride recorded', body });
      expect(await post(owed)).toBe(true);
      expect(present).toHaveBeenCalledWith('src-garmin-7001', 'Ride recorded', body);
    }
  });

  it('posts nothing when no entry was recorded or it has no title', async () => {
    for (const entry of [null, { title: '  ', body: 'A PR' }]) {
      const { post, present } = setup(entry);
      expect(await post(owed)).toBe(false);
      expect(present).not.toHaveBeenCalled();
    }
  });

  it('posts a ride again after a failed post, confirming only the one that posted', async () => {
    const { post, present, confirm } = setup();
    present.mockRejectedValueOnce(new Error('tray refused'));

    expect(await post(owed)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(await post(owed)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('src-garmin-7001', 'Ride', 'A PR');
  });

  it('still counts a ride as posted when the confirmation fails', async () => {
    const { post, present, confirm } = setup();
    confirm.mockImplementationOnce(() => {
      throw new Error('engine closed');
    });

    expect(await post(owed)).toBe(true);
    expect(await post(owed)).toBe(false);
    expect(present).toHaveBeenCalledTimes(1);
  });
});
