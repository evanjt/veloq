/**
 * Scenario: the insights recompute read the screen bundle and then the summary
 * card bundle, a second synchronous engine call under the engine lock, to take
 * one trend from it.
 *
 * Expected behaviour: a recompute makes one engine call, and the bundle it
 * reads is the whole input.
 */

import { fetchInsightsDataFromEngine } from '@/features/insights/lib/computeInsightsData';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

describe('fetchInsightsDataFromEngine', () => {
  it('reads the insights bundle and nothing else from the engine', () => {
    const bundle = { sportTypes: [] };
    const engine = {
      getInsightsData: jest.fn(() => bundle),
      getSummaryCardData: jest.fn(() => {
        throw new Error('the summary card is not an input of the insights screen');
      }),
    };
    (getEngine as jest.Mock).mockReturnValue(engine);

    const fetched = fetchInsightsDataFromEngine();

    expect(fetched).toEqual({ insightsData: bundle });
    expect(engine.getInsightsData).toHaveBeenCalledTimes(1);
    expect(engine.getSummaryCardData).not.toHaveBeenCalled();
  });
});
