/**
 * Scenario: a numeric role draws proportional figures, so a column of lap
 * times or a live readout shifts as its digits change, and a role that names a
 * family the platform does not ship (`SF Mono` on iOS) or a code face beside
 * the system sans (`monospace` on Android) draws a different typeface on each
 * platform for the one token.
 * Expected behaviour: every numeric role carries tabular figures in the system
 * face, the only monospaced face is the `code` role, which asks each platform
 * for its system mono, and the formula box and the intervals table draw
 * through those roles.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { TextStyle } from 'react-native';

import { initialiseI18n } from '@/i18n';
import type { Insight } from '@/features/insights/types';
import type { ActivityInterval } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const NUMERIC_ROLES = [
  'statsHero',
  'heroNumber',
  'largeNumber',
  'headlineNumber',
  'statsValueLarge',
  'statsValue',
  'metricValue',
  'tableValue',
] as const;

type Scale = Record<string, TextStyle>;

/** The scale as it is built on `os`, with `Platform.select` answering for it. */
function scaleOn(os: 'ios' | 'android'): Scale {
  let scale: Scale = {};
  jest.isolateModules(() => {
    const { Platform } = require('react-native') as typeof import('react-native');
    const select = jest
      .spyOn(Platform, 'select')
      .mockImplementation(((spec: Record<string, unknown>) =>
        os in spec ? spec[os] : spec.default) as typeof Platform.select);
    scale = require('@/theme/typography').typography;
    select.mockRestore();
  });
  return scale;
}

function flatStyle(node: { props: { style?: unknown } }): TextStyle {
  return Object.assign({}, ...([node.props.style].flat(Infinity).filter(Boolean) as TextStyle[]));
}

describe('the type scale', () => {
  it.each(NUMERIC_ROLES)('draws %s with tabular figures', (role) => {
    const { typography } = require('@/theme/typography');
    expect(typography[role].fontVariant).toContain('tabular-nums');
  });

  it.each(['ios', 'android'] as const)('names no family %s does not ship', (os) => {
    const allowed =
      os === 'ios' ? [undefined, 'System', 'system-ui', 'ui-monospace'] : [undefined, 'monospace'];
    const families = Object.entries(scaleOn(os)).map(([role, style]) => [role, style.fontFamily]);
    for (const [role, family] of families) {
      expect([role, allowed.includes(family) ? 'allowed' : family]).toEqual([role, 'allowed']);
    }
  });

  it.each(['ios', 'android'] as const)('keeps the monospaced face to the code role on %s', (os) => {
    const scale = scaleOn(os);
    const mono = os === 'ios' ? 'ui-monospace' : 'monospace';
    expect(scale.code.fontFamily).toBe(mono);
    expect(scale.code.lineHeight).toEqual(expect.any(Number));
    const others = Object.entries(scale)
      .filter(([role, style]) => role !== 'code' && style.fontFamily === mono)
      .map(([role]) => role);
    expect(others).toEqual([]);
  });
});

describe('surfaces drawing through the scale', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('draws the method formula in the code role', () => {
    const { typography } = require('@/theme/typography');
    const { MethodologySection } = require('@/features/insights/components/MethodologySection');
    const insight = {
      id: 'formula-probe',
      methodology: { name: 'Probe', description: 'Probe', formula: 'k = a / b' },
    } as unknown as Insight;
    render(<MethodologySection insight={insight} />);
    fireEvent.press(screen.getByTestId('methodology-toggle'));
    const style = flatStyle(screen.getByText('k = a / b'));
    expect(style.fontFamily).toBe(typography.code.fontFamily);
    expect(style.lineHeight).toBe(typography.code.lineHeight);
  });

  it('draws every intervals table cell with tabular figures', () => {
    const { IntervalsTable } = require('@/features/activity/components/IntervalsTable');
    const interval = {
      id: 1,
      type: 'WORK',
      start_index: 0,
      end_index: 100,
      distance: 1200,
      moving_time: 181,
      elapsed_time: 181,
      average_speed: 6.7,
      average_heartrate: 151,
      average_watts: 248,
      zone: 4,
    } as ActivityInterval;
    render(<IntervalsTable intervals={[interval]} activityType="Ride" isMetric isDark={false} />);
    for (const text of ['1', '248']) {
      const cell = screen.getAllByText(new RegExp(`^${text}`))[0];
      expect(flatStyle(cell).fontVariant).toContain('tabular-nums');
    }
  });
});
