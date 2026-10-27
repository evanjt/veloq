/**
 * Scenario: an athlete whose intervals.icu uses Garmin, with a Garmin key once
 * connected and rides held back, opens the App Tour, What's New after an
 * upgrade, the account settings, the feed and a link to the Garmin connector.
 *
 * Expected behaviour: Garmin is experimental. With its switch off none of
 * these names Garmin or opens the connector, and the link leaves the screen.
 * With the switch on the slide, the row, the card and the screen are there.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

import AccountScreen from '@/app/account';
import GarminConnectorScreen from '@/app/garmin-connector';
import { GarminOfferCard } from '@/features/settings/components/GarminOfferCard';
import { WhatsNewModal } from '@/features/settings/components/whatsNew/WhatsNewModal';
import {
  getAllSlides,
  getTutorialSlides,
  getTutorialSetupSlides,
} from '@/features/settings/components/whatsNew/slides';
import { surfaceShown } from '@/features/settings/lib/experimental';
import { useDebugStore } from '@/features/settings/stores/DebugStore';
import { MapPreferencesProvider } from '@/features/settings/stores/MapPreferencesContext';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { goBack } from '@/shared/app/navigation';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
  removeSetting: jest.fn(async () => {}),
}));

jest.mock('@/shared/app/navigation', () => ({
  ...jest.requireActual('@/shared/app/navigation'),
  navigateTab: jest.fn(),
  navigateTo: jest.fn(),
  goBack: jest.fn(),
}));

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

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@/features/settings/lib/cutoverShowMe', () => ({
  cutoverHasChangesToShow: () => true,
}));
jest.mock('@/shared/native/useActivityCount', () => ({ useActivityCount: () => 3 }));
jest.mock('@/shared/app/useAthlete', () => ({
  ...jest.requireActual('@/shared/app/useAthlete'),
  useAthlete: () => ({ data: { garminSyncsActivities: true } }),
}));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  ...jest.requireActual('@/features/routes/hooks/useEngine'),
  useSectionSummaries: () => ({ summaries: [{ id: 'col-du-test' }] }),
  useGroupSummaries: () => ({ summaries: [{ groupId: 'harbour-loop' }] }),
}));
jest.mock('@/features/settings/hooks/useGarminConnectorState', () => ({
  useGarminConnectorState: () => 'connected',
}));
jest.mock('@/features/settings/components/ProfileAccountSection', () => ({
  ProfileAccountSection: () => null,
}));
jest.mock('@/features/settings/hooks/useGarminOffer', () => ({
  ...jest.requireActual('@/features/settings/hooks/useGarminOffer'),
  useGarminOffer: () => ({ offer: { count: 4 }, holdsAsk: true, decline: jest.fn() }),
}));
jest.mock('@/features/settings/components/GarminConnector', () => {
  const { Text } = require('react-native');
  return { GarminConnector: () => <Text testID="garmin-connector-body">garmin.title</Text> };
});

const GARMIN_SLIDE_TITLE = 'whatsNew.tutorial.garminTitle';
const ALL = { includeHiddenElements: true };

function setGarmin(on: boolean) {
  useDebugStore.setState({
    experimentalEnabled: on,
    experimentalUnlocked: on,
    experimentalFeatures: { garminUpdate: on },
  });
}

async function openTour(mode: 'tutorial' | 'whatsNew', lastSeenVersion: string | null) {
  useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
  useWhatsNewStore.setState({
    isLoaded: true,
    lastSeenVersion,
    tourState: null,
    launchModal: null,
  });
  await render(
    <MapPreferencesProvider>
      <WhatsNewModal />
    </MapPreferencesProvider>
  );
  await act(async () => {
    useWhatsNewStore.getState().startTour(mode);
  });
}

const TOURS = [
  { name: 'the App Tour', mode: 'tutorial', lastSeenVersion: null },
  { name: "What's New for an upgrader", mode: 'whatsNew', lastSeenVersion: '0.3.8' },
  { name: 'every feature', mode: 'whatsNew', lastSeenVersion: '0.0.1' },
] as const;

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ isDemoMode: false });
});

describe('the Garmin slide', () => {
  it('declares the Garmin experimental feature wherever it is registered', () => {
    const garmin = [...getAllSlides(), ...getTutorialSlides()].filter(
      (slide) => slide.setup === 'garmin' || slide.showMeRoute === '/garmin-connector'
    );
    expect(garmin.length).toBeGreaterThan(0);
    for (const slide of garmin) expect(slide.experimental).toBe('garminUpdate');
  });

  it('is no setup slide the tour offer can owe while the switch is off', () => {
    const off = { experimentalEnabled: false, experimentalFeatures: {} };
    const unchosen = { experimentalEnabled: true, experimentalFeatures: {} };
    const on = { experimentalEnabled: true, experimentalFeatures: { garminUpdate: true } };
    expect(getTutorialSetupSlides((slide) => surfaceShown(off, slide))).not.toContain('garmin');
    expect(getTutorialSetupSlides((slide) => surfaceShown(unchosen, slide))).not.toContain(
      'garmin'
    );
    expect(getTutorialSetupSlides((slide) => surfaceShown(on, slide))).toContain('garmin');
  });

  it.each(TOURS)('is absent from $name while the switch is off', async (tour) => {
    setGarmin(false);
    await openTour(tour.mode, tour.lastSeenVersion);
    expect(screen.getByTestId('whats-new-card')).toBeTruthy();
    expect(screen.queryByText(GARMIN_SLIDE_TITLE, ALL)).toBeNull();
  });

  it.each(TOURS)('is in $name while the switch is on', async (tour) => {
    setGarmin(true);
    await openTour(tour.mode, tour.lastSeenVersion);
    expect(screen.queryByText(GARMIN_SLIDE_TITLE, ALL)).not.toBeNull();
  });

  it('is absent while the master switch is on and the Garmin entry is off', async () => {
    useDebugStore.setState({
      experimentalEnabled: true,
      experimentalFeatures: { garminUpdate: false },
    });
    await openTour('tutorial', null);
    expect(screen.queryByText(GARMIN_SLIDE_TITLE, ALL)).toBeNull();
  });
});

describe('the master switch alone', () => {
  beforeEach(() => {
    useDebugStore.setState({
      experimentalEnabled: true,
      experimentalUnlocked: true,
      experimentalFeatures: {},
    });
  });

  it('shows no Garmin slide in the tour', async () => {
    await openTour('tutorial', null);
    expect(screen.queryByText(GARMIN_SLIDE_TITLE, ALL)).toBeNull();
  });

  it('shows no account row, offer card or connector', async () => {
    await render(<AccountScreen />);
    expect(screen.queryByTestId('settings-nav-garmin', ALL)).toBeNull();
    await render(<GarminOfferCard />);
    expect(screen.queryByTestId('garmin-offer-card', ALL)).toBeNull();
    await render(<GarminConnectorScreen />);
    expect(screen.queryByTestId('garmin-connector-body', ALL)).toBeNull();
  });
});

describe('the account settings', () => {
  it('hold no Garmin row while the switch is off', async () => {
    setGarmin(false);
    await render(<AccountScreen />);
    expect(screen.queryByTestId('settings-nav-garmin', ALL)).toBeNull();
    expect(screen.queryByText('garmin.title', ALL)).toBeNull();
  });

  it('keep the demo banner switch alone in a demo while the switch is off', async () => {
    setGarmin(false);
    useAuthStore.setState({ isDemoMode: true });
    await render(<AccountScreen />);
    expect(screen.getByTestId('hide-demo-banner-switch')).toBeTruthy();
    expect(screen.queryByTestId('settings-nav-garmin', ALL)).toBeNull();
  });

  it('hold the Garmin row while the switch is on', async () => {
    setGarmin(true);
    await render(<AccountScreen />);
    expect(screen.getByTestId('settings-nav-garmin')).toBeTruthy();
  });
});

describe('the feed', () => {
  it('carries no Garmin offer card while the switch is off', async () => {
    setGarmin(false);
    await render(<GarminOfferCard />);
    expect(screen.queryByTestId('garmin-offer-card', ALL)).toBeNull();
  });

  it('carries the Garmin offer card while the switch is on', async () => {
    setGarmin(true);
    await render(<GarminOfferCard />);
    expect(screen.getByTestId('garmin-offer-card')).toBeTruthy();
  });
});

describe('a link to the Garmin connector', () => {
  it('leaves at once and renders no connector while the switch is off', async () => {
    setGarmin(false);
    await render(<GarminConnectorScreen />);
    expect(screen.queryByTestId('garmin-connector-body', ALL)).toBeNull();
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('opens the connector while the switch is on', async () => {
    setGarmin(true);
    await render(<GarminConnectorScreen />);
    expect(screen.getByTestId('garmin-connector-body')).toBeTruthy();
    expect(goBack).not.toHaveBeenCalled();
  });
});
