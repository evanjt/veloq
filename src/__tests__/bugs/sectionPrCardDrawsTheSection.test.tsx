/**
 * Scenario: an athlete reading a PR on "Section 6" in the Insights list has no
 * picture of which stretch of road that is without leaving the card. The
 * engine already hands the section's line over with the record, and only a
 * component no card mounts drew it.
 *
 * Expected behaviour: the list card for a section PR draws the section's line,
 * and a card whose record came with no line draws the card as it was.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { InsightListCard } from '@/features/insights/components/InsightListCard';
import { Card } from '@/shared/ui/Card';
import { generateSectionPRInsights } from '@/features/insights/generators/sectionPR';
import type { SectionPR } from '@/features/insights/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const t = (key: string) => key;

const LINE = [
  { lat: 46.2, lng: 7.35 },
  { lat: 46.21, lng: 7.36 },
  { lat: 46.22, lng: 7.38 },
];

function prCard(previewPoints?: { lat: number; lng: number }[]) {
  const pr = {
    sectionId: 'auto6',
    sectionName: 'Section 6',
    bestTime: 372,
    daysAgo: 2,
    traversalCount: 14,
    sportType: 'Ride',
    recentEfforts: [],
    previewPoints,
  } as unknown as SectionPR;
  const [insight] = generateSectionPRInsights([pr], Date.UTC(2026, 8, 20), t);
  if (!insight) throw new Error('no PR card');
  return insight;
}

describe('the section PR list card', () => {
  it('draws the section the record was set on', () => {
    const { getByTestId, UNSAFE_getByType } = render(
      <InsightListCard insight={prCard(LINE)} onPress={jest.fn()} />
    );

    expect(getByTestId('section-preview-auto6')).toBeTruthy();
    expect(UNSAFE_getByType(Card).props.variant).toBe('raised');
  });

  it('draws no map when the record came with no line', () => {
    const { queryByTestId } = render(<InsightListCard insight={prCard()} onPress={jest.fn()} />);

    expect(queryByTestId('section-preview-auto6')).toBeNull();
  });
});
