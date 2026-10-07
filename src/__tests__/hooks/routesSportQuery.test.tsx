/**
 * Scenario: a runner who also rides narrows the routes list to runs.
 *
 * Expected behaviour: the engine query carries the chosen sport for groups and
 * sections, and changing it re-reads from the first page.
 */

import { renderHook } from '@testing-library/react-native';

import { useRoutesScreenData } from '@/features/routes/hooks/useRoutesScreenData';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useEngineSubscription: () => 0,
}));

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const PAGE = {
  groups: [],
  sections: [],
  hasMoreGroups: false,
  hasMoreSections: false,
  groupCount: 0,
  sectionCount: 0,
  availableSportTypes: ['Ride', 'Run'],
};

beforeEach(() => jest.clearAllMocks());

describe('the routes screen sport filter', () => {
  it('sends the chosen sport to the engine for groups and sections', () => {
    const getRoutesScreenData = jest.fn(() => PAGE);
    mockedGetEngine.mockReturnValue({ getRoutesScreenData } as never);

    const { result } = renderHook(() =>
      useRoutesScreenData({ groupSportType: 'Run', sectionSportType: 'Run' })
    );

    expect(getRoutesScreenData).toHaveBeenCalledWith(
      expect.objectContaining({ groupSportType: 'Run', sectionSportType: 'Run' })
    );
    expect(result.current.data?.availableSportTypes).toEqual(['Ride', 'Run']);
  });

  it('leaves both fields off when no sport is chosen', () => {
    const getRoutesScreenData = jest.fn(() => PAGE);
    mockedGetEngine.mockReturnValue({ getRoutesScreenData } as never);

    renderHook(() => useRoutesScreenData());

    const query = (getRoutesScreenData.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(query).not.toHaveProperty('groupSportType');
    expect(query).not.toHaveProperty('sectionSportType');
  });
});
