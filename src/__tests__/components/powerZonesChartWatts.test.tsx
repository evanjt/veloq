/**
 * Scenario: intervals.icu sends power zone bounds as percent of FTP, and the
 * chart printed them as watts, so a 155 W FTP rider's Z2 read '55-75W' and the
 * top zone '150-999W'.
 *
 * Expected behaviour: the card prints the watt bands the engine resolved, the
 * top zone open, every value with a space before its unit, and the time spent
 * in the zones beside the moving time.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { PowerZonesChart } from '@/features/activity/components/PowerZonesChart';
import { typography } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const bands = [
  { zone: 1, minWatts: 0, maxWatts: 85, seconds: 600, percent: 60 },
  { zone: 2, minWatts: 85, maxWatts: 116, seconds: 300, percent: 30 },
  { zone: 3, minWatts: 116, maxWatts: 140, seconds: 0, percent: 0 },
  { zone: 4, minWatts: 140, maxWatts: 163, seconds: 0, percent: 0 },
  { zone: 5, minWatts: 163, maxWatts: 186, seconds: 0, percent: 0 },
  { zone: 6, minWatts: 186, maxWatts: 233, seconds: 0, percent: 0 },
  { zone: 7, minWatts: 233, seconds: 100, percent: 10 },
];

function allText(node: Awaited<ReturnType<typeof render>>): string[] {
  return node.UNSAFE_root.findAll((n) => typeof n.props.children === 'string').map(
    (n) => n.props.children as string
  );
}

it('prints the engine watt bands with an open top zone', async () => {
  const view = await render(<PowerZonesChart powerZones={bands} ftp={155} movingTime={1200} />);

  expect(view.getByText('0-85 W')).toBeTruthy();
  expect(view.getByText('85-116 W')).toBeTruthy();
  expect(view.getByText('233+ W')).toBeTruthy();
  expect(view.getByText('Z7')).toBeTruthy();
  const text = allText(view);
  expect(text.some((t) => t.includes('55-75W'))).toBe(false);
  expect(text.some((t) => t.includes('999'))).toBe(false);
});

it('labels the FTP with its unit and totals the zone time beside moving time', async () => {
  const view = await render(<PowerZonesChart powerZones={bands} ftp={155} movingTime={1200} />);

  expect(view.getByText('activity.ftp:{"value":"155 W"}')).toBeTruthy();
  expect(view.getByText('activity.powerZoneTotal:{"duration":"16:40"}')).toBeTruthy();
  expect(view.getByText('activity.movingTime:{"duration":"20:00"}')).toBeTruthy();
});

it('leaves the FTP label out when the activity has none', async () => {
  const view = await render(<PowerZonesChart powerZones={bands} movingTime={1200} />);
  expect(view.queryByText(/activity\.ftp/)).toBeNull();
});

it('renders nothing with no bands', async () => {
  const view = await render(<PowerZonesChart powerZones={[]} ftp={155} movingTime={1200} />);
  expect(view.toJSON()).toBeNull();
});

it('titles the card as a header in the card title role', () => {
  const view = render(<PowerZonesChart powerZones={bands} ftp={155} movingTime={1200} />);

  const title = view.getByRole('header', { name: 'activity.timeInPowerZones' });
  const style = StyleSheet.flatten(title.props.style);
  expect(style.fontSize).toBe(typography.cardTitle.fontSize);
  expect(style.fontWeight).toBe(typography.cardTitle.fontWeight);
});
