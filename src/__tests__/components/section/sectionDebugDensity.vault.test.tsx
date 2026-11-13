/**
 * Scenario: the detector produces a per-point pass count for every section it
 * cuts, and nothing in the app has ever read it.
 *
 * Expected behaviour: the debug panel, which is where section internals are
 * already visible, summarises it, and says nothing rather than zero when the
 * section carries none.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { SectionDebugPanel } from '@/features/routes/components/section/SectionDebugPanel';
import type { FrequentSection } from '@/types';
import { ABSENT } from '@/shared/format/absent';

function section(pointDensity?: number[]): FrequentSection {
  return {
    id: 'sec-1',
    sectionType: 'auto',
    sportTypes: ['Ride'],
    polyline: [
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ],
    distanceMeters: 1000,
    activityIds: ['a1'],
    visitCount: 1,
    createdAt: '2026-01-01T00:00:00Z',
    pointDensity,
  } as FrequentSection;
}

async function densityValue(pointDensity?: number[]): Promise<string> {
  const tree = await render(
    <SectionDebugPanel section={section(pointDensity)} pageMetrics={[]} isDark={false} />
  );
  return tree.getByTestId('debug-value-Density').props.children as string;
}

describe('the section debug panel density row', () => {
  it('summarises the passes as a count and a spread', async () => {
    expect(await densityValue([2, 9, 4, 5])).toBe('4 pts, 2-9, med 4');
  });

  it('reads a single point without inventing a range', async () => {
    expect(await densityValue([7])).toBe('1 pt, 7-7, med 7');
  });

  it('says nothing rather than zero when the section carries none', async () => {
    expect(await densityValue([])).toBe(ABSENT);
    expect(await densityValue(undefined)).toBe(ABSENT);
  });

  it('takes the lower of the two middles on an even count', async () => {
    expect(await densityValue([1, 2, 3, 4])).toBe('4 pts, 1-4, med 2');
  });
});
