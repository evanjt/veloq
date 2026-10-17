/**
 * Scenario: screens and sections drew their own card containers, on the page
 * surface rather than the card surface, at their own radius, and some with a
 * hairline edge, so two cards side by side in the dark theme differed.
 *
 * Expected behaviour: in the dark theme every card container draws Card's
 * ground: the card surface, the card radius, and no edge but the raised one.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import NamedCorridorsScreen from '@/app/named-corridors';
import SectionRetiredScreen from '@/app/section-retired';
import { StrengthBalanceView } from '@/features/strength/components/StrengthBalanceView';
import { ExplanationCard } from '@/shared/ui/ExplanationCard';
import { ActivityCardSkeleton } from '@/shared/ui/Shimmer';
import type { StrengthBalancePair } from '@/types';

import { strayCardGrounds } from '../__shared__/cardGrounds';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: true, colors: { text: '#fff', textSecondary: '#aaa' } }),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('@/features/routes/hooks/useNamedCorridors', () => ({
  useNamedCorridors: () => ({
    state: 'ready',
    remove: () => true,
    corridors: [
      {
        intentId: 'intent-1',
        name: 'The river climb',
        footprint: [
          { latitude: 46.5, longitude: 7.1 },
          { latitude: 46.6, longitude: 7.2 },
        ],
        sportType: 'Ride',
        createdAt: '2026-08-01 09:00:00',
        sectionId: 'sec-1',
        coverage: 0.82,
        primary: true,
        dormant: false,
      },
    ],
  }),
}));
jest.mock('@/features/routes/hooks/useSectionDisplayNames', () => ({
  useSectionDisplayNames: () => ({ 'sec-1': 'Section 4' }),
}));
jest.mock('@/features/routes/lib/sectionDisplayNames', () => ({
  getAllSectionDisplayNames: () => ({ 'sec-2': 'Church Hill' }),
}));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    subscribe: () => () => undefined,
    getRetiredSections: () => [
      {
        sectionId: 'sec-2',
        kind: 'merged',
        at: '2026-08-01 10:00:00',
        versions: [],
        into: 'sec-3',
      },
      { sectionId: 'sec-4', kind: 'dropped', at: '2026-08-02 10:00:00', versions: [] },
    ],
  }),
  isEngineReady: () => true,
}));

const PAIR: StrengthBalancePair = {
  id: 'push-pull',
  label: 'Push / pull',
  leftSlug: 'chest',
  rightSlug: 'back',
  leftLabel: 'Chest',
  rightLabel: 'Back',
  leftWeightedSets: 12,
  rightWeightedSets: 10,
  dominantSlug: 'chest',
  dominantLabel: 'Chest',
  ratio: 1.2,
  status: 'balanced',
};

const SUBJECTS: [string, () => React.ReactElement][] = [
  ['the names you gave', () => <NamedCorridorsScreen />],
  ['the retired sections', () => <SectionRetiredScreen />],
  [
    'the strength balance',
    () => (
      <StrengthBalanceView
        visibleBalancePairs={[PAIR]}
        featuredBalancePair={PAIR}
        periodLabel="4 weeks"
      />
    ),
  ],
  [
    'an explanation',
    () => <ExplanationCard title="How it works" rows={[{ key: 'a', text: 'A line.' }]} />,
  ],
  ['the activity card skeleton', () => <ActivityCardSkeleton />],
];

describe('card containers in the dark theme', () => {
  it.each(SUBJECTS)('%s draws every card on the card ground', async (_name, subject) => {
    const view = await render(subject());
    expect(strayCardGrounds(view.UNSAFE_root)).toEqual([]);
  });
});
