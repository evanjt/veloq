/**
 * Scenario: a tab press reaches the target tab's first frame, and the only
 * figures on record came from a trace taken by hand.
 *
 * Expected behaviour: a press followed by a first frame records one duration
 * under a named metric in the FFI ring, a second frame records nothing, and a
 * press on a route with no pending press records nothing.
 */

import { markTabPress, recordTabFirstFrame, tabSwitchMetric } from '@/shared/debug/tabSwitchTiming';
import { clearFFIMetrics, getFFIMetrics, setAppMetricsEnabled } from '@/shared/debug/renderTimer';

describe('tab switch timing', () => {
  beforeEach(() => {
    clearFFIMetrics();
    setAppMetricsEnabled(true);
    recordTabFirstFrame('/fitness', 0);
    clearFFIMetrics();
  });
  afterAll(() => setAppMetricsEnabled(false));

  it('records the press to first frame once per press', () => {
    markTabPress('/fitness', 100);
    recordTabFirstFrame('/fitness', 142);
    recordTabFirstFrame('/fitness', 200);
    const entries = getFFIMetrics();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: tabSwitchMetric('/fitness'), durationMs: 42 });
  });

  it('records nothing for a frame with no press', () => {
    recordTabFirstFrame('/map', 50);
    expect(getFFIMetrics()).toHaveLength(0);
  });

  it('keeps presses apart by route', () => {
    markTabPress('/map', 10);
    markTabPress('/insights', 20);
    recordTabFirstFrame('/insights', 50);
    recordTabFirstFrame('/map', 70);
    const byName = Object.fromEntries(getFFIMetrics().map((e) => [e.name, e.durationMs]));
    expect(byName).toEqual({
      [tabSwitchMetric('/insights')]: 30,
      [tabSwitchMetric('/map')]: 60,
    });
  });

  it('names the home tab and each other tab distinctly', () => {
    const names = ['/', '/fitness', '/map', '/insights', '/training'].map(tabSwitchMetric);
    expect(new Set(names).size).toBe(5);
    expect(tabSwitchMetric('/')).toBe('tab.feed');
  });
});
