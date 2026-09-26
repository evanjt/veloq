/**
 * Scenario: scrubbing either summary-card sparkline shows the date under the
 * crosshair.
 *
 * Expected behaviour: both spell it in the athlete's chosen language. The HRV
 * sparkline passed no locale at all, so it read the device's while the fitness
 * one beside it read the app's, and the two disagreed for anyone whose app
 * language is not their device's.
 */

import { scrubDateLabel } from '@/features/home/lib/scrubDateLabel';
import { getIntlLocale } from '@/shared/format/format';

jest.mock('@/shared/format/format', () => ({
  ...jest.requireActual('@/shared/format/format'),
  getIntlLocale: jest.fn(() => 'de-DE'),
}));

const mockLocale = getIntlLocale as jest.MockedFunction<typeof getIntlLocale>;

describe('the date label under a sparkline crosshair', () => {
  it('spells the month in the app language, not the device one', () => {
    mockLocale.mockReturnValue('de-DE');

    expect(scrubDateLabel(0, new Date(2026, 2, 14))).toBe('14. März');
  });

  it('counts back from the day the scrub is read on', () => {
    mockLocale.mockReturnValue('en-AU');

    expect(scrubDateLabel(3, new Date(2026, 2, 14))).toBe('11 Mar');
  });

  it('crosses a month boundary going back', () => {
    mockLocale.mockReturnValue('en-AU');

    expect(scrubDateLabel(20, new Date(2026, 2, 14))).toBe('22 Feb');
  });
});
