/**
 * Scenario: the App Tour or What's New is open over a library holding
 * activities, sections and routes, with every slide's own picture mounted, and
 * the athlete reaches a slide and taps Show Me, or taps a choice on the map
 * slide itself.
 *
 * Expected behaviour: Show Me only opens its screen. Mounting a slide, moving
 * through the tour and Show Me write no setting; the only key the tour stores
 * is its own seen marker. A choice the athlete taps on the map slide is saved.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { MapPreferencesSlide } from '@/features/settings/components/whatsNew/MapPreferencesSlide';
import { WhatsNewModal } from '@/features/settings/components/whatsNew/WhatsNewModal';
import {
  getAllSlides,
  getTutorialSlides,
  type WhatsNewSlideDefinition,
} from '@/features/settings/components/whatsNew/slides';
import { resolveShowMeRoute } from '@/features/settings/lib/tourShowMe';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import {
  MapPreferencesProvider,
  useMapPreferences,
} from '@/features/settings/stores/MapPreferencesContext';
import { useAuthStore } from '@/shared/app/AuthStore';
import { navigateTab } from '@/shared/app/navigation';
import { getSetting, setSetting } from '@/shared/storage';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
  removeSetting: jest.fn(async () => {}),
}));

jest.mock('@/shared/app/navigation', () => ({
  ...jest.requireActual('@/shared/app/navigation'),
  navigateTab: jest.fn(),
}));

// The drawn slide pictures mount as empty shapes; what they draw is not under test.
jest.mock('@shopify/react-native-skia', () => {
  const { View } = require('react-native');
  const Nothing = () => null;
  return {
    Skia: { Path: { MakeFromSVGString: () => ({}) } },
    Canvas: View,
    RoundedRect: Nothing,
    Rect: Nothing,
    Path: Nothing,
    Circle: Nothing,
    Line: Nothing,
    DashPathEffect: Nothing,
    vec: (x: number, y: number) => ({ x, y }),
  };
});

// A library with something behind every Show Me, which otherwise waits for it.
jest.mock('@/features/settings/lib/cutoverShowMe', () => ({
  cutoverHasChangesToShow: () => true,
}));
jest.mock('@/shared/native/useActivityCount', () => ({ useActivityCount: () => 3 }));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  ...jest.requireActual('@/features/routes/hooks/useEngine'),
  useSectionSummaries: () => ({ summaries: [{ id: 'col-du-test' }] }),
  useGroupSummaries: () => ({ summaries: [{ groupId: 'harbour-loop' }] }),
}));
const LIBRARY = {
  hasActivities: true,
  sectionId: 'col-du-test',
  routeId: 'harbour-loop',
  cutoverChanged: true,
};

const mockGetSetting = getSetting as jest.Mock;
const mockSetSetting = setSetting as jest.Mock;
const mockNavigateTab = navigateTab as jest.Mock;

const SEEN_KEY = 'veloq-whats-new-seen';
const STORED_MAP_PREFERENCES = JSON.stringify({
  defaultStyle: 'dark',
  activityTypeStyles: {},
  terrain3DMode: 'off',
});

/** Every setting written, other than the tour's own seen marker. */
function settingsWritten(): [string, string][] {
  return mockSetSetting.mock.calls.filter(([key]) => key !== SEEN_KEY);
}

type Preferences = ReturnType<typeof useMapPreferences>;
let current: Preferences | null = null;
function see(value: Preferences) {
  current = value;
}
function Probe({ onValue }: { onValue: (value: Preferences) => void }) {
  onValue(useMapPreferences());
  return null;
}

beforeEach(() => {
  current = null;
  mockSetSetting.mockClear();
  mockNavigateTab.mockClear();
  mockGetSetting.mockImplementation(async (key: string) =>
    key === 'veloq-map-preferences' ? STORED_MAP_PREFERENCES : null
  );
});

function withShowMe(slides: WhatsNewSlideDefinition[]) {
  return slides
    .map((slide, index) => ({ route: resolveShowMeRoute(slide, LIBRARY), index }))
    .filter((entry): entry is { route: string; index: number } => entry.route !== undefined);
}

// No seen version opens the App Tour; a version before every release opens What's New on all of them.
const TOURS = [
  { mode: 'tutorial', lastSeenVersion: null, shows: withShowMe(getTutorialSlides()) },
  { mode: 'whatsNew', lastSeenVersion: '0.0.1', shows: withShowMe(getAllSlides()) },
] as const;

describe.each(TOURS)('Show Me on each $mode slide', ({ mode, lastSeenVersion, shows }) => {
  it('offers Show Me on more than the map slide', () => {
    expect(shows.length).toBeGreaterThan(1);
  });

  it.each(shows)('opens $route and writes no setting', async ({ route, index }) => {
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
    useWhatsNewStore.setState({ isLoaded: true, lastSeenVersion, tourState: null });
    render(
      <MapPreferencesProvider>
        <Probe onValue={see} />
        <WhatsNewModal />
      </MapPreferencesProvider>
    );
    await waitFor(() => expect(current?.isLoaded).toBe(true));
    expect(useWhatsNewStore.getState().tourState?.mode).toBe(mode);

    for (let step = 0; step < index; step++) {
      await act(async () => {
        fireEvent.press(screen.getByText('whatsNew.nextButton'));
      });
    }
    await act(async () => {
      fireEvent.press(screen.getByText('whatsNew.showMeButton'));
    });

    expect(mockNavigateTab).toHaveBeenCalledWith(route);
    expect(useWhatsNewStore.getState().tourState?.exploring).toBeTruthy();
    expect(current!.preferences.defaultStyle).toBe('dark');
    expect(current!.preferences.terrain3DMode).toBe('off');
    expect(settingsWritten()).toEqual([]);
  });
});

describe('a choice tapped on the tour map slide', () => {
  async function renderSlide() {
    render(
      <MapPreferencesProvider>
        <Probe onValue={see} />
        <MapPreferencesSlide />
      </MapPreferencesProvider>
    );
    await waitFor(() => expect(current?.isLoaded).toBe(true));
  }

  function savedPreferences(): { defaultStyle: string; terrain3DMode: string } {
    const writes = mockSetSetting.mock.calls.filter(([key]) => key === 'veloq-map-preferences');
    expect(writes.length).toBeGreaterThan(0);
    return JSON.parse(writes[writes.length - 1][1]);
  }

  it('saves the 3D mode the athlete taps', async () => {
    await renderSlide();
    expect(settingsWritten()).toEqual([]);

    await act(async () => {
      fireEvent.press(screen.getByText('settings.terrain3DAlways'));
    });

    expect(current!.preferences.terrain3DMode).toBe('always');
    expect(savedPreferences()).toMatchObject({ defaultStyle: 'dark', terrain3DMode: 'always' });
  });

  it('saves the map style the athlete taps', async () => {
    await renderSlide();
    expect(settingsWritten()).toEqual([]);

    await act(async () => {
      fireEvent.press(screen.getByText('settings.satellite'));
    });

    expect(current!.preferences.defaultStyle).toBe('satellite');
    expect(savedPreferences()).toMatchObject({ defaultStyle: 'satellite', terrain3DMode: 'off' });
  });
});
