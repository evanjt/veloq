/**
 * Scenario: a section ridden thirty times at six minutes and run twice at
 * eighteen. A ride PR card opened on a timeline carrying the two run efforts,
 * "32 efforts" and "Faster than 100% of efforts", because the sheet re-read
 * the section's performances with no sport at all.
 *
 * Expected behaviour: both sheets read the performances of the sport the card
 * was raised for, which the row now carries.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { SectionPRContent } from '@/features/insights/components/content/SectionPRContent';
import { SectionTrendContent } from '@/features/insights/components/content/SectionTrendContent';
import type { Insight } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => `t(${key})` }),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useSectionDetail: () => ({ section: { id: 'auto1', sportType: 'Ride', activityPortions: [] } }),
}));

const mockPerformances = jest.fn((_section: unknown, _sportType?: string) => ({
  records: [],
  bestRecord: null,
  isLoading: false,
}));
jest.mock('@/features/routes/hooks/useSectionPerformances', () => ({
  useSectionPerformances: (section: unknown, sportType?: string) =>
    mockPerformances(section, sportType),
}));

function insight(category: 'section_pr' | 'section_trend', sportType?: string): Insight {
  return {
    id: 'i1',
    category,
    priority: 1,
    title: 'Section 6',
    icon: 'trophy-outline',
    iconTone: 'record',
    timestamp: 0,
    isNew: false,
    supportingData: {
      sections: [
        {
          sectionId: 'auto1',
          sectionName: 'Shared Climb',
          bestTime: 300,
          sportType,
          trend: 0,
        },
      ],
    },
  } as Insight;
}

/** The sport the sheet last asked the performance read for. */
function sportAsked(): unknown {
  return mockPerformances.mock.calls.at(-1)?.[1];
}

describe('an insight sheet', () => {
  beforeEach(() => mockPerformances.mockClear());

  it('reads the PR sport the record was set in, not the section own sport', () => {
    render(<SectionPRContent insight={insight('section_pr', 'Run')} />);
    expect(sportAsked()).toBe('Run');
  });

  it('reads the trend sport the accordion row carries', () => {
    const { getByText } = render(<SectionTrendContent insight={insight('section_trend', 'Run')} />);
    getByText('Shared Climb');
    expect(sportAsked()).toBe('Run');
  });

  it('asks for no sport when the row carries none', () => {
    render(<SectionPRContent insight={insight('section_pr')} />);
    expect(mockPerformances).toHaveBeenCalled();
    expect(sportAsked()).toBeUndefined();
  });
});
