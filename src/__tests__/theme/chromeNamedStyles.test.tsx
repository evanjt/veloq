/**
 * Scenario: a shared chrome component read only the size off a text role, or
 * spread a role and then set its own weight, line height or letter spacing, so
 * the text it drew was none of the scale's named styles; and a chip, a line or
 * a notice drew its corners at a radius the guide does not give that kind.
 * Expected behaviour: every text these components draw is one named style,
 * taken whole, and each surface sits on its rung of the radius scale.
 */

import React from 'react';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { CircleOptionRow, circleOptionSize } from '@/shared/ui/CircleOption';
import { ErrorState } from '@/shared/ui/ErrorState';
import { ExplanationCard } from '@/shared/ui/ExplanationCard';
import { PermissionNotice } from '@/shared/ui/PermissionNotice';
import { SignalStatus } from '@/shared/ui/SignalStatus';
import { SwipeableTabs } from '@/shared/ui';
import { controlHeight, layout, spacing, stroke, typography } from '@/theme';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/openExternal', () => ({ openExternal: jest.fn() }));
jest.mock('@/shared/app/permissions', () => ({ openAppSettings: jest.fn() }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

type Role = keyof typeof typography;

const flat = (node: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(node.props.style as never) ?? {}) as TextStyle & ViewStyle;

/**
 * The properties that together say which named style a text is drawn in. Paper's
 * `Text` sets a letter spacing of 0 itself, which draws the same as none.
 */
function face(style: TextStyle) {
  return {
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing ?? 0,
    textTransform: style.textTransform,
  };
}

function expectRole(text: string, role: Role) {
  expect(face(flat(screen.getByText(text)))).toEqual(face(typography[role]));
}

describe('chrome text draws a named style whole', () => {
  it('sets the signal chip label in badge and the line label in bodySmallBold', async () => {
    await render(
      <>
        <SignalStatus level="ok" icon="satellite-variant" label="Fix 4 m" variant="chip" />
        <SignalStatus level="warn" icon="satellite-variant" label="Weak fix" variant="line" />
        <SignalStatus level="idle" icon="satellite-variant" label="No fix" />
      </>
    );
    expectRole('Fix 4 m', 'badge');
    expectRole('Weak fix', 'bodySmallBold');
    expectRole('No fix', 'badge');
  });

  it('sets a picture option name in caption, and the chosen one in captionBold', async () => {
    await render(
      <CircleOptionRow
        options={[
          { value: 'moss', label: 'Moss', render: () => null },
          { value: 'slate', label: 'Slate', render: () => null },
        ]}
        value="slate"
        onValueChange={jest.fn()}
        maxSize={64}
      />
    );
    expectRole('Moss', 'caption');
    expectRole('Slate', 'captionBold');
  });

  it('sets the inline failure reason in caption', async () => {
    await render(
      <ErrorState
        variant="inline"
        error={{ tag: 'Busy', message: 'a job is running' }}
        onRetry={jest.fn()}
      />
    );
    for (const node of screen.getAllByText('engine.failure.busy')) {
      expect(face(flat(node))).toEqual(face(typography.caption));
    }
  });

  it('sets the explanation title, rows, lead-in and links heading in their styles', async () => {
    await render(
      <ExplanationCard
        title="How the tide is read"
        rows={[{ key: 'ebb', label: 'Ebb', text: 'the falling water' }]}
        links={{
          heading: 'Further reading',
          items: [{ key: 'chart', label: 'Tide chart', url: 'https://example.org' }],
        }}
      />
    );
    expectRole('How the tide is read', 'cardTitle');
    expectRole('Ebb', 'captionBold');
    expect(face(flat(screen.getByText(/the falling water/)))).toEqual(face(typography.caption));
    expectRole('Further reading', 'sectionHeader');
  });
});

describe('chrome surfaces sit on their radius rung', () => {
  it('rounds the signal chip fully and the signal line at the inline-control rung', async () => {
    await render(
      <>
        <SignalStatus level="ok" icon="bluetooth" label="Cadence" variant="chip" testID="chip" />
        <SignalStatus level="bad" icon="bluetooth" label="Lost" variant="line" testID="line" />
      </>
    );
    expect(flat(screen.getByTestId('chip')).borderRadius).toBe(layout.borderRadiusFull);
    expect(flat(screen.getByTestId('line')).borderRadius).toBe(layout.borderRadiusMd);
  });

  it('rounds the permission notice at the card rung, as every in-screen notice', async () => {
    await render(
      <PermissionNotice
        outcome="askable"
        reason="Location is off"
        icon="map-marker-off"
        onAllow={jest.fn()}
        testID="notice"
      />
    );
    expect(flat(screen.getByTestId('notice')).borderRadius).toBe(layout.borderRadius);
  });

  it('rounds a tab count badge fully', async () => {
    const tabs = [
      { key: 'kelp', label: 'Kelp', icon: 'leaf' as const, count: 7 },
      { key: 'reef', label: 'Reef', icon: 'waves' as const },
    ];
    await render(
      <SwipeableTabs tabs={tabs} activeTab="kelp" onTabChange={jest.fn()} isDark={false}>
        {tabs.map((tab) => (
          <React.Fragment key={tab.key} />
        ))}
      </SwipeableTabs>
    );
    expect(flat(screen.getByTestId('tab-badge-kelp')).borderRadius).toBe(layout.borderRadiusFull);
  });
});

describe('the picture option ring', () => {
  it('rings the chosen option at the selected-ring width', async () => {
    await render(
      <CircleOptionRow
        options={[{ value: 'moss', label: 'Moss', render: () => null }]}
        value="moss"
        onValueChange={jest.fn()}
        maxSize={64}
        testIDPrefix="swatch"
      />
    );
    const circle = screen.getByTestId('swatch-moss-circle');
    const ring = circle.parent?.parent ?? circle;
    expect(flat(ring as never).borderWidth).toBe(stroke.two);
  });

  it('never draws a circle smaller than a button is tall', () => {
    expect(circleOptionSize(120, 6, 64)).toBe(controlHeight.button);
  });

  it('gives each circle its share of the row less the ring on either side', () => {
    expect(circleOptionSize(400, 4, 200)).toBe(
      Math.floor((400 - spacing.sm * 3) / 4 - stroke.two * 2)
    );
  });
});
