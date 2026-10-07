/**
 * Scenario: the routes status bundle is polled on a timer.
 *
 * Expected behaviour: it carries only figures a follower reads. The tile pass
 * reads its own progress, so the bundle holds no tile counts.
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

describe('the routes status bundle', () => {
  it('carries no tile counts', () => {
    mockStatus.mockReturnValue({ ...routesStatus({}), heatmapTiles: [3, 9] });
    expect(getRoutesStatusData(host)).not.toHaveProperty('heatmapTiles');
  });
});
