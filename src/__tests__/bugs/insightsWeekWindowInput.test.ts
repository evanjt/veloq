import { buildInsightsParams } from '@/features/insights/lib/insightsParams';
import { startDateLocalToEpochSeconds } from '@/shared/time/startDate';
import { installUtcOffset } from '../__shared__/fixedOffsetDate';

jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: () => false,
}));

describe.each([
  ['UTC+10', 10, '2026-09-15T22:00:00'],
  ['UTC-7', -7, '2026-09-15T05:00:00'],
])('the insights week input at %s', (_zone, offset, localTime) => {
  let restoreClock: () => void;

  beforeEach(() => {
    restoreClock = installUtcOffset(offset, Date.parse('2026-09-15T12:00:00Z'));
  });

  afterEach(() => restoreClock());

  it('hands wall-clock now to the engine for the week comparison', () => {
    expect(buildInsightsParams().currentEnd).toBe(startDateLocalToEpochSeconds(localTime));
  });
});
