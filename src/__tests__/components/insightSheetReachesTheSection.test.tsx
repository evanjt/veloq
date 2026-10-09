/**
 * Scenario: a section PR sheet and a section trend sheet hid View in detail on
 * the claim that their content carried its own link to the section. Neither
 * did: the PR content has no link at all, and the trend rows' name became the
 * accordion toggle, so from either sheet the section screen was unreachable.
 *
 * Expected behaviour: the PR sheet's View in detail opens the section the
 * record was set on, and an expanded trend row opens its own section.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { changeLanguage, initialiseI18n } from '@/i18n';
import { InsightDetailSheet } from '@/features/insights/components/InsightDetailSheet';
import { SectionTrendContent } from '@/features/insights/components/content/SectionTrendContent';
import { tapTo } from '@/shared/app/navigation';
import type { Insight } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ tapTo: jest.fn(), navigateTo: jest.fn() }));
jest.mock('@/features/insights/components/content/SectionPRContent', () => ({
  SectionPRContent: () => null,
}));
jest.mock('@/shared/native/useSectionDetail', () => ({
  useSectionDetail: (id: string | null) => ({
    section: id ? { id, sportTypes: ['Run'], activityPortions: [] } : null,
  }),
}));
jest.mock('@/features/routes/hooks/useSectionPerformances', () => ({
  useSectionPerformances: () => ({
    records: [],
    bests: { forward: null, reverse: null, forwardIsPr: false, reverseIsPr: false },
    isLoading: false,
  }),
}));

const prInsight = {
  id: 'section_pr-hill_run',
  category: 'section_pr',
  priority: 1,
  title: 'New PR on Quarry Hill',
  icon: 'trophy-outline',
  iconTone: 'record',
  timestamp: 0,
  isNew: false,
  navigationTarget: '/section/hill',
} as Insight;

const trendInsight = {
  id: 'section_trend-summary',
  category: 'section_trend',
  priority: 1,
  title: '1 faster, 1 slower',
  icon: 'trending-up',
  iconTone: 'info',
  timestamp: 0,
  isNew: false,
  supportingData: {
    sections: [
      { sectionId: 'hill', sectionName: 'Quarry Hill', bestTime: 300, sportType: 'Run', trend: 1 },
      { sectionId: 'flat', sectionName: 'River Flat', bestTime: 500, sportType: 'Run', trend: -1 },
    ],
  },
} as Insight;

describe('a section insight sheet', () => {
  beforeAll(() => initialiseI18n('en-GB'));
  beforeEach(() => {
    changeLanguage('en-GB');
    jest.mocked(tapTo).mockClear();
  });

  it('opens the PR section from View in detail', () => {
    render(<InsightDetailSheet insight={prInsight} onClose={() => undefined} />);

    fireEvent.press(screen.getByRole('button', { name: 'View in detail' }));

    expect(tapTo).toHaveBeenCalledWith('/section/hill');
  });

  it('opens the section of the trend row that was expanded', () => {
    render(<SectionTrendContent insight={trendInsight} />);
    expect(screen.queryByTestId('section-trend-open-flat')).toBeNull();

    fireEvent.press(screen.getByTestId('section-trend-toggle-flat'));
    fireEvent.press(screen.getByTestId('section-trend-open-flat'));

    expect(tapTo).toHaveBeenCalledTimes(1);
    expect(tapTo).toHaveBeenCalledWith('/section/flat');
  });

  it('expands a trend row without leaving the sheet', () => {
    render(<SectionTrendContent insight={trendInsight} />);

    fireEvent.press(screen.getByTestId('section-trend-toggle-hill'));

    expect(tapTo).not.toHaveBeenCalled();
    expect(screen.getByTestId('section-trend-open-hill')).toBeTruthy();
  });
});
