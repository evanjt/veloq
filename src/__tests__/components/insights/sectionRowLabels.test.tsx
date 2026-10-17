/**
 * Scenario: an insight sheet lists sections as pressable rows, each one
 * accessibility element, so a screen reader hears its label in place of the
 * time, the count and the trend drawn inside it.
 *
 * Expected behaviour: each row's name for a screen reader carries the section
 * with its sport and every value the row draws, and nothing it does not draw.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { changeLanguage, initialiseI18n } from '@/i18n';
import { SupportingDataSection } from '@/features/insights/components/SupportingDataSection';
import { StalePRContent } from '@/features/insights/components/content/StalePRContent';
import type { Insight, InsightSupportingData } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/native/useSectionDetail', () => ({
  useSectionDetail: () => ({ section: null }),
}));

beforeAll(() => initialiseI18n('en-GB'));
beforeEach(() => changeLanguage('en-GB'));

describe('the supporting data section rows', () => {
  function rows(sections: NonNullable<InsightSupportingData['sections']>) {
    render(<SupportingDataSection data={{ sections }} />);
    return screen.getAllByRole('button').map((row) => row.props.accessibilityLabel);
  }

  it('reads the section, its best time, its traversals and its trend word', () => {
    expect(
      rows([
        {
          sectionId: 'weir',
          sectionName: 'Weir Path',
          sportType: 'Run',
          bestTime: 300,
          traversalCount: 6,
          trend: 1,
        },
        { sectionId: 'kiln', sectionName: 'Kiln Rise', bestTime: 125, trend: -1 },
        { sectionId: 'moor', sectionName: 'Moor Gate', traversalCount: 2, trend: 0 },
      ])
    ).toEqual([
      'Weir Path (Run), 5:00, 6 traversals, improved',
      'Kiln Rise, 2:05, declined',
      'Moor Gate, 2 traversals, no change',
    ]);
  });

  it('speaks no trend word for a section with no trend', () => {
    expect(rows([{ sectionId: 'ford', sectionName: 'Ford Lane', bestTime: 61 }])).toEqual([
      'Ford Lane, 1:01',
    ]);
  });
});

describe('the stale PR sheet rows', () => {
  it('reads the section with its sport and the best time it draws', () => {
    const insight = {
      id: 'stale_pr-weir',
      category: 'stale_pr',
      priority: 1,
      title: 'Room to go faster',
      icon: 'lightning-bolt',
      iconTone: 'info',
      timestamp: 0,
      isNew: false,
      supportingData: {
        sections: [
          { sectionId: 'weir', sectionName: 'Weir Path', sportType: 'Ride', bestTime: 372 },
          { sectionId: 'kiln', sectionName: 'Kiln Rise', sportType: 'Ride' },
        ],
      },
    } as Insight;

    render(<StalePRContent insight={insight} />);

    expect(screen.getAllByRole('button').map((row) => row.props.accessibilityLabel)).toEqual([
      'Weir Path (Ride), 6:12',
      'Kiln Rise (Ride)',
    ]);
  });
});
