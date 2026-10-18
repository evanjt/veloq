/**
 * Scenario: a numeric role draws proportional figures, so a column of lap
 * times or a live readout shifts as its digits change; a role, a Paper control
 * or a header title draws the platform's sans while the rest of the screen
 * draws the app's face; or a style asks for a weight the embedded face does not
 * ship, so each platform synthesises or substitutes a different one.
 * Expected behaviour: every role but `code` names Manrope on both platforms at
 * 400, 600 or 700, every numeric role carries tabular figures, the only
 * monospaced face is the `code` role, which asks each platform for its system
 * mono, Paper's typescale and the navigator's title fonts name the same face at
 * those weights, and the formula box and the intervals table draw through the
 * roles.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { TextStyle } from 'react-native';

import { initialiseI18n } from '@/i18n';
import type { Insight } from '@/features/insights/types';
import type { ActivityInterval } from '@/types';
import { IntervalKind } from 'veloqrs';

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

const SHIPPED_WEIGHTS = ['400', '600', '700'];

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

  it.each(['ios', 'android'] as const)('draws every role but code in Manrope on %s', (os) => {
    const families = Object.entries(scaleOn(os))
      .filter(([role]) => role !== 'code')
      .map(([role, style]) => [role, style.fontFamily]);
    expect(families.length).toBeGreaterThan(0);
    for (const [role, family] of families) expect([role, family]).toEqual([role, 'Manrope']);
  });

  it.each(['ios', 'android'] as const)('asks only for a weight the face ships on %s', (os) => {
    for (const [role, style] of Object.entries(scaleOn(os))) {
      expect([role, SHIPPED_WEIGHTS.includes(String(style.fontWeight))]).toEqual([role, true]);
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

describe('the face beyond the scale', () => {
  it('maps any requested weight to the nearest the face ships', () => {
    const { faceWeight } = require('@/theme/typography');
    const cases: [unknown, string][] = [
      [undefined, '400'],
      ['normal', '400'],
      ['100', '400'],
      ['400', '400'],
      ['500', '600'],
      ['600', '600'],
      ['650', '700'],
      ['bold', '700'],
      ['800', '700'],
      [900, '700'],
    ];
    expect(cases.map(([weight]) => [weight, faceWeight(weight)])).toEqual(cases);
  });

  it.each(['lightTheme', 'darkTheme'] as const)(
    'gives every Paper variant in %s the face at a shipped weight',
    (name) => {
      const theme = require('@/theme')[name] as { fonts: Record<string, TextStyle> };
      const variants = Object.entries(theme.fonts);
      expect(variants.map(([variant]) => variant)).toEqual(
        expect.arrayContaining(['default', 'bodyLarge', 'labelLarge', 'titleMedium'])
      );
      for (const [variant, style] of variants) {
        expect([variant, style.fontFamily]).toEqual([variant, 'Manrope']);
        if (variant !== 'default') {
          expect([variant, SHIPPED_WEIGHTS.includes(String(style.fontWeight))]).toEqual([
            variant,
            true,
          ]);
        }
      }
      expect(theme.fonts.labelLarge.fontWeight).toBe('600');
    }
  );

  it.each(['light', 'dark'] as const)(
    'gives the navigator the face for header titles in %s',
    (scheme) => {
      const { navigationTheme } = require('@/theme/navigationTheme');
      const fonts = navigationTheme(scheme).fonts as Record<string, TextStyle>;
      expect(Object.keys(fonts).sort()).toEqual(['bold', 'heavy', 'medium', 'regular']);
      expect(fonts).toEqual({
        regular: { fontFamily: 'Manrope', fontWeight: '400' },
        medium: { fontFamily: 'Manrope', fontWeight: '600' },
        bold: { fontFamily: 'Manrope', fontWeight: '700' },
        heavy: { fontFamily: 'Manrope', fontWeight: '700' },
      });
    }
  );
});

describe('surfaces drawing through the scale', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('draws the method formula in the code role', async () => {
    const { typography } = require('@/theme/typography');
    const { MethodologySection } = require('@/features/insights/components/MethodologySection');
    const insight = {
      id: 'formula-probe',
      methodology: { name: 'Probe', description: 'Probe', formula: 'k = a / b' },
    } as unknown as Insight;
    await render(<MethodologySection insight={insight} />);
    await fireEvent.press(screen.getByTestId('methodology-toggle'));
    const style = flatStyle(screen.getByText('k = a / b'));
    expect(style.fontFamily).toBe(typography.code.fontFamily);
    expect(style.lineHeight).toBe(typography.code.lineHeight);
  });

  it('draws every intervals table cell with tabular figures', async () => {
    const { IntervalsTable } = require('@/features/activity/components/IntervalsTable');
    const interval = {
      id: 1,
      kind: IntervalKind.Work,
      startIndex: 0,
      endIndex: 100,
      distance: 1200,
      movingTime: 181,
      averageSpeed: 6.7,
      averageHeartrate: 151,
      averageWatts: 248,
      zone: 4,
    } as ActivityInterval;
    await render(
      <IntervalsTable intervals={[interval]} activityType="Ride" isMetric isDark={false} />
    );
    for (const text of ['1', '248']) {
      const cell = screen.getAllByText(new RegExp(`^${text}`))[0];
      expect(flatStyle(cell).fontVariant).toContain('tabular-nums');
    }
  });
});
