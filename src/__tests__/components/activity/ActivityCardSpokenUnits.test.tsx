/**
 * Scenario: the feed card and the strength card speak each secondary stat in
 * the card's own label, from the formatter that prints it, and the formatter
 * already writes the unit.
 *
 * Expected behaviour: each stat is spoken with its unit once, and calories
 * carry the kcal every other energy figure in the app uses.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import { StrengthActivityCard } from '@/features/strength/components/StrengthActivityCard';
import { initialiseI18n } from '@/i18n';
import type { Activity } from '@/types';

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

jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));

jest.mock('@/features/activity/components/ActivityMapPreview', () => ({
  ActivityMapPreview: () => null,
}));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

const ride = {
  id: 'r1',
  name: 'Harbour loop',
  type: 'Ride',
  start_date_local: '2026-08-12T07:30:00',
  distance: 42000,
  moving_time: 5400,
  average_heartrate: 142,
  icu_average_watts: 250,
  calories: 820,
  stream_types: [],
} as unknown as Activity;

const lift = {
  ...ride,
  id: 's1',
  name: 'Pull day',
  type: 'WeightTraining',
  distance: 0,
} as unknown as Activity;

const strengthData = { muscles: [], exerciseCount: 3, setCount: 9, totalWeight: 2400 };

const occurrences = (text: string, part: string) => text.split(part).length - 1;

describe.each([
  ['the feed card', 'activity-card-r1', () => render(<ActivityCard activity={ride} />)],
  [
    'the strength card',
    'activity-card-s1',
    () => render(<StrengthActivityCard activity={lift} strengthData={strengthData} />),
  ],
])('%s', (_name, cardId, renderCard) => {
  const cardLabel = () => String(screen.getByTestId(cardId).props.accessibilityLabel);

  it('speaks the heart rate with one unit', async () => {
    await renderCard();
    expect(cardLabel()).toContain('Heart Rate: 142 bpm');
    expect(occurrences(cardLabel(), 'bpm')).toBe(1);
  });

  it('speaks the power with one unit', async () => {
    await renderCard();
    expect(cardLabel()).toContain('Power: 250 W');
    expect(cardLabel().match(/\bW\b/g)).toHaveLength(1);
  });

  it('speaks the calories with one unit, in kcal', async () => {
    await renderCard();
    expect(cardLabel()).toContain('Calories: 820 kcal');
    expect(occurrences(cardLabel(), 'kcal')).toBe(1);
    expect(screen.getByText('820 kcal', { includeHiddenElements: true })).toBeTruthy();
  });
});
