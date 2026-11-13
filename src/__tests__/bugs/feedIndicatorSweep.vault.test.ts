/**
 * Scenario: the feed flows reach the stable demo activities by scrolling. The
 * generated fillers are dated from the reference day, so a stable activity's
 * position in the feed moves with the calendar.
 *
 * Expected behaviour: the demo feed is newest first and interleaves the stable
 * activities with fillers, so nothing may depend on where a stable card lands.
 */

import { getActivities } from '@/data/demo/fixtures';

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
