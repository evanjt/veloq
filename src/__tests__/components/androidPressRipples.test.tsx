/**
 * Scenario: on Android a feed card is pressed, and a scrim behind a sheet or
 * the tour is tapped to dismiss it.
 *
 * Expected behaviour: the card's ripple is drawn over its opaque ground rather
 * than under it, and the card does not shrink or dim, so it presses like every
 * other surface. A dismissing scrim draws no ripple at all.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import { SectionChooser } from '@/features/maps/components/regional/SectionChooser';
import { WhatsNewModal } from '@/features/settings/components/whatsNew/WhatsNewModal';
import { MapPreferencesProvider } from '@/features/settings/stores/MapPreferencesContext';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { StrengthActivityCard } from '@/features/strength/components/StrengthActivityCard';
import { useAuthStore } from '@/shared/app/AuthStore';
import type { Activity } from '@/types';

jest.mock('react-native/Libraries/Utilities/Platform', () => {
  const actual = jest.requireActual('react-native/Libraries/Utilities/Platform');
  return {
    ...actual,
    __esModule: true,
    default: {
      ...actual.default,
      OS: 'android',
      select: (spec: Record<string, unknown>) =>
        'android' in spec ? spec.android : 'native' in spec ? spec.native : spec.default,
    },
  };
});
// expo-notifications throws on import on Android when it takes the runtime
// for Expo Go, which is what Jest looks like to it.
jest.mock('expo', () => ({ ...jest.requireActual('expo'), isRunningInExpoGo: () => false }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
  removeSetting: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/components/whatsNew/WhatsNewSlide', () => ({
  WhatsNewSlide: () => null,
}));
jest.mock('@/features/activity/components/ActivityMapPreview', () => {
  const { View } = require('react-native');
  return { ActivityMapPreview: () => <View testID="preview-stub" /> };
});
jest.mock('react-native-body-highlighter', () => ({
  ...jest.requireActual('react-native-body-highlighter'),
  __esModule: true,
  default: () => null,
}));

const ride = {
  id: 'r1',
  name: 'Orchard lap',
  type: 'Ride',
  start_date_local: '2026-08-12T07:30:00',
  distance: 42000,
  moving_time: 5400,
  total_elevation_gain: 400,
} as Activity;

const lifting = {
  id: 'w1',
  name: 'Barn lifts',
  type: 'WeightTraining',
  start_date_local: '2026-08-12T07:30:00',
  distance: 0,
  moving_time: 2400,
} as Activity;

function withProviders(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MapPreferencesProvider>{ui}</MapPreferencesProvider>
    </QueryClientProvider>
  );
}

/** A composite that takes the press, as `Pressable` is above its host view. */
const takesPress = (n: ReactTestInstance) =>
  typeof n.type !== 'string' && typeof n.props.onPress === 'function' && 'style' in n.props;

function pressableAt(node: ReactTestInstance): ReactTestInstance {
  let at: ReactTestInstance | null = node;
  while (at && !takesPress(at)) at = at.parent;
  if (!at) throw new Error('no Pressable above the node');
  return at;
}

/** The presses filling their parent, which is what a scrim is. */
function scrimsIn(root: ReactTestInstance): ReactTestInstance[] {
  return root
    .findAll(takesPress)
    .filter((p) => StyleSheet.flatten(resolved(p))?.position === 'absolute');
}

/** Every transform on the node or on anything that holds it. */
function transformsAbove(node: ReactTestInstance): unknown[] {
  const found: unknown[] = [];
  for (let at: ReactTestInstance | null = node; at; at = at.parent) {
    const style = typeof at.props.style === 'function' ? undefined : at.props.style;
    const flat = StyleSheet.flatten(style);
    if (flat?.transform) found.push(flat.transform);
    if (flat?.opacity !== undefined && flat.opacity < 1) found.push({ opacity: flat.opacity });
  }
  return found;
}

describe('a feed card pressed on Android', () => {
  it('draws the ripple of a card with no map over its opaque ground', () => {
    withProviders(<ActivityCard activity={ride} />);
    const press = pressableAt(screen.getByTestId('activity-card-r1'));

    expect(press.props.android_ripple).toEqual(expect.objectContaining({ foreground: true }));
  });

  it('neither shrinks nor dims a card with no map while held', () => {
    withProviders(<ActivityCard activity={ride} />);
    const card = screen.getByTestId('activity-card-r1');

    fireEvent(card, 'pressIn');

    expect(transformsAbove(screen.getByTestId('activity-card-r1-container'))).toEqual([]);
  });

  it('neither shrinks nor dims a card with a map while held', () => {
    withProviders(<ActivityCard activity={{ ...ride, stream_types: ['latlng'] } as Activity} />);

    fireEvent(screen.getByTestId('activity-card-r1'), 'pressIn');

    expect(transformsAbove(screen.getByTestId('activity-card-r1-container'))).toEqual([]);
  });

  it('neither shrinks nor dims a strength card while held', () => {
    withProviders(
      <StrengthActivityCard
        activity={lifting}
        strengthData={{ muscles: [], exerciseCount: 3, setCount: 9, totalWeight: 0 }}
      />
    );
    const card = screen.getByTestId('activity-card-w1');

    fireEvent(card, 'pressIn');

    expect(transformsAbove(card)).toEqual([]);
  });
});

describe('a dismissing scrim on Android', () => {
  it('draws no ripple behind the section chooser', () => {
    render(<SectionChooser sections={[]} onSelect={jest.fn()} onClose={jest.fn()} />);
    const scrims = scrimsIn(screen.getByTestId('section-chooser'));

    expect(scrims.length).toBeGreaterThan(0);
    for (const scrim of scrims) expect(scrim.props.android_ripple).toBeUndefined();
  });

  it('draws no ripple behind the tour', () => {
    useWhatsNewStore.setState({ isLoaded: true, lastSeenVersion: null, tourState: null });
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
    const view = withProviders(<WhatsNewModal />);
    const scrims = scrimsIn(view.UNSAFE_root);

    expect(scrims.length).toBeGreaterThan(0);
    for (const scrim of scrims) expect(scrim.props.android_ripple).toBeUndefined();
  });
});

function resolved(p: ReactTestInstance) {
  const style = p.props.style;
  return typeof style === 'function' ? style({ pressed: false }) : style;
}
