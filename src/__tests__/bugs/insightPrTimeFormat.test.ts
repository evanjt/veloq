/**
 * Scenario: an insight card carries a section PR whose best time is not a whole
 * number of seconds, which is every PR the detector interpolates.
 *
 * Expected behaviour: the inline metric reads the time the way the rest of the
 * app does. Rounding the seconds on their own carries 59.7 to 60 and renders
 * "1:60", a time that does not exist.
 */

import { getInlineMetric } from '@/features/insights/lib/inlineMetric';
import type { Insight } from '@/types';

function sectionPr(bestTime: number): Insight {
  return {
    id: 'i-1',
    category: 'section_pr',
    title: 'PR',
    body: '',
    priority: 1,
    supportingData: { sections: [{ sectionId: 's-1', sectionName: 'Climb', bestTime }] },
  } as unknown as Insight;
}

describe('the inline metric on a section PR card', () => {
  it('never renders a sixtieth second', () => {
    // 59.7 s past the minute rounds to 60 on its own, and the old spelling
    // rendered "1:60". Every interpolated PR time lands somewhere like this.
    expect(getInlineMetric(sectionPr(119.7))?.value).toBe('1:59');

    for (let secs = 100; secs < 130; secs += 0.1) {
      const value = getInlineMetric(sectionPr(secs))?.value ?? '';
      expect(Number(value.split(':')[1])).toBeLessThan(60);
    }
  });

  it('reads a whole time unchanged', () => {
    expect(getInlineMetric(sectionPr(125))?.value).toBe('2:05');
  });

  it('pads a single-digit second', () => {
    expect(getInlineMetric(sectionPr(65))?.value).toBe('1:05');
  });

  it('spells an hour out rather than running the minutes past 60', () => {
    expect(getInlineMetric(sectionPr(3725))?.value).toBe('1:02:05');
  });
});
