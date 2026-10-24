/**
 * Scenario: at the largest system text sizes the feed card kept its fixed
 * height, with the name pinned to its top and the stats pinned to its bottom,
 * so the two blocks grew into each other and overprinted. The strength card
 * did the same over its muscle diagram.
 *
 * Expected behaviour: past the dense cap the name and the stats sit in the
 * card's flow, above and below a drawing that keeps its height, so nothing
 * placed absolutely can meet them. Below the cap both cards are unchanged.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { configure, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { router } from 'expo-router';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import { StrengthActivityCard } from '@/features/strength/components/StrengthActivityCard';
import { CARD_HEIGHT } from '@/features/activity/lib/cardLayout';
import type { FeedCard } from '@/types';

configure({ defaultIncludeHiddenElements: true });

const mockDimensions = jest.fn();
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => mockDimensions(),
}));

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('@/features/activity/components/ActivityCardContextMenu', () => ({
  ActivityCardContextMenu: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'satellite',
    getTerrain3DMode: () => 'smart',
    getActivityCamera: () => undefined,
    setActivityOverride: jest.fn(),
    clearActivityOverride: jest.fn(),
    hasActivityOverride: () => false,
  }),
}));

jest.mock('@/features/activity/components/ActivityMapPreview', () => {
  const { View } = require('react-native');
  return {
    ActivityMapPreview: () => <View testID="preview-stub" />,
  };
});

jest.mock('@/shared/app/useAthlete', () => ({
  useAthlete: () => ({ data: undefined }),
}));

const LARGEST = 3.57;

const ride = {
  id: 'r1',
  name: 'Harbour lighthouse loop past the breakwater and the old ferry pier',
  sportType: 'Ride',
  startDateLocal: '2026-08-12T07:30:00',
  distance: 84210,
  movingTime: 10840,
  elevationGain: 1290,
  trainingLoad: 120,
  avgHr: 141,
  avgPower: 212,
  calories: 1900,
  hasGps: true,
} as FeedCard;

const lift = {
  id: 's1',
  name: 'Lighthouse keeper circuit',
  sportType: 'WeightTraining',
  startDateLocal: '2026-08-12T07:30:00',
  movingTime: 3600,
  trainingLoad: 40,
  hasGps: false,
} as FeedCard;

const strengthData = { muscles: [], exerciseCount: 3, setCount: 9, totalWeight: 2400 };

function style(node: ReactTestInstance | null) {
  return StyleSheet.flatten(node?.props.style) ?? {};
}

function hostParent(node: ReactTestInstance): ReactTestInstance | null {
  let parent = node.parent;
  while (parent && typeof parent.type !== 'string') parent = parent.parent;
  return parent;
}

/** Every host view from `node` up to the root that pins its own height. */
function fixedHeightAncestors(node: ReactTestInstance): ReactTestInstance[] {
  const fixed: ReactTestInstance[] = [];
  for (let at = hostParent(node); at; at = hostParent(at)) {
    if (typeof style(at).height === 'number') fixed.push(at);
  }
  return fixed;
}

function at(fontScale: number) {
  mockDimensions.mockReturnValue({ width: 390, height: 844, scale: 3, fontScale });
}

