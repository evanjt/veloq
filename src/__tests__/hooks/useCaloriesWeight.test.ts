/**
 * Scenario: the live calories estimate needs the athlete's weight. The profile
 * the engine stores is the one source, read through the athlete query, so a
 * screen that never mounted another reader of the profile still sees it.
 *
 * Expected behaviour: the engine profile's weight is used and not assumed; a
 * profile without one, or no profile yet, falls back to the default and says
 * it was assumed.
 */
import { renderHook } from '@testing-library/react-native';

import { DEFAULT_WEIGHT_KG, useCaloriesWeight } from '@/features/recording/hooks/useCaloriesWeight';

const mockUseAthlete = jest.fn();
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => mockUseAthlete() }));

describe('useCaloriesWeight', () => {
  it('uses the weight on the engine profile', async () => {
    mockUseAthlete.mockReturnValue({ data: { id: 'i1', name: 'Rider', weightKg: 64 } });
    const { result } = await renderHook(() => useCaloriesWeight());
    expect(result.current).toEqual({ weightKg: 64, assumed: false });
  });

  it('assumes the default when the profile carries no weight', async () => {
    mockUseAthlete.mockReturnValue({ data: { id: 'i1', name: 'Rider' } });
    const { result } = await renderHook(() => useCaloriesWeight());
    expect(result.current).toEqual({ weightKg: DEFAULT_WEIGHT_KG, assumed: true });
  });

  it('assumes the default before any profile has been read', async () => {
    mockUseAthlete.mockReturnValue({ data: null });
    const { result } = await renderHook(() => useCaloriesWeight());
    expect(result.current).toEqual({ weightKg: DEFAULT_WEIGHT_KG, assumed: true });
    mockUseAthlete.mockReturnValue({ data: undefined });
    const again = await renderHook(() => useCaloriesWeight());
    expect(again.result.current.assumed).toBe(true);
  });
});
