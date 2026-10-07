/**
 * Scenario: an activity or section popup is open and the athlete taps bare
 * terrain, from the 2D surface or the 3D page.
 *
 * Expected behaviour: both popups close and any spider clears.
 */

import { renderHook, act } from '@testing-library/react-native';

import { useMapHandlers } from '@/features/maps/components/regional/useMapHandlers';
import { SECTIONS_LINE_LAYER_ID } from '@/features/maps/components/regional/regionalMapLayerSpecs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  Accuracy: { Balanced: 3 },
}));

function mount() {
  const setSelected = jest.fn();
  const setSelectedSectionId = jest.fn();
  const setSectionChoices = jest.fn();
  const setSpider = jest.fn();
  const rendered = renderHook(() =>
    useMapHandlers({
      activities: [],
      selected: { activity: { id: 'a1' } },
      setSelected,
      setSelectedSectionId,
      setSectionChoices,
      setSpider,
      currentZoomRef: { current: 14 },
      currentCenterRef: { current: [6.6, 46.5] },
      surfaceRef: { current: null },
      map3DRef: { current: null },
      currentZoomLevel: { current: 14 },
      bearingAnim: { setValue: jest.fn() },
      is3DMode: true,
    } as never)
  );
  return { rendered, setSelected, setSelectedSectionId, setSectionChoices, setSpider };
}

describe('a tap on bare terrain', () => {
  it('closes the section popup too, from the shared empty-space callback', () => {
    const { rendered, setSelectedSectionId, setSpider } = mount();
    act(() => rendered.result.current.handleEmptyPress());
    expect(setSelectedSectionId).toHaveBeenCalledWith(null);
    expect(setSpider).toHaveBeenCalledWith(null);
  });

  it('is what a surface press with no feature runs', async () => {
    const { rendered, setSelectedSectionId } = mount();
    await act(async () => {
      rendered.result.current.handleSurfacePress({
        coordinate: [0, 0],
        point: [0, 0],
        feature: undefined,
        features: [],
      } as never);
    });
    expect(setSelectedSectionId).toHaveBeenCalledWith(null);
  });
});

describe('section taps', () => {
  const hit = (id: string) => ({
    layerId: SECTIONS_LINE_LAYER_ID,
    id: null,
    properties: { id },
    geometry: null,
  });

  it('opens the chooser for two distinct sections', async () => {
    const { rendered, setSelectedSectionId, setSectionChoices } = mount();
    await act(async () => {
      await rendered.result.current.handleSurfacePress({
        feature: hit('ridge'),
        features: [hit('ridge'), hit('canal'), hit('ridge')],
      } as never);
    });
    expect(setSectionChoices).toHaveBeenCalledWith(['ridge', 'canal']);
    expect(setSelectedSectionId).toHaveBeenCalledWith(null);
  });

  it('opens the section directly when duplicate hits have one id', async () => {
    const { rendered, setSelectedSectionId, setSectionChoices } = mount();
    await act(async () => {
      await rendered.result.current.handleSurfacePress({
        feature: hit('ridge'),
        features: [hit('ridge'), hit('ridge')],
      } as never);
    });
    expect(setSectionChoices).toHaveBeenCalledWith([]);
    expect(setSelectedSectionId).toHaveBeenCalledWith('ridge');
  });

  it('dismisses the chooser on bare terrain', () => {
    const { rendered, setSectionChoices } = mount();
    act(() => rendered.result.current.handleEmptyPress());
    expect(setSectionChoices).toHaveBeenCalledWith([]);
  });
});
