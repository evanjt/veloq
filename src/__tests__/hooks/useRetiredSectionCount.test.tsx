/**
 * Scenario: the retired screen has three entry points, and each gates on one count, the
 * ledger's retired figure from the routes screen read.
 *
 * Expected behaviour: the count is that figure, read with no rows since an entry point needs
 * only the number. It is zero for a library that retired nothing, zero while the engine is not
 * open, zero when the read cannot answer, and it moves when the engine announces a section
 * change.
 */

import { act, renderHook } from '@testing-library/react-native';
import { routes } from 'veloqrs';

import { useRetiredSectionCount } from '@/features/routes/hooks/useRoutesScreenData';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;
const mockedRead = routes.getRoutesScreenData as unknown as jest.Mock;

describe('useRetiredSectionCount', () => {
  beforeEach(() => {
    mockedRead.mockReset();
    mockedGetEngine.mockReturnValue({ subscribe: () => () => {} } as never);
  });

  it('reads the ledger count the routes screen read carries', () => {
    mockedRead.mockReturnValue({ ledgerRetiredCount: 2, removedCount: 5 });
    const { result } = renderHook(() => useRetiredSectionCount());
    expect(result.current).toBe(2);
  });

  it('asks for no rows, since an entry point needs only the number', () => {
    mockedRead.mockReturnValue({ ledgerRetiredCount: 2 });
    renderHook(() => useRetiredSectionCount());
    expect(mockedRead).toHaveBeenCalledWith(
      expect.objectContaining({ groupLimit: 0, sectionLimit: 0 })
    );
  });

  it('is zero for a library that retired nothing', () => {
    mockedRead.mockReturnValue({ ledgerRetiredCount: 0, removedCount: 3 });
    const { result } = renderHook(() => useRetiredSectionCount());
    expect(result.current).toBe(0);
  });

  it('is zero and reads nothing while the engine is not open', () => {
    mockedGetEngine.mockReturnValue(null);
    const { result } = renderHook(() => useRetiredSectionCount());
    expect(result.current).toBe(0);
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it('is zero when the read cannot answer, so the entry points stay hidden', () => {
    mockedRead.mockImplementation(() => {
      throw new Error('engine unavailable');
    });
    const { result } = renderHook(() => useRetiredSectionCount());
    expect(result.current).toBe(0);
  });

  it('reads again when the engine announces a section change', () => {
    const listeners = new Map<string, () => void>();
    mockedGetEngine.mockReturnValue({
      subscribe: (event: string, listener: () => void) => {
        listeners.set(event, listener);
        return () => listeners.delete(event);
      },
    } as never);
    mockedRead.mockReturnValue({ ledgerRetiredCount: 0 });

    const { result } = renderHook(() => useRetiredSectionCount());
    expect(result.current).toBe(0);

    mockedRead.mockReturnValue({ ledgerRetiredCount: 2 });
    act(() => listeners.get('sections')?.());
    expect(result.current).toBe(2);
  });
});
