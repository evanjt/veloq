/**
 * Scenario: a section PR sheet and a section trend sheet hid View in detail on
 * the claim that their content carried its own link to the section. Neither
 * did: the PR content has no link at all, and the trend rows' name became the
 * accordion toggle, so from either sheet the section screen was unreachable.
 *
 * Expected behaviour: the PR sheet's one control to its section, the data link
 * under How was this calculated, opens the section the record was set on, and
 * an expanded trend row opens its own section.
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

  it('opens the PR section from the data link', async () => {
    await render(<InsightDetailSheet insight={prInsight} onClose={() => undefined} />);

    await fireEvent.press(screen.getByTestId('methodology-toggle'));
    await fireEvent.press(screen.getByTestId('insight-data-link'));

    expect(tapTo).toHaveBeenCalledWith('/section/hill');
  });

  it('opens the section of the trend row that was expanded', async () => {
    await render(<SectionTrendContent insight={trendInsight} />);
    expect(screen.queryByTestId('section-trend-open-flat')).toBeNull();

    await fireEvent.press(screen.getByTestId('section-trend-toggle-flat'));
    await fireEvent.press(screen.getByTestId('section-trend-open-flat'));

    expect(tapTo).toHaveBeenCalledTimes(1);
    expect(tapTo).toHaveBeenCalledWith('/section/flat');
  });

  it('expands a trend row without leaving the sheet', async () => {
    await render(<SectionTrendContent insight={trendInsight} />);

    await fireEvent.press(screen.getByTestId('section-trend-toggle-hill'));

    expect(tapTo).not.toHaveBeenCalled();
    expect(screen.getByTestId('section-trend-open-hill')).toBeTruthy();
  });

  it('exposes one button per trend row, named with what the row draws', () => {
    const insight = {
      ...trendInsight,
      supportingData: {
        sections: [
          {
            sectionId: 'hill',
            sectionName: 'Quarry Hill',
            bestTime: 300,
            sportType: 'Run',
            trend: 1,
            hasRecentPR: true,
            traversalCount: 7,
          },
          { sectionId: 'flat', sectionName: 'River Flat', bestTime: 500, trend: -1 },
          { sectionId: 'weir', sectionName: 'Weir Path', traversalCount: 3, trend: 0 },
        ],
      },
    } as Insight;
    render(<SectionTrendContent insight={insight} />);

    const rows = screen.getAllByRole('button');

    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
      'Quarry Hill (Run), Personal record, 5:00, 7 traversals, improved',
      'River Flat, 8:20, declined',
      'Weir Path, 3 traversals, no change',
    ]);
    expect(rows.map((row) => row.props.testID)).toEqual([
      'section-trend-toggle-hill',
      'section-trend-toggle-flat',
      'section-trend-toggle-weir',
    ]);
    expect(rows.every((row) => row.props.accessibilityState?.expanded === false)).toBe(true);
  });

  it('marks the toggled row as expanded', () => {
    render(<SectionTrendContent insight={trendInsight} />);

    fireEvent.press(screen.getByTestId('section-trend-toggle-hill'));

    expect(screen.getByTestId('section-trend-toggle-hill').props.accessibilityState).toEqual({
      expanded: true,
    });
  });
});
