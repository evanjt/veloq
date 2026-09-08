/**
 * Scenario: `feed-card-indicators` checks that the section indicators render at
 * all. It did that by falling through to `demo-test-1` when `demo-test-0`
 * carried nothing, after one swipe.
 *
 * Expected behaviour: the sweep names no card. The demo feed is sorted by date
 * and the generated fillers share the stable activities' days, so the card
 * below `demo-test-0` is a filler and `demo-test-1` is two cards further down
 * than the flow assumed.
 */

import fs from 'fs';
import path from 'path';

import { getActivities } from '@/data/demo/fixtures';

const FLOW = fs.readFileSync(
  path.join(__dirname, '../../../.maestro/feed-card-indicators.yaml'),
  'utf8'
);

describe('the demo feed the flow scrolls', () => {
  const order = getActivities().map((a) => a.id);

  it('does not put the stable activities at the top', () => {
    expect(order[0]).not.toBe('demo-test-0');
  });

  it('separates demo-test-0 from demo-test-1 with a generated filler', () => {
    const zero = order.indexOf('demo-test-0');
    const one = order.indexOf('demo-test-1');
    expect(zero).toBeGreaterThanOrEqual(0);
    expect(one).toBeGreaterThan(zero + 1);
    expect(order.slice(zero + 1, one).every((id) => !id.startsWith('demo-test-'))).toBe(true);
  });
});

describe('the coverage sweep in feed-card-indicators', () => {
  it('asserts a section chip on any card, not on a named one', () => {
    expect(FLOW).toContain('id: "activity-card-.*-section-chip"');
  });

  it('names no demo card in an assertion', () => {
    const assertions = FLOW.split('\n').filter((line) => line.includes('assertVisible'));
    expect(assertions.length).toBeGreaterThan(0);
    expect(FLOW).not.toContain('activity-card-demo-test-1-section-chip');
  });

  it('sweeps more than one swipe, since the fillers push the cards down', () => {
    expect(FLOW).toMatch(/repeat:\n\s+times: [2-9]/);
  });
});
