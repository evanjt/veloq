/**
 * Scenario: the routes layer is on and the athlete taps a route line, with an
 * activity popup open.
 *
 * Expected behaviour: the route is selected and its popup opens in place of
 * the activity's, rather than the tap reading as bare terrain. A section drawn
 * over the route keeps the tap, and a tap on bare terrain closes the route.
 */

import { renderHook, act } from '@testing-library/react-native';

import { useMapHandlers } from '@/features/maps/components/regional/useMapHandlers';
import {
  ROUTES_LINE_LAYER_ID,
  SECTIONS_LINE_LAYER_ID,
} from '@/features/maps/components/regional/regionalMapLayerSpecs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  Accuracy: { Balanced: 3 },
}));

async function mount() {
  const setSelected = jest.fn();
  const setSelectedSectionId = jest.fn();
  const setSelectedRouteId = jest.fn();
  const chooseSection = jest.fn();
  const setSpider = jest.fn();
  const rendered = await renderHook(() =>
    useMapHandlers({
      activities: [],
      selected: { activity: { id: 'a1' } },
      setSelected,
      setSelectedSectionId,
      setSelectedRouteId,
      chooseSection,
      setSpider,
      currentZoomRef: { current: 14 },
      currentCenterRef: { current: [6.6, 46.5] },
      surfaceRef: { current: null },
      map3DRef: { current: null },
      currentZoomLevel: { current: 14 },
      bearingAnim: { setValue: jest.fn() },
      is3DMode: false,
    } as never)
  );
  return { rendered, setSelected, setSelectedSectionId, setSelectedRouteId, chooseSection };
}

const hit = (layerId: string, id: string) => ({
  layerId,
  id: null,
  properties: { id },
  geometry: null,
});

async function press(
  rendered: Awaited<ReturnType<typeof mount>>['rendered'],
  feature: ReturnType<typeof hit> | undefined
) {
  await act(async () => {
    await rendered.result.current.handleSurfacePress({
      coordinate: [6.6, 46.5],
      point: [0, 0],
      feature,
      features: feature ? [feature] : [],
    } as never);
  });
}

describe('a tap on a route line', () => {
  it('selects that route and closes the activity popup', async () => {
    const { rendered, setSelected, setSelectedSectionId, setSelectedRouteId } = await mount();
    await press(rendered, hit(ROUTES_LINE_LAYER_ID, 'loop-7'));
    expect(setSelectedRouteId).toHaveBeenLastCalledWith('loop-7');
    expect(setSelected).toHaveBeenCalledWith(null);
    expect(setSelectedSectionId).toHaveBeenCalledWith(null);
  });

  it('does nothing to the selection when the line carries no id', async () => {
    const { rendered, setSelected, setSelectedRouteId } = await mount();
    await press(rendered, { ...hit(ROUTES_LINE_LAYER_ID, ''), properties: {} as never });
    expect(setSelectedRouteId).not.toHaveBeenCalled();
    expect(setSelected).not.toHaveBeenCalled();
  });
});

describe('a tap that wins over the route', () => {
  it('opens the section drawn over the route and closes the route', async () => {
    const { rendered, setSelectedSectionId, setSelectedRouteId } = await mount();
    await press(rendered, hit(SECTIONS_LINE_LAYER_ID, 'ridge'));
    expect(setSelectedSectionId).toHaveBeenCalledWith('ridge');
    expect(setSelectedRouteId).toHaveBeenCalledWith(null);
    expect(setSelectedRouteId).not.toHaveBeenCalledWith('loop-7');
  });

  it('closes the route on bare terrain', async () => {
    const { rendered, setSelectedRouteId } = await mount();
    await press(rendered, undefined);
    expect(setSelectedRouteId).toHaveBeenCalledWith(null);
  });
});
