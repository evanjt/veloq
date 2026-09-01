import { act, renderHook } from '@testing-library/react-native';
import { useSectionRescan } from '@/features/routes/hooks/useSectionRescan';
import { getEngine } from '@/shared/native/engine';

/**
 * Scenario: a detect started on one screen has to stay visible after the user
 * navigates away, which is what the preview's Keep does.
 * Expected behaviour: mounting the hook while a run holds the slot adopts it
 * and reports its progress, and publishes no before/after it never measured.
 */

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function engineWith(overrides: Record<string, unknown> = {}) {
  return {
    pollSectionDetection: jest.fn(() => 'idle'),
    getSectionDetectionProgress: jest.fn(() => ({
      phase: 'analyzing',
      completed: 3,
      total: 10,
      percent: 30,
    })),
    getFilteredSectionSummaries: jest.fn(() => ({ totalCount: 7 })),
    startSectionDetection: jest.fn(() => true),
    forceRedetectSections: jest.fn(() => true),
    ...overrides,
  };
}

describe('adopting a detect that is already running', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('picks up a run in flight at mount', () => {
    const engine = engineWith({ pollSectionDetection: jest.fn(() => 'running') });
    mockedGetEngine.mockReturnValue(engine as never);

    const { result } = renderHook(() => useSectionRescan());

    expect(result.current.isScanning).toBe(true);

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(result.current.progress?.percent).toBe(30);
  });

  it('publishes no result for a run it did not start', () => {
    const poll = jest.fn(() => 'running');
    mockedGetEngine.mockReturnValue(engineWith({ pollSectionDetection: poll }) as never);

    const { result } = renderHook(() => useSectionRescan());

    poll.mockReturnValue('complete');
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(result.current.isScanning).toBe(false);
    expect(result.current.result).toBeNull();
  });

  it('adopts nothing when the engine is idle', () => {
    mockedGetEngine.mockReturnValue(engineWith() as never);

    const { result } = renderHook(() => useSectionRescan());

    expect(result.current.isScanning).toBe(false);
    expect(result.current.progress).toBeNull();
  });

  it('still reports before and after for a run it started itself', () => {
    const poll = jest.fn(() => 'running');
    mockedGetEngine.mockReturnValue(engineWith({ pollSectionDetection: poll }) as never);

    const { result } = renderHook(() => useSectionRescan());

    act(() => {
      result.current.forceRescan();
    });
    poll.mockReturnValue('complete');
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(result.current.result).toEqual({ before: 7, after: 7 });
  });
});
