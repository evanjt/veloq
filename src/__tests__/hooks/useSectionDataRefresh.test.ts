import { renderHook, act } from '@testing-library/react-native';
import { useSectionDataRefresh } from '@/features/routes/hooks/useSectionDataRefresh';

jest.mock('veloqrs', () => ({
  ...require('../__shared__/veloqrsStub'),
  decodeCoords: () => [{ latitude: 1, longitude: 2 }],
}));

const native = {
  id: 's1',
  sectionType: 'custom',
  encodedPolyline: new ArrayBuffer(8),
  activityPortions: [],
} as never;

describe('useSectionDataRefresh', () => {
  it('converts the bundled section through the shared converter', async () => {
    const { result } = await renderHook(() => useSectionDataRefresh(native));
    expect(result.current.section).toMatchObject({
      id: 's1',
      sectionType: 'custom',
      polyline: [{ lat: 1, lng: 2 }],
    });
  });

  it('has no section without a bundle', async () => {
    const { result } = await renderHook(() => useSectionDataRefresh(undefined));
    expect(result.current.section).toBeNull();
  });

  it('keeps the bundled section when a trim bumps the key', async () => {
    const { result } = await renderHook(() => useSectionDataRefresh(native));
    const before = result.current.section;
    await act(() => result.current.handleTrimRefresh());
    expect(result.current.sectionRefreshKey).toBe(1);
    expect(result.current.section).toBe(before);
  });
});
