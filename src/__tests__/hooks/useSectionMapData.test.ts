import { renderHook } from '@testing-library/react-native';
import { useSectionMapData } from '@/features/routes/hooks/useSectionMapData';
import type { FrequentSection } from '@/types';

const sectionOf = (sportTypes: string[]) => ({ sportTypes }) as unknown as FrequentSection;

describe('useSectionMapData', () => {
  it('reads pace for a section only runs have taken', () => {
    const { result } = renderHook(() => useSectionMapData(undefined, sectionOf(['Run'])));
    expect(result.current.isRunning).toBe(true);
  });

  it('reads speed when several sports have taken it and none is picked', () => {
    const { result } = renderHook(() => useSectionMapData(undefined, sectionOf(['Run', 'Ride'])));
    expect(result.current.isRunning).toBe(false);
  });

  it('lets the picked sport win', () => {
    const { result } = renderHook(() => useSectionMapData('Ride', sectionOf(['Run', 'Ride'])));
    expect(result.current.isRunning).toBe(false);
  });
});
