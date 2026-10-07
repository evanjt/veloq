/**
 * Scenario: the engine's routes screen read throws, for example a busy or
 * corrupt database.
 *
 * Expected behaviour: the delegate lets the failure reach the caller instead of
 * answering `undefined`, which a screen reads as an empty library.
 */

import { getRoutesScreenData } from '../../../modules/veloqrs/src/delegates/routes';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';

const QUERY = {} as never;

function host(ready: boolean, getScreenData: () => unknown): DelegateHost {
  return {
    ready,
    timed: <T>(_name: string, run: () => T) => run(),
    engine: { routes: () => ({ getScreenData }) },
  } as unknown as DelegateHost;
}

describe('getRoutesScreenData', () => {
  it('rethrows a failed read', () => {
    const failure = new Error('database is locked');
    const h = host(true, () => {
      throw failure;
    });

    expect(() => getRoutesScreenData(h, QUERY)).toThrow(failure);
  });

  it('answers undefined only when the engine is not ready', () => {
    expect(getRoutesScreenData(host(false, jest.fn()), QUERY)).toBeUndefined();
  });

  it('returns the page when the read succeeds', () => {
    const page = { groups: [] };
    expect(
      getRoutesScreenData(
        host(true, () => page),
        QUERY
      )
    ).toBe(page);
  });
});
