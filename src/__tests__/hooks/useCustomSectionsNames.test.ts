import { act, renderHook } from '@testing-library/react-native';
import { useCustomSections } from '@/features/routes/hooks/useCustomSections';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({ decodeCoords: () => [] })
);
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/shared/native/useEngineSubscription', () => ({ useEngineSubscription: () => 0 }));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQuery: () => ({ data: [], isLoading: false, error: null, refetch: jest.fn() }),
  useQueryClient: () => ({
    invalidateQueries: jest.fn().mockResolvedValue(undefined),
    setQueryData: jest.fn(),
  }),
}));

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function engine() {
  return {
    createSectionFromIndices: jest.fn(
      (_activityId: string, _start: number, _end: number, _sport: string, _name?: string) =>
        'custom_1'
    ),
    getSectionById: jest.fn(() => ({
      id: 'custom_1',
      name: 'Section 1',
      encodedPolyline: '',
      distanceMeters: 1200,
      createdAt: '2026-01-01T00:00:00Z',
    })),
    deleteSection: jest.fn(() => true),
    setSectionName: jest.fn(() => 'saved'),
  };
}

const INPUT = { sourceActivityId: 'a1', startIndex: 0, endIndex: 10, sportType: 'Ride' };

describe('custom section names', () => {
  it('saves an absent or blank name as no name, so the section is shown under its number', async () => {
    const mockEngine = engine();
    mockedGetEngine.mockReturnValue(mockEngine as never);
    const { result } = renderHook(() => useCustomSections());

    await act(async () => {
      await result.current.createSection(INPUT);
      await result.current.createSection({ ...INPUT, name: '  ' });
    });

    const calls = mockEngine.createSectionFromIndices.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][4]).toBeUndefined();
    expect(calls[1][4]).toBeUndefined();
  });

  it('passes an explicit name unchanged', async () => {
    const mockEngine = engine();
    mockedGetEngine.mockReturnValue(mockEngine as never);
    const { result } = renderHook(() => useCustomSections());

    await act(async () => {
      await result.current.createSection({ ...INPUT, name: 'Col de la Croix' });
    });

    expect(mockEngine.createSectionFromIndices).toHaveBeenCalledWith(
      'a1',
      0,
      10,
      'Ride',
      'Col de la Croix'
    );
  });

  it('rejects a rename the engine refused', async () => {
    const mockEngine = engine();
    mockEngine.setSectionName.mockReturnValue('failed');
    mockedGetEngine.mockReturnValue(mockEngine as never);
    const { result } = renderHook(() => useCustomSections());

    await expect(result.current.renameSection('custom_1', 'Taken')).rejects.toMatchObject({
      reason: 'failed',
    });
  });

  it('rejects a rename to a taken name with the name-taken reason', async () => {
    const mockEngine = engine();
    mockEngine.setSectionName.mockReturnValue('nameTaken');
    mockedGetEngine.mockReturnValue(mockEngine as never);
    const { result } = renderHook(() => useCustomSections());

    await expect(result.current.renameSection('custom_1', 'Taken')).rejects.toMatchObject({
      reason: 'nameTaken',
    });
  });

  it('keeps create and delete supersession inside each engine mutation', async () => {
    const mockEngine = engine();
    mockedGetEngine.mockReturnValue(mockEngine as never);
    const { result } = renderHook(() => useCustomSections());

    await act(async () => {
      await result.current.createSection(INPUT);
      await result.current.removeSection('custom_1');
    });

    expect(mockEngine.createSectionFromIndices).toHaveBeenCalledTimes(1);
    expect(mockEngine.deleteSection).toHaveBeenCalledWith('custom_1');
  });
});
