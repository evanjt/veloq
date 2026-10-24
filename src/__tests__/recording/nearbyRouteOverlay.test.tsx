/**
 * Scenario: the athlete opens the entry screen for a walk with a location fix and has
 * saved walking routes, one of them under their feet.
 *
 * Expected behaviour: the nearest route is drawn and offered before anything is recorded,
 * an explicit choice (including "no route") wins over the nearest, a choice made for one
 * sport does not carry to another, and the choice is still there on the live screen.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useNearbyRouteOverlay } from '@/shared/app/useNearbyRouteOverlay';
import { useRecordingLiveStore } from '@/features/recording';

const groups = [
  { id: 'far', bounds: { minLat: 10, maxLat: 10.1, minLng: 10, maxLng: 10.1 } },
  { id: 'near', bounds: { minLat: 46.4, maxLat: 46.6, minLng: 6.5, maxLng: 6.7 } },
];

const mockUseRouteGroups = jest.fn();
const mockUseRepresentativeRoute = jest.fn();

jest.mock('@/features/routes/light', () => ({
  useRouteGroups: (...args: unknown[]) => mockUseRouteGroups(...args),
}));
jest.mock('@/features/routes', () => ({
  useRepresentativeRoute: (...args: unknown[]) => mockUseRepresentativeRoute(...args),
}));

const here = { latitude: 46.5, longitude: 6.6 };

beforeEach(() => {
  useRecordingLiveStore.getState().reset();
  mockUseRouteGroups.mockReturnValue({ groups });
  mockUseRepresentativeRoute.mockImplementation((id: string | null) => ({
    points: id ? [{ latitude: 1, longitude: 2 }] : null,
  }));
});

const render = (over: Partial<Parameters<typeof useNearbyRouteOverlay>[0]> = {}) =>
  renderHook(() =>
    useNearbyRouteOverlay({
      activityType: 'Walk',
      location: here,
      enabled: true,
      idle: true,
      ...over,
    })
  );

describe('useNearbyRouteOverlay', () => {
  it('draws the nearest route and lists the nearby ones before any recording exists', () => {
    const { result } = render();
    expect(result.current.overlayRouteId).toBe('near');
    expect(result.current.nearbyRouteIds).toEqual(['near']);
    expect(mockUseRepresentativeRoute).toHaveBeenLastCalledWith('near');
  });

  it('offers nothing before a fix and nothing for an indoor sport', () => {
    expect(render({ location: null }).result.current.overlayRouteId).toBeNull();
    expect(render({ enabled: false }).result.current.overlayRouteId).toBeNull();
    expect(mockUseRepresentativeRoute).toHaveBeenLastCalledWith(null);
  });

  it('keeps an explicit choice, including no route, over the nearest', () => {
    const { result } = render();
    act(() => result.current.choose('far'));
    expect(result.current.overlayRouteId).toBe('far');
    act(() => result.current.choose(null));
    expect(result.current.overlayRouteId).toBeNull();
  });

  it('carries the choice to the live screen and ignores it for another sport', () => {
    const entry = render();
    act(() => entry.result.current.choose('far'));
    expect(render({ idle: false }).result.current.overlayRouteId).toBe('far');
    expect(render({ activityType: 'Ride' }).result.current.overlayRouteId).toBe('near');
  });

  it('draws no unchosen route once the ride is under way', () => {
    expect(render({ idle: false }).result.current.overlayRouteId).toBeNull();
  });
});
