/**
 * Scenario: `deliver` walked the live listener Set, and `Set.forEach` visits
 * entries added during iteration. `requestSyncRefresh` unsubscribes inside its
 * own callback and re-subscribes when the outcome is retryable, which
 * `NotReady` is and which holds for the whole window between `destroy` and
 * `initWithPath`. Pull to refresh and then Clear and Sync span that window and
 * the JavaScript thread spun to an ANR.
 *
 * Expected behaviour: one delivery calls each listener once, whatever the
 * listener does to the set, and one listener that throws does not starve the
 * ones behind it.
 */

import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';

const client = EngineClient.getInstance();
const deliver = (event: string, payload?: unknown) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).deliver(event, payload);

describe('delivering an engine event', () => {
  // The unfixed loop is unbounded, so the listener stops re-subscribing after
  // a handful of calls. Without the cap this test hangs the run rather than
  // failing it, which is the defect exactly: on a device it is an ANR.
  const CAP = 8;

  function resubscribingListener(event: string) {
    const state = { calls: 0 };
    const listener = () => {
      state.calls += 1;
      off();
      if (state.calls < CAP) off = client.subscribe(event, listener);
    };
    let off = client.subscribe(event, listener);
    return { state, stop: () => off() };
  }

  it('calls a listener that re-subscribes exactly once', () => {
    const { state, stop } = resubscribingListener('syncSettled');

    deliver('syncSettled');

    expect(state.calls).toBe(1);
    stop();
  });

  it('still calls it once on the next delivery, so the re-subscribe took', () => {
    const { state, stop } = resubscribingListener('syncSettled');

    deliver('syncSettled');
    deliver('syncSettled');

    expect(state.calls).toBe(2);
    stop();
  });

  it('runs the listeners behind one that throws', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: string[] = [];
    const offs = [
      client.subscribe('fitParsed', () => {
        seen.push('first');
        throw new Error('a listener fell over');
      }),
      client.subscribe('fitParsed', () => seen.push('second')),
    ];

    deliver('fitParsed');

    expect(seen).toEqual(['first', 'second']);
    offs.forEach((off) => off());
    warn.mockRestore();
  });

  it('does not call a listener that unsubscribed inside the same delivery', () => {
    const seen: string[] = [];
    const offSecond = () => offs[1]();
    const offs = [
      client.subscribe('tilesGenerated', () => {
        seen.push('first');
        offSecond();
      }),
      client.subscribe('tilesGenerated', () => seen.push('second')),
    ];

    deliver('tilesGenerated');

    expect(seen).toEqual(['first']);
    offs.forEach((off) => off());
  });

  it('delivers to nobody without throwing when the channel has no listeners', () => {
    expect(() => deliver('previewFinished')).not.toThrow();
  });
});
