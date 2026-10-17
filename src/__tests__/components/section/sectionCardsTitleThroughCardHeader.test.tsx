/**
 * Scenario: three section cards drew their title by hand, each with a copied
 * card title style and its own dark colour override.
 * Expected behaviour: each titles itself through the one card header, so the
 * title is that header's node, carries the header role, and takes the primary
 * text colour of the theme on screen.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { SectionCorrelationCard } from '@/features/routes/components/section/SectionCorrelationCard';
import { SectionEfficiencyCard } from '@/features/routes/components/section/SectionEfficiencyCard';
import { SectionHistoryPanel } from '@/features/routes/components/section/SectionHistoryPanel';
import { colors, darkColors } from '@/theme';
import type { EfficiencyTrend, FfiCorrelation, FfiSectionCorrelation } from 'veloqrs';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    FfiCorrelation_Tags: {
      TooFew: 'TooFew',
      Undefined: 'Undefined',
      Inconclusive: 'Inconclusive',
      Mover: 'Mover',
    },
  })
);

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

let mockIsDark = false;
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: mockIsDark }),
}));

afterEach(() => {
  mockIsDark = false;
});

const trend = {
  sectionId: 'sec-1',
  sectionName: 'Lantern Rise',
  sportType: 'Ride',
  points: [
    { date: 86_400, paceSecsPerKm: 240, avgHr: 150, hrPaceRatio: 0.64 },
    { date: 172_800, paceSecsPerKm: 238, avgHr: 148, hrPaceRatio: 0.62 },
  ],
  trendSlope: -0.0004,
  direction: 0,
  hrChangeBpm: -2,
  effortCount: 2,
} as EfficiencyTrend;

const correlations: FfiSectionCorrelation[] = [
  {
    direction: 'same',
    variable: 'hrv',
    result: { tag: 'Mover', inner: { r: 0.5, n: 12, low: 0.1, high: 0.8 } } as FfiCorrelation,
    familySize: 1,
  },
];

const cards = (isDark: boolean) => [
  {
    testID: 'section-efficiency-card',
    title: 'sections.aerobicEfficiency',
    element: <SectionEfficiencyCard trend={trend} isDark={isDark} />,
  },
  {
    testID: 'section-correlation-card',
    title: 'sections.correlationTitle',
    element: <SectionCorrelationCard correlations={correlations} floor={8} isDark={isDark} />,
  },
  {
    testID: 'section-history-panel',
    title: 'sectionHistory.title',
    element: (
      <SectionHistoryPanel
        isDark={isDark}
        history={[]}
        versions={[]}
        pinnedVersion={null}
        shownVersion={null}
        onShowVersion={jest.fn()}
        onRevert={jest.fn()}
        onUnpin={jest.fn()}
      />
    ),
  },
];

describe.each([
  ['light', false, colors.textPrimary],
  ['dark', true, darkColors.textPrimary],
])('section card titles in %s', (_theme, isDark, primary) => {
  it.each(cards(isDark).map((c) => [c.testID, c] as const))(
    '%s titles itself through the card header',
    async (_id, card) => {
      mockIsDark = isDark;
      const { getByTestId, getAllByRole } = await render(card.element);
      const title = getByTestId(`${card.testID}-header-title`);
      expect(title.props.accessibilityRole).toBe('header');
      expect(title.props.children).toBe(card.title);
      expect(StyleSheet.flatten(title.props.style).color).toBe(primary);
      expect(getAllByRole('header')).toHaveLength(1);
    }
  );
});

it('keeps the unpin control in the history panel header', async () => {
  const { getByTestId } = await render(
    <SectionHistoryPanel
      isDark={false}
      history={[]}
      versions={[]}
      pinnedVersion={2}
      shownVersion={null}
      onShowVersion={jest.fn()}
      onRevert={jest.fn()}
      onUnpin={jest.fn()}
    />
  );
  expect(getByTestId('section-history-panel-header')).toContainElement(
    getByTestId('section-history-unpin')
  );
});
