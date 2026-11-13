/**
 * Scenario: an athlete whose app language is German reads the zone histogram, which prints each
 * zone's share of the time beside its time.
 *
 * Expected behaviour: the share is written by the locale percent formatter, so it carries the
 * locale's spacing like the other percentages on the screen, and no literal percent sign is
 * joined to the figure.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { ZoneHistogram, type ZoneBand } from '@/shared/charts/ZoneHistogram';
import { formatPercent } from '@/shared/format';

let mockLocale = 'en-GB';
jest.mock('@/i18n', () => ({
  ...jest.requireActual('@/i18n'),
  getCurrentLanguage: () => mockLocale,
}));

afterEach(() => {
  mockLocale = 'en-GB';
});

const band = (zone: number, seconds: number, share: number): ZoneBand => ({
  key: zone,
  label: `Z${zone}`,
  zone,
  seconds,
  share,
  primary: `${seconds}s`,
});

describe('the zone histogram under de-DE', () => {
  beforeEach(() => {
    mockLocale = 'de-DE';
  });

  it('prints each share through the locale percent formatter', async () => {
    const view = await render(
      <ZoneHistogram title="Zones" bands={[band(1, 3600, 88), band(2, 600, 12)]} />
    );

    expect(view.queryByText(formatPercent(12))).not.toBeNull();
    expect(view.queryByText('12%')).toBeNull();
  });
});
