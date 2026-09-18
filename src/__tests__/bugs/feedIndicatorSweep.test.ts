/**
 * Scenario: `feed-card-indicators` checks that the section indicators render at
 * all. It did that by falling through to `demo-test-1` when `demo-test-0`
 * carried nothing, after one swipe.
 *
 * Expected behaviour: the sweep names no card, and the flow reaches
 * `demo-test-0` by scrolling until it is visible rather than by position. The
 * generated fillers are dated from today, so a stable activity's position in
 * the feed moves with the calendar and nothing here may depend on it.
 */

import fs from 'fs';
import path from 'path';

import { getActivities } from '@/data/demo/fixtures';

const FLOW = fs.readFileSync(
  path.join(__dirname, '../../../.maestro/feed-card-indicators.yaml'),
  'utf8'
);

describe('the demo feed the flow scrolls', () => {
  const activities = getActivities();
  const order = activities.map((a) => a.id);

  it('is sorted newest first, so a sweep from the top walks recent cards', () => {
    const times = activities.map((a) => new Date(a.start_date_local).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeLessThanOrEqual(times[i - 1]);
    }
  });

  it('carries the stable activities the flow taps by id', () => {
    expect(order).toContain('demo-test-0');
    expect(order).toContain('demo-test-1');
  });

  it('interleaves the stable activities with generated fillers rather than grouping them', () => {
    // The fillers share the stable activities' days, so both kinds appear
    // among the recent cards. Which sits first is the calendar's to decide.
    const recent = order.slice(0, 8);
    expect(recent.some((id) => id.startsWith('demo-test-'))).toBe(true);
    expect(recent.some((id) => !id.startsWith('demo-test-'))).toBe(true);
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

  it('reaches demo-test-0 by scrolling until it is visible, never by position', () => {
    expect(FLOW).toMatch(/scrollUntilVisible:\n\s+element:\n\s+id: "activity-card-demo-test-0"/);
  });
});
