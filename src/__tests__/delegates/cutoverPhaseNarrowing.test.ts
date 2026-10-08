/**
 * Scenario: the engine settles a cutover that failed after its new catalogue
 * landed on a phase of its own, and the routes status read narrows what
 * crosses to the phases it knows, reading anything else as idle.
 *
 * Expected behaviour: that phase reaches the surfaces as itself. Read as idle,
 * the failure says nothing at all.
 */

import { getRoutesStatusData } from '../../../modules/veloqrs/src/delegates/routesStatus';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';
import { routesStatus } from '../__shared__/routesStatusStub';

const mockStatus = jest.fn();

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
  ...jest.requireActual('../../../modules/veloqrs/src/generated/veloqrs'),
  getRoutesStatusData: () => mockStatus(),
}));

const host = {
  ready: true,
  timed: <T>(_name: string, run: () => T) => run(),
} as unknown as DelegateHost;

describe('the cutover phase across the bridge', () => {
  it('keeps a failure after the apply in the routes status', () => {
    mockStatus.mockReturnValue(
      routesStatus({ cutover: { phase: 'failed_after_apply', running: false } })
    );
    expect(getRoutesStatusData(host)?.cutover.phase).toBe('failed_after_apply');
  });
});
