/**
 * Scenario: the network and touch pushes run from providers that mount before
 * the engine opens, and they call the bound delegate with no guard of their
 * own. The binding can throw while the native module is still coming up.
 *
 * Expected behaviour: a push that throws is swallowed in the delegate, so the
 * provider that made it keeps running.
 */
import { bindDelegates } from '../../../modules/veloqrs/src/delegates/bind';
import * as connectivityDelegates from '../../../modules/veloqrs/src/delegates/connectivity';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => {
  const fail = () => {
    throw new Error('native module not installed');
  };
  return { setNetworkOnline: fail, setInteracting: fail };
});

const host = {
  ready: false,
  timed: <T>(_name: string, call: () => T): T => call(),
} as unknown as DelegateHost;

describe('connectivity pushes', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('swallows a binding that throws on the network edge', () => {
    const connectivity = bindDelegates(host, connectivityDelegates);
    expect(() => connectivity.setNetworkOnline(false)).not.toThrow();
  });

  it('swallows a binding that throws on the touch edge', () => {
    const connectivity = bindDelegates(host, connectivityDelegates);
    expect(() => connectivity.setInteracting(true)).not.toThrow();
  });
});
