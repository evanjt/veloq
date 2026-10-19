/**
 * Scenario: the athlete taps the regional map where two sections overlap.
 *
 * Expected behaviour: the section chooser sheet opens with both sections, in
 * the order the page hit them, and the section chosen there opens its popup. A
 * dismissed sheet opens nothing, and a tap on one section skips the sheet.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useMapHandlers } from '@/features/maps/components/regional/useMapHandlers';
import { useSectionChooser } from '@/features/maps/components/regional/useSectionChooser';
import { SECTIONS_LINE_LAYER_ID } from '@/features/maps/components/regional/regionalMapLayerSpecs';
import type { MapSection } from '@/features/maps/hooks/useEngineMapActivities';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import type { SectionChooserInput } from '@/app/sheets/section-chooser';
import { answerSheet } from '../../__shared__/answerSheet';

const mockPush = jest.fn();
const mockParams: { request?: string } = {};

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  Accuracy: { Balanced: 3 },
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...a: unknown[]) => mockPush(...a), canGoBack: () => true, back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

const SECTIONS: MapSection[] = [
  { id: 'ridge', name: 'Ridge Road', distanceMeters: 1200, visitCount: 2 },
  { id: 'canal', name: 'Canal Path', distanceMeters: 850, visitCount: 3 },
  { id: 'quay', name: 'Quay Loop', distanceMeters: 400, visitCount: 1 },
];

async function mount() {
  const setSelectedSectionId = jest.fn();
  const rendered = await renderHook(() => {
    const chooseSection = useSectionChooser(SECTIONS, setSelectedSectionId);
    return useMapHandlers({
      activities: [],
      selected: null,
      setSelected: jest.fn(),
      setSelectedSectionId,
      setSelectedRouteId: jest.fn(),
      chooseSection,
      setSpider: jest.fn(),
      currentZoomRef: { current: 14 },
      currentCenterRef: { current: [6.6, 46.5] },
      surfaceRef: { current: null },
      currentZoomLevel: { current: 14 },
      bearingAnim: { setValue: jest.fn() },
    } as never);
  });
  return { rendered, setSelectedSectionId };
}

const hit = (id: string) => ({
  layerId: SECTIONS_LINE_LAYER_ID,
  id: null,
  properties: { id },
  geometry: null,
});

async function tap(rendered: Awaited<ReturnType<typeof mount>>['rendered'], ids: string[]) {
  await act(async () => {
    await rendered.result.current.handleSurfacePress({
      coordinate: [6.6, 46.5],
      point: [0, 0],
      feature: hit(ids[0]!),
      features: ids.map(hit),
    } as never);
  });
}

const pushed = () => mockPush.mock.calls.map(([target]) => target);

beforeEach(() => {
  mockPush.mockClear();
});

describe('a tap where sections overlap', () => {
  it('opens the chooser sheet with the sections under the finger', async () => {
    const { rendered } = await mount();
    await tap(rendered, ['canal', 'ridge', 'canal']);

    expect(pushed()).toHaveLength(1);
    expect(pushed()[0].pathname).toBe('sheets/section-chooser');
    mockParams.request = pushed()[0].params.request;
    const reader = await renderHook(() => useSheetRequest<SectionChooserInput, string>());
    expect(reader.result.current.input?.sections).toEqual([
      { id: 'canal', name: 'Canal Path', distanceMeters: 850 },
      { id: 'ridge', name: 'Ridge Road', distanceMeters: 1200 },
    ]);
  });

  it('opens the popup of the section chosen in the sheet', async () => {
    const { rendered, setSelectedSectionId } = await mount();
    await tap(rendered, ['ridge', 'canal']);

    await answerSheet(mockPush, mockParams, 'canal');
    await act(async () => {});

    expect(setSelectedSectionId).toHaveBeenLastCalledWith('canal');
  });

  it('opens nothing when the sheet is dismissed', async () => {
    const { rendered, setSelectedSectionId } = await mount();
    await tap(rendered, ['ridge', 'canal']);

    await answerSheet(mockPush, mockParams, null);
    await act(async () => {});

    expect(setSelectedSectionId).not.toHaveBeenCalledWith('ridge');
    expect(setSelectedSectionId).not.toHaveBeenCalledWith('canal');
  });

  it('opens a lone section directly, with no sheet', async () => {
    const { rendered, setSelectedSectionId } = await mount();
    await tap(rendered, ['ridge', 'ridge']);

    expect(pushed()).toHaveLength(0);
    expect(setSelectedSectionId).toHaveBeenLastCalledWith('ridge');
  });
});
