import { clearFFIMetrics, getFFIMetricsSummary, recordFFIMetric } from '@/shared/debug/renderTimer';

// Scenario: a 600-fix ride records 600 advance calls, then screen polling records far more
// calls of another name. Expected behaviour: the summary still counts every advance call and
// the one build call, because the raw ring only holds the latest 500 entries.
describe('FFI metrics summary', () => {
  beforeEach(() => clearFFIMetrics());

  it('counts a name whose calls the ring has since displaced', () => {
    recordFFIMetric('followRoute', 3);
    for (let i = 0; i < 600; i++) recordFFIMetric('advanceRouteFollower', 0.2);
    for (let i = 0; i < 700; i++) recordFFIMetric('getRoutesStatusData', 1);

    const summary = getFFIMetricsSummary();
    expect(summary.followRoute.calls).toBe(1);
    expect(summary.advanceRouteFollower.calls).toBe(600);
    expect(summary.getRoutesStatusData.calls).toBe(700);
    expect(summary.advanceRouteFollower.maxMs).toBe(0.2);
  });

  it('keeps the max of a displaced call', () => {
    recordFFIMetric('slowCall', 90);
    for (let i = 0; i < 600; i++) recordFFIMetric('fastCall', 1);
    expect(getFFIMetricsSummary().slowCall.maxMs).toBe(90);
  });

  it('starts again after a clear', () => {
    recordFFIMetric('a', 1);
    clearFFIMetrics();
    expect(getFFIMetricsSummary()).toEqual({});
  });
});
