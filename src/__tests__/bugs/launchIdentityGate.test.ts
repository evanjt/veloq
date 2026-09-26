/**
 * Scenario: athlete A's library is on the device and athlete B signs in. The
 * mismatch prompt goes up, and launch carries on: the sync starts with B's
 * credentials, the elevation backfill and the detector cutover run, all against
 * A's tables.
 *
 * Expected behaviour: nothing launch does afterwards runs until the prompt is
 * answered. Cancel leaves A's library untouched, Clear & Sync runs it once on
 * the empty one.
 */

import { launchIdentityAction, completeLaunchIdentity } from '@/features/auth/lib/launchIdentity';

const steps = () => {
  const order: string[] = [];
  let answer: (cleared: boolean) => void = () => {};
  return {
    order,
    answer: (cleared: boolean) => answer(cleared),
    wipe: jest.fn(async () => {
      order.push('wipe');
    }),
    reopen: jest.fn(() => {
      order.push('reopen');
      return true;
    }),
    ask: jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          order.push('ask');
          answer = resolve;
        })
    ),
    proceed: jest.fn(() => {
      order.push('proceed');
    }),
  };
};

describe('launchIdentityAction', () => {
  it('proceeds when the library belongs to the athlete signing in', () => {
    expect(launchIdentityAction('a', 'a', 400)).toBe('proceed');
  });

  it('proceeds when nothing on disk is named, so there is no mismatch to find', () => {
    expect(launchIdentityAction(null, 'a', 400)).toBe('proceed');
  });

  it('proceeds when no credentials name an athlete to compare against', () => {
    expect(launchIdentityAction('a', null, 400)).toBe('proceed');
  });

  it('wipes without asking when the other athlete left nothing behind', () => {
    expect(launchIdentityAction('a', 'b', 0)).toBe('wipe-then-proceed');
  });

  it('asks first when the other athlete left a library', () => {
    expect(launchIdentityAction('a', 'b', 1)).toBe('ask-first');
  });
});

describe('completeLaunchIdentity', () => {
  it('starts nothing while the question is on screen', async () => {
    const s = steps();

    await expect(completeLaunchIdentity('ask-first', s)).resolves.toBe(false);

    expect(s.order).toEqual(['ask']);
    expect(s.proceed).not.toHaveBeenCalled();
    expect(s.wipe).not.toHaveBeenCalled();
  });

  it('runs the rest of launch once the library has been cleared', async () => {
    const s = steps();
    await completeLaunchIdentity('ask-first', s);

    s.answer(true);
    await new Promise(process.nextTick);

    expect(s.order).toEqual(['ask', 'reopen', 'proceed']);
  });

  it('starts nothing at all when the athlete keeps the library', async () => {
    const s = steps();
    await completeLaunchIdentity('ask-first', s);

    s.answer(false);
    await new Promise(process.nextTick);

    expect(s.order).toEqual(['ask']);
    expect(s.proceed).not.toHaveBeenCalled();
  });

  it('leaves launch stopped when the re-open after a clear fails', async () => {
    const s = steps();
    s.reopen.mockReturnValue(false);
    await completeLaunchIdentity('ask-first', s);

    s.answer(true);
    await new Promise(process.nextTick);

    expect(s.proceed).not.toHaveBeenCalled();
  });

  it('empties the library before proceeding when nothing was there to lose', async () => {
    const s = steps();

    await expect(completeLaunchIdentity('wipe-then-proceed', s)).resolves.toBe(true);

    expect(s.order).toEqual(['wipe', 'reopen', 'proceed']);
    expect(s.ask).not.toHaveBeenCalled();
  });

  it('does not proceed on a wipe whose re-open failed', async () => {
    const s = steps();
    s.reopen.mockReturnValue(false);

    await expect(completeLaunchIdentity('wipe-then-proceed', s)).resolves.toBe(false);

    expect(s.proceed).not.toHaveBeenCalled();
  });

  it('proceeds straight away when the identity already matches', async () => {
    const s = steps();

    await expect(completeLaunchIdentity('proceed', s)).resolves.toBe(true);

    expect(s.order).toEqual(['proceed']);
    expect(s.ask).not.toHaveBeenCalled();
    expect(s.wipe).not.toHaveBeenCalled();
  });
});
