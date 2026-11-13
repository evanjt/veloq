/**
 * Scenario: the section chart hook is rendered with no chart payload while the
 * engine's chart read throws.
 *
 * Expected behaviour: the hook reads nothing itself and draws an empty chart,
 * since the screen read supplies the payload.
 */

import { renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { useSectionChartData } from '@/features/routes/hooks/useSectionChartData';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides({}));

const lockFailed = { tag: 'Database', inner: { msg: 'poisoned' } };

const engine = {
  subscribe: () => () => undefined,
  getSectionChartData: jest.fn(() => {
    throw lockFailed;
  }),
};

beforeEach(() => {
  jest.clearAllMocks();
  (getEngine as jest.Mock).mockReturnValue(engine);
});

describe('useSectionChartData', () => {
  const params = {
    sectionTimeRange: '3m' as never,
    preComputedChart: null,
  };

  it('never reads the engine for a chart; the screen read supplies it', async () => {
    const omitted = { ...params } as Partial<typeof params>;
    delete omitted.preComputedChart;
    const { result } = await renderHook(() => useSectionChartData(omitted as typeof params));

    expect(result.current.chartData).toEqual([]);
    expect(engine.getSectionChartData).not.toHaveBeenCalled();
  });
});
