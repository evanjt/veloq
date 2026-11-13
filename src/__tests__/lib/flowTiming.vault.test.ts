/**
 * Scenario: a release build records no span from a gesture to the frame that
 * shows its result.
 * Expected behaviour: one mark and one frame record one entry; a second frame
 * records nothing; a superseded mark records only the latest start.
 */

import { FLOW_EXPAND, completeFlow, markFlow } from '@/shared/debug/flowTiming';
import { clearFFIMetrics, getFFIMetrics, setAppMetricsEnabled } from '@/shared/debug/renderTimer';

beforeEach(() => {
  clearFFIMetrics();
  setAppMetricsEnabled(true);
});

afterEach(() => setAppMetricsEnabled(false));

describe('flowTiming', () => {
  it('records one entry for a mark then a frame, and none for a second frame', () => {
    markFlow(FLOW_EXPAND, 100);
    completeFlow(FLOW_EXPAND, 160);
    completeFlow(FLOW_EXPAND, 200);
    const entries = getFFIMetrics().filter((e) => e.name === FLOW_EXPAND);
    expect(entries.map((e) => e.durationMs)).toEqual([60]);
  });

  it('times only the last of superseded marks', () => {
    markFlow(FLOW_EXPAND, 100);
    markFlow(FLOW_EXPAND, 150);
    completeFlow(FLOW_EXPAND, 170);
    expect(getFFIMetrics().map((e) => e.durationMs)).toEqual([20]);
  });

  it('records nothing for a frame with no mark', () => {
    completeFlow(FLOW_EXPAND, 170);
    expect(getFFIMetrics()).toEqual([]);
  });
});
