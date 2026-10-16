/**
 * Scenario: a component names the delegate it reaches into, and the delegate
 * is bound to the one engine host rather than reached through a forward on the
 * client. The binding must not snapshot the host, since the engine opens after
 * the module is loaded.
 *
 * Expected behaviour: a bound function passes the host and its own arguments
 * through, reads the host's state at the call, and before the engine opens
 * answers the delegate's typed default rather than null.
 */
import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';
import { bindDelegates } from '../../../modules/veloqrs/src/delegates/bind';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';
import * as elevationDelegates from '../../../modules/veloqrs/src/delegates/elevation';
import { FfiStartOutcome } from '../../../modules/veloqrs/src/generated/veloqrs';

const kennel = {
  countHounds(host: DelegateHost, breed: string, limit: number): string {
    return host.ready ? `${breed}:${limit}` : 'closed';
  },
  KENNEL_SIZES: ['small', 'large'] as const,
};

function hostWith(ready: boolean): DelegateHost {
  return { ready } as unknown as DelegateHost;
}

describe('bindDelegates', () => {
  it('passes the host and the arguments through', () => {
    const bound = bindDelegates(hostWith(true), kennel);
    expect(bound.countHounds('beagle', 3)).toBe('beagle:3');
  });

  it('reads the host at the call, so an open after binding is seen', () => {
    const host = { ready: false } as { ready: boolean };
    const bound = bindDelegates(host as unknown as DelegateHost, kennel);
    expect(bound.countHounds('beagle', 3)).toBe('closed');

    host.ready = true;
    expect(bound.countHounds('beagle', 3)).toBe('beagle:3');
  });

  it('leaves out what is not a delegate function', () => {
    const bound = bindDelegates(hostWith(true), kennel) as Record<string, unknown>;
    expect(bound.KENNEL_SIZES).toBeUndefined();
  });

  it('answers the typed default before the engine opens', () => {
    const client = EngineClient.getInstance();
    expect(client.ready).toBe(false);
    const elevation = bindDelegates(client, elevationDelegates);

    expect(elevation.startElevationBackfill()).toBe(FfiStartOutcome.NotReady);
    expect(elevation.resumeElevationBackfill()).toBe(false);
    expect(elevation.getElevationBackfillRemaining()).toBeNull();
    expect(() => elevation.pauseElevationBackfill()).not.toThrow();
  });
});
