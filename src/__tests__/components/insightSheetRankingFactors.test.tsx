/**
 * Scenario: an insight card was chosen by the engine's ranking. A section trend
 * card listed five percentages among the athlete's own measurements, and a card
 * that carries a ranking but no methodology text, such as a section change, had
 * no explanation at all because the sheet's content gates skipped it.
 *
 * Expected behaviour: the sheet shows one "why this card was chosen" group
 * whenever the insight carries a ranking, whatever its category and whether or
 * not it has other methodology text. The group never shows the composite
 * relevance, shows the change as a signed percentage and the other factors as
 * scores on a 0 to 1 scale, and an insight without a ranking shows no group.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { changeLanguage, initializeI18n } from '@/i18n';
import { InsightDetailSheet } from '@/features/insights/components/InsightDetailSheet';
import type { Insight } from '@/types';
import type { SectionRankingScores } from '@/features/insights/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/features/insights/components/content/InsightDetailContent', () => ({
  InsightDetailContent: () => null,
}));

const ranking = (extra: Partial<SectionRankingScores> = {}): SectionRankingScores => ({
  relevance: 0.91,
  recency: 0.8,
  improvement: 0.57,
  anomaly: 0.25,
  engagement: 0.3,
  improvementChange: 0.14,
  improvementBasis: 0,
  ...extra,
});

function insight(overrides: Partial<Insight> = {}, scores?: SectionRankingScores): Insight {
  return {
    id: 'i1',
    category: 'section_changed',
    priority: 1,
    title: 'Climb',
    icon: 'history',
    iconTone: 'info',
    timestamp: 0,
    isNew: false,
    meta: { sectionId: 's1', ...(scores ? { ranking: scores } : {}) },
    ...overrides,
  } as Insight;
}

const sheet = (i: Insight) =>
  render(<InsightDetailSheet insight={i} visible onClose={() => undefined} />);

describe('the ranking factors group on an insight sheet', () => {
  beforeAll(() => initializeI18n('en-GB'));
  beforeEach(() => changeLanguage('en-GB'));

  it('shows on a ranking-only insight with no methodology text', () => {
    sheet(insight({}, ranking()));
    expect(screen.getAllByTestId('ranking-factors')).toHaveLength(1);
    expect(screen.getByText('Card ranking')).toBeTruthy();
  });

  it('shows once on a trend insight that has methodology text', () => {
    sheet(
      insight(
        {
          category: 'section_trend',
          methodology: { name: 'Trend', description: 'Tracks median performance.' },
        },
        ranking()
      )
    );
    expect(screen.getAllByTestId('ranking-factors')).toHaveLength(1);
    expect(screen.getByText('Tracks median performance.')).toBeTruthy();
  });

  it('shows on a non-trend insight with methodology text', () => {
    sheet(
      insight(
        { category: 'section_pr', methodology: { name: 'PR', description: 'Compares times.' } },
        ranking()
      )
    );
    expect(screen.getAllByTestId('ranking-factors')).toHaveLength(1);
  });

  it('shows no group without a ranking', () => {
    sheet(
      insight({ category: 'section_pr', methodology: { name: 'PR', description: 'Compares.' } })
    );
    expect(screen.queryByTestId('ranking-factors')).toBeNull();
  });

  it('shows nothing at all for a ranking-free insight with no methodology', () => {
    sheet(insight());
    expect(screen.queryByTestId('methodology-section')).toBeNull();
  });

  it('never shows the composite relevance', () => {
    sheet(insight({}, ranking()));
    expect(screen.queryByText(/relevance/i)).toBeNull();
    expect(screen.queryByText(/0\.91/)).toBeNull();
  });

  it('labels the three bounded factors as scores on a 0 to 1 scale', () => {
    sheet(insight({}, ranking()));
    expect(screen.getByTestId('ranking-factor-recency')).toHaveTextContent(/0\.80/);
    expect(screen.getByTestId('ranking-factor-anomaly')).toHaveTextContent(/0\.25/);
    expect(screen.getByTestId('ranking-factor-engagement')).toHaveTextContent(/0\.30/);
    expect(screen.getByTestId('ranking-factor-recency')).toHaveTextContent(/0 to 1/);
  });

  it.each([
    [0.14, '+14%'],
    [0, '0%'],
    [-0.14, '-14%'],
    [-1.5, '-150%'],
  ])('shows a change of %p as %s', (change, text) => {
    sheet(insight({}, ranking({ improvementChange: change })));
    expect(screen.getByTestId('ranking-factor-value-improvement')).toHaveTextContent(text, {
      exact: true,
    });
    expect(screen.getByTestId('ranking-factor-improvement')).not.toHaveTextContent(/0 to 1/);
  });

  it('states the comparison basis for each kind of change', () => {
    sheet(insight({}, ranking({ improvementBasis: 0 })));
    expect(screen.getByTestId('ranking-factor-improvement')).toHaveTextContent(/previous three/);
  });

  it('states the first-to-last basis', () => {
    sheet(insight({}, ranking({ improvementBasis: 1 })));
    expect(screen.getByTestId('ranking-factor-improvement')).toHaveTextContent(/first/);
  });

  it('says unavailable when the engine compared nothing', () => {
    const { improvementChange: _c, improvementBasis: _b, ...bare } = ranking();
    sheet(insight({}, bare));
    const row = screen.getByTestId('ranking-factor-improvement');
    expect(row).toHaveTextContent(/Not enough valid comparison data/);
    expect(row).not.toHaveTextContent('%');
  });

  it('draws in the athlete language under de-DE', async () => {
    await changeLanguage('de-DE');
    sheet(insight({}, ranking()));
    const group = screen.getByTestId('ranking-factors');
    expect(group).not.toHaveTextContent(/Why this card/);
    expect(group).not.toHaveTextContent(/Higher scores/);
    expect(screen.getByTestId('ranking-factor-recency')).toHaveTextContent(/0,80/);
  });
});
