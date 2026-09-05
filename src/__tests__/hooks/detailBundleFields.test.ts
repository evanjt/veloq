/**
 * Scenario: `getSectionDetailData` and `getActivityDetailData` return the whole
 * screen's data in one read, and the older per-field hooks are handed the
 * bundle's field.
 * Expected behaviour: those hooks read the field they are given and make no
 * engine call of their own, so there is one path and not two.
 */
import { renderHook } from '@testing-library/react-native';

import { useSectionEncounters } from '@/features/routes/hooks/useSectionEncounters';
import { useMergeSections } from '@/features/routes/hooks/useMergeSections';
import { useNearbySections } from '@/features/routes/hooks/useNearbySections';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/features/routes/hooks/useEngine', () => ({
  useEngineSubscription: () => 0,
}));

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

/** An engine that fails any call, so a surviving fallback is loud. */
function forbiddenEngine() {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        return () => {
          throw new Error(`the fallback called engine.${String(prop)}()`);
        };
      },
    }
  );
}

describe('a hook handed its bundle field', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetEngine.mockReturnValue(forbiddenEngine() as never);
  });

  it('returns the nearby sections it was given', () => {
    const nearby = [{ id: 'sec-2', distanceMeters: 120 }] as never;

    const { result } = renderHook(() => useNearbySections(nearby));

    expect(result.current.nearby).toBe(nearby);
  });

  it('returns the merge candidates it was given', () => {
    const candidates = [{ sectionId: 'sec-3' }] as never;

    const { result } = renderHook(() => useMergeSections(candidates));

    expect(result.current.candidates).toBe(candidates);
  });

  it('returns the encounters it was given', () => {
    const encounters = [{ sectionId: 'sec-4' }] as never;

    const { result } = renderHook(() => useSectionEncounters(encounters));

    expect(result.current.encounters).toBe(encounters);
  });

  it('reads nothing from the engine for an empty bundle field', () => {
    const empty: never[] = [];

    expect(renderHook(() => useNearbySections(empty)).result.current.nearby).toEqual([]);
    expect(renderHook(() => useMergeSections(empty)).result.current.candidates).toEqual([]);
    expect(renderHook(() => useSectionEncounters(empty)).result.current.encounters).toEqual([]);
  });
});
