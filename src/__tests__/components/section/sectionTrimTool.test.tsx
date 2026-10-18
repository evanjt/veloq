/**
 * Scenario: editing a section's bounds needs the whole map, and the map sits under the section's
 * sheet. The edit grew the map to a fixed fraction of a scrolling page, so the handles and the
 * section shared the screen with the page under them.
 *
 * Expected behaviour: entering the tool puts the sheet away and draws the tool's bar with the
 * handles over the full map, which draws the kept range. Cancel, Save and back each end the tool
 * and present the sheet again at the stop it rested at, a drag to Peek included. A section with
 * no line to edit ends the tool at once rather than leaving the map bare.
 */

import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SectionDetailMap } from '@/features/routes/components/SectionDetailMap';
import { closeHost, openHost } from '@/shared/app/mapSheetHost';
import {
  MAP_SHEET_HALF_STOP,
  MAP_SHEET_PEEK_STOP,
  useMapSheetStop,
  useMapSheetStops,
} from '@/shared/app/mapSheetStop';
import type { FrequentSection, RoutePoint } from '@/types';
import { stubHardwareBack, type HardwareBack } from '../../__shared__/hardwareBack';

const mockMapProps = jest.fn();
const mockBoundsEdit = jest.fn();

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/features/routes/components/SectionMapView', () => ({
  SectionMapView: (props: unknown) => {
    mockMapProps(props);
    return null;
  },
}));
jest.mock('@/shared/async/useAfterNavigationTransition', () => ({
  useAfterNavigationTransition: (task: () => void) =>
    jest.requireActual('react').useEffect(task, [task]),
}));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ runSectionBoundsEdit: mockBoundsEdit }),
}));
jest.mock('@/features/routes/hooks/useSectionDetailData', () => ({
  useSectionDetailData: () => ({ data: null, allActivityTraces: undefined }),
}));
jest.mock('@/features/routes/hooks/useSectionDataRefresh', () => ({
  useSectionDataRefresh: () => ({ section: mockSection }),
}));

const LINE: RoutePoint[] = Array.from({ length: 12 }, (_, i) => ({
  lat: 46.9 + i * 0.001,
  lng: 7.4 + i * 0.001,
}));

let mockSection: FrequentSection;
const PLAIN: FrequentSection = {
  id: 'orchard-climb',
  sectionType: 'auto',
  sportTypes: ['Ride'],
  polyline: LINE,
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 4,
  createdAt: '2026-01-01T00:00:00Z',
};
const KEY = 'section:orchard-climb';

let present: jest.Mock;
let back: HardwareBack;

async function openMap() {
  openHost('section', mockSection.id);
  present = jest.fn();
  // The map screen's presenter and the card's hook, as the host registers them.
  renderHook(() => useMapSheetStop(KEY, present));
  const card = renderHook(() => useMapSheetStop(KEY));
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <SectionDetailMap sectionId={mockSection.id} />
    </QueryClientProvider>
  );
  return card;
}

const lastMapProps = () => mockMapProps.mock.calls[mockMapProps.mock.calls.length - 1][0];

beforeEach(() => {
  mockSection = PLAIN;
  mockMapProps.mockClear();
  mockBoundsEdit.mockReset();
  back = stubHardwareBack();
});

afterEach(() => {
  back.restore();
  closeHost(KEY);
  act(() => useMapSheetStops.setState({ sheets: {}, presenters: {} }));
});

describe('the edit bounds tool on the section map', () => {
  it('puts the sheet away and draws the bar with the handles over the full map', async () => {
    const card = await openMap();
    expect(screen.queryByTestId('map-tool-bar')).toBeNull();

    await act(async () => card.result.current.enterTool());

    expect(present.mock.calls).toEqual([[null]]);
    expect(screen.getByTestId('map-tool-bar')).toBeTruthy();
    expect(screen.getByTestId('section-trim-overlay')).toBeTruthy();
    expect(lastMapProps().trimRange).toEqual({ start: 0, end: LINE.length - 1 });
  });

  it('presents the sheet at Half again on Cancel and takes the bar away', async () => {
    const card = await openMap();
    await act(async () => card.result.current.enterTool());

    await act(async () => fireEvent.press(screen.getByTestId('section-trim-cancel')));

    expect(present.mock.calls).toEqual([[null], [MAP_SHEET_HALF_STOP]]);
    expect(screen.queryByTestId('map-tool-bar')).toBeNull();
    expect(lastMapProps().trimRange).toBeNull();
  });

  it('presents the sheet at the stop it had once Save has written the bounds', async () => {
    mockBoundsEdit.mockResolvedValue([]);
    const card = await openMap();
    await act(async () =>
      card.result.current.onDetentChanged({ index: MAP_SHEET_PEEK_STOP, isStable: true })
    );
    await act(async () => card.result.current.enterTool());

    // A narrower range than the stored one is a trim worth saving.
    await act(async () => fireEvent.press(screen.getByLabelText('sections.trimStartLater')));
    await act(async () => fireEvent.press(screen.getByTestId('section-trim-confirm')));

    expect(mockBoundsEdit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'trim', sectionId: 'orchard-climb', startIndex: 1 })
    );
    expect(present).toHaveBeenLastCalledWith(MAP_SHEET_PEEK_STOP);
    expect(screen.queryByTestId('map-tool-bar')).toBeNull();
  });

  it('ends the tool on back as Cancel does', async () => {
    const card = await openMap();
    await act(async () => card.result.current.enterTool());

    await act(async () => {
      expect(back.press()).toBe(true);
    });

    expect(present).toHaveBeenLastCalledWith(MAP_SHEET_HALF_STOP);
    expect(screen.queryByTestId('map-tool-bar')).toBeNull();
  });

  it('presents the sheet again at once for a section with no line to edit', async () => {
    mockSection = { ...PLAIN, polyline: [] };
    const card = await openMap();

    await act(async () => card.result.current.enterTool());

    expect(present.mock.calls).toEqual([[null], [MAP_SHEET_HALF_STOP]]);
    expect(screen.queryByTestId('map-tool-bar')).toBeNull();
  });
});
