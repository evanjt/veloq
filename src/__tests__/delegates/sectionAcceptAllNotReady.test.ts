/**
 * Scenario: Accept all is confirmed while the engine is closed, as it is during
 * a restore or a quarantine reopen, and then again once the engine is open.
 *
 * Expected behaviour: with the engine closed the delegate answers null, which
 * no count can be mistaken for, and never reaches the engine handle. With the
 * engine open it answers the number the write accepted and notifies sections.
 */

import * as sections from '../../../modules/veloqrs/src/delegates/sections/mutations';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';

function closedHost() {
  const notify = jest.fn();
  const host = {
    ready: false,
    get engine(): never {
      throw new TypeError("Cannot read property 'sections' of null");
    },
    timed: <T>(_name: string, run: () => T) => run(),
    notify,
  } as unknown as DelegateHost;
  return { host, notify };
}

function openHost(acceptAll: () => number) {
  const notify = jest.fn();
  const host = {
    ready: true,
    engine: { sections: () => ({ acceptAll }) },
    timed: <T>(_name: string, run: () => T) => run(),
    notify,
  } as unknown as DelegateHost;
  return { host, notify };
}

describe('accepting every auto section', () => {
  it('answers null with the engine closed, without a count', () => {
    const { host, notify } = closedHost();

    expect(sections.acceptAllSections(host)).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it('answers the accepted count and notifies sections with the engine open', () => {
    const { host, notify } = openHost(() => 3);

    expect(sections.acceptAllSections(host)).toBe(3);
    expect(notify).toHaveBeenCalledWith('sections');
  });
});