describe('the feed card past the dense cap', () => {
  beforeEach(() => at(LARGEST));

  it('lays the name and the stats out in flow, outside any fixed-height box', async () => {
    await render(<ActivityCard activity={ride} />);
    const header = screen.getByTestId('activity-card-r1-header');
    const bottom = screen.getByTestId('activity-card-bottom');

    expect(style(header).position).not.toBe('absolute');
    expect(style(bottom).position).not.toBe('absolute');
    expect(fixedHeightAncestors(header)).toEqual([]);
    expect(fixedHeightAncestors(bottom)).toEqual([]);
  });

  it('keeps the map at the card height between them', async () => {
    await render(<ActivityCard activity={ride} />);
    const map = hostParent(screen.getByTestId('preview-stub'));
    expect(style(map).height).toBe(CARD_HEIGHT);
    expect(fixedHeightAncestors(screen.getByTestId('activity-card-r1-header'))).not.toContain(map);
  });

  it('draws the name in the two-line name owner and the date in the fit owner', async () => {
    await render(<ActivityCard activity={ride} />);
    expect(screen.getByText(ride.name).props.numberOfLines).toBe(2);
    expect(screen.getByText(ride.name).props.ellipsizeMode).toBe('tail');
  });

  it('opens the activity from anywhere on the card', async () => {
    (router.push as jest.Mock).mockClear();
    await render(<ActivityCard activity={ride} />);
    await fireEvent.press(screen.getByTestId('activity-card-r1'));
    expect(router.push).toHaveBeenCalledWith('/activity/r1');
    expect(screen.getByTestId('activity-card-r1').props.accessibilityLabel).toContain(ride.name);
  });
});

describe('the feed card below the dense cap', () => {
  beforeEach(() => at(1));

  it('keeps the name and the stats over a full-height map', async () => {
    await render(<ActivityCard activity={ride} />);
    const header = screen.getByTestId('activity-card-r1-header');
    const bottom = screen.getByTestId('activity-card-bottom');

    expect(style(header).position).toBe('absolute');
    expect(style(bottom).position).toBe('absolute');
    expect(style(hostParent(bottom)).height).toBe(CARD_HEIGHT);
  });
});

describe('the strength card past the dense cap', () => {
  beforeEach(() => at(LARGEST));

  it('lays the name and the stats out in flow, outside any fixed-height box', async () => {
    await render(<StrengthActivityCard activity={lift} strengthData={strengthData} />);
    const header = screen.getByTestId('activity-card-s1-header');
    const bottom = screen.getByTestId('activity-card-s1-bottom');

    expect(style(header).position).not.toBe('absolute');
    expect(style(bottom).position).not.toBe('absolute');
    expect(fixedHeightAncestors(header)).toEqual([]);
    expect(fixedHeightAncestors(bottom)).toEqual([]);
  });

  it('opens the activity from anywhere on the card', async () => {
    (router.push as jest.Mock).mockClear();
    await render(<StrengthActivityCard activity={lift} strengthData={strengthData} />);
    await fireEvent.press(screen.getByTestId('activity-card-s1'));
    expect(router.push).toHaveBeenCalledWith('/activity/s1');
  });
});

describe('the stats row at the foot of the card', () => {
  const passesTouchesThrough = (node: ReactTestInstance) =>
    ['none', 'box-none'].includes(node.props.pointerEvents ?? style(node).pointerEvents);

  it.each([
    ['below the dense cap', 1],
    ['past the dense cap', LARGEST],
  ])('lets a press fall through to the card %s', async (_name, fontScale) => {
    at(fontScale);
    await render(<ActivityCard activity={ride} />);
    expect(passesTouchesThrough(screen.getByTestId('activity-card-bottom'))).toBe(true);
  });

  it.each([
    ['below the dense cap', 1],
    ['past the dense cap', LARGEST],
  ])('lets a press fall through on the strength card %s', async (_name, fontScale) => {
    at(fontScale);
    await render(<StrengthActivityCard activity={lift} strengthData={strengthData} />);
    expect(passesTouchesThrough(screen.getByTestId('activity-card-s1-bottom'))).toBe(true);
  });
});

describe('the strength card below the dense cap', () => {
  beforeEach(() => at(1));

  it('keeps the name and the stats over the fixed-height panel', async () => {
    await render(<StrengthActivityCard activity={lift} strengthData={strengthData} />);
    const header = screen.getByTestId('activity-card-s1-header');
    const bottom = screen.getByTestId('activity-card-s1-bottom');

    expect(style(header).position).toBe('absolute');
    expect(style(bottom).position).toBe('absolute');
    expect(style(hostParent(bottom)).height).toBe(240);
  });
});
