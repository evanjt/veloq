/**
 * Scenario: app language de-DE. The section PR sheet said "from previous",
 * "Previous: 5:12 on 3 Sept", "12 efforts", "Faster than 90% of efforts" and
 * "All efforts (12)", the section group sheet "Section group" and its two
 * sentences, and the efforts list "Recent efforts", all as English literals.
 *
 * Expected behaviour: every sentence and label on these sheets is in the
 * athlete's language. The numbers, dates and section names are not checked:
 * they read the same in both.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { changeLanguage, initializeI18n } from '@/i18n';
import { SectionPRContent } from '@/features/insights/components/content/SectionPRContent';
import { SectionTrendContent } from '@/features/insights/components/content/SectionTrendContent';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';
import type { Insight } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/native/useSectionDetail', () => ({
  useSectionDetail: () => ({
    section: { id: 'climb', sportTypes: ['Ride'], activityPortions: [] },
  }),
}));

function record(id: string, bestTime: number, day: number): SectionPerformanceRecord {
  return {
    activityId: id,
    activityName: id,
    activityDate: new Date(Date.UTC(2026, 8, day)),
    laps: [],
    lapCount: 1,
    bestTime,
    bestPace: 5,
    bestForwardTime: bestTime,
    bestReverseTime: null,
    avgTime: bestTime,
    avgPace: 5,
    direction: 'same',
    sectionDistance: 1500,
  };
}

const mockRecords = [
  record('a', 300, 1),
  record('b', 312, 3),
  record('c', 330, 5),
  record('d', 345, 7),
  record('e', 360, 9),
];

jest.mock('@/features/routes/hooks/useSectionPerformances', () => ({
  useSectionPerformances: () => ({
    records: mockRecords,
    bests: { forward: mockRecords[0], reverse: null, forwardIsPr: true, reverseIsPr: false },
    isLoading: false,
  }),
}));

function insight(category: 'section_pr' | 'section_trend', sections: number): Insight {
  return {
    id: 'i1',
    category,
    priority: 1,
    title: 'Climb',
    icon: 'trophy-outline',
    iconTone: 'record',
    timestamp: 0,
    isNew: false,
    supportingData: {
      sections: Array.from({ length: sections }, (_, i) => ({
        sectionId: `climb${i}`,
        sectionName: `Climb ${i}`,
        bestTime: 300,
        sportType: 'Ride',
        trend: -1,
      })),
    },
  } as Insight;
}

function textOf(node: unknown): string[] {
  if (node == null) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(textOf);
  const { children } = node as { children?: unknown[] };
  return [(children ?? []).filter((c) => typeof c === 'string').join('')].concat(
    (children ?? []).filter((c) => typeof c !== 'string').flatMap(textOf)
  );
}

/** A section PR sheet, and a section group sheet with one row opened. */
function sheets(): string[] {
  const pr = render(<SectionPRContent insight={insight('section_pr', 2)} />);
  const prText = textOf(pr.toJSON());
  const group = render(<SectionTrendContent insight={insight('section_trend', 2)} />);
  // The first row's chevron: its sport icon, its trend icon, then the chevron.
  fireEvent.press(group.getAllByTestId('icon')[2]);
  const groupText = textOf(group.toJSON());
  return [...prText, ...groupText].filter((line) => /[A-Za-z]{4,}/.test(line));
}

describe('the section insight sheets', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  afterAll(async () => {
    await changeLanguage('en-AU');
  });

  it('draw no English sentence or label in German', async () => {
    await changeLanguage('en-AU');
    const english = new Set(sheets().filter((line) => !/^Climb \d$/.test(line)));
    expect(english.size).toBeGreaterThan(5);

    await changeLanguage('de-DE');
    const german = sheets();

    expect(german.filter((line) => english.has(line))).toEqual([]);

    // A line that also carries a localised date or number is not equal in the
    // two languages even when its words are English, so the words are checked
    // too. The section names and the month are the same in both.
    const words = (lines: Iterable<string>) =>
      new Set([...lines].flatMap((line) => line.match(/[A-Za-z]{4,}/g) ?? []));
    const shared = new Set(['Climb', 'Sept']);
    const englishWords = words(english);
    expect([...words(german)].filter((w) => englishWords.has(w) && !shared.has(w))).toEqual([]);
  });
});
