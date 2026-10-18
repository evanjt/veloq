/**
 * Scenario: the athlete turns on the system bold text setting. Every typography
 * role steps one weight heavier, but a text whose weight was written by hand
 * keeps it, so an empty state's semibold title draws at the weight of the
 * regular hint under it, stepped to semibold, and the two read as one line.
 * Expected behaviour: with the setting on, an empty state's title draws heavier
 * than its hint in every form, and the section's calendar card, expanded to a
 * month, draws every text in the app's face and none at regular weight.
 */

import React from 'react';
import { StyleSheet, Text, type TextStyle } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { fireEvent, render } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import type { CalendarSummary } from '@/features/routes/components/section/SectionStatsCards';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

// The type scale reads the setting once, when it loads, so the native module
// answers before the theme or the card is required.
(globalThis as { expo: { modules: Record<string, unknown> } }).expo.modules.VeloqAccessibility = {
  boldText: () => true,
};
const { BOLD_TEXT } = require('@/theme/typography') as typeof import('@/theme/typography');
const { darkTheme, lightTheme } = require('@/theme') as typeof import('@/theme');
const { EmptyState } = require('@/shared/ui/EmptyState') as typeof import('@/shared/ui/EmptyState');
const { SectionStatsCards } =
  require('@/features/routes/components/section/SectionStatsCards') as typeof import('@/features/routes/components/section/SectionStatsCards');

const best = (id: string, time: number) => ({
  count: 3,
  bestTime: time,
  bestPace: 4.5,
  bestActivityId: id,
  bestActivityName: id,
});

const summary: CalendarSummary = {
  years: [
    {
      year: 2026,
      traversalCount: 4,
      activityCount: 4,
      forward: best('quickest', 600),
      reverse: best('slower-back', 640),
      months: [
        {
          month: 6,
          traversalCount: 2,
          activityCount: 2,
          forward: best('quickest', 600),
          reverse: best('slower-back', 640),
        },
        {
          month: 7,
          traversalCount: 2,
          activityCount: 2,
          forward: best('slower', 620),
          reverse: best('quickest-back', 610),
        },
      ],
    },
    {
      year: 2025,
      traversalCount: 1,
      activityCount: 1,
      forward: best('older', 660),
      months: [{ month: 3, traversalCount: 1, activityCount: 1, forward: best('older', 660) }],
    },
  ],
  forwardPr: best('quickest', 600),
  reversePr: best('quickest-back', 610),
  sectionDistance: 2000,
};

type TextNode = {
  type: unknown;
  props: { style?: unknown; children?: unknown };
  parent: TextNode | null;
};

/** A style key as a text draws it: its own, else the nearest enclosing text's. */
function resolved<K extends 'fontFamily' | 'fontWeight'>(node: TextNode, key: K): TextStyle[K] {
  for (let at: TextNode | null = node; at; at = at.parent) {
    if (at.type !== Text) continue;
    const style = StyleSheet.flatten(at.props.style as never) as TextStyle | undefined;
    if (style?.[key] !== undefined) return style[key];
  }
  return undefined;
}

async function drawnTexts(isDark: boolean) {
  const tree = await render(
    <PaperProvider theme={isDark ? darkTheme : lightTheme}>
      <SectionStatsCards
        calendarSummary={summary}
        isDark={isDark}
        basis="speed"
        recordsSettled
        onSetAsReference={() => {}}
        referenceActivityId="quickest"
      />
    </PaperProvider>
  );
  for (const year of tree.queryAllByRole('button', { name: /2025/ })) {
    await fireEvent.press(year);
  }
  return (tree.UNSAFE_getAllByType(Text) as unknown as TextNode[]).map((node) => ({
    text: typeof node.props.children === 'string' ? node.props.children : '',
    family: resolved(node, 'fontFamily'),
    weight: resolved(node, 'fontWeight'),
  }));
}

const RUNGS = ['400', '600', '700'];
const weightOf = (node: unknown) => RUNGS.indexOf(String(resolved(node as TextNode, 'fontWeight')));

describe('an empty state with the bold text setting on', () => {
  it.each(['screen', 'compact', 'inline'] as const)(
    'draws the %s title heavier than its hint',
    async (variant) => {
      const tree = await render(
        <PaperProvider theme={lightTheme}>
          {variant === 'inline' ? (
            <EmptyState variant="inline" title="No laps" description="Ride one to fill it" />
          ) : (
            <EmptyState
              variant={variant}
              icon="map"
              title="No laps"
              description="Ride one to fill it"
            />
          )}
        </PaperProvider>
      );
      const title = weightOf(tree.getByText('No laps'));
      const hint = weightOf(tree.getByText('Ride one to fill it'));
      expect(hint).toBeGreaterThanOrEqual(RUNGS.indexOf('600'));
      expect(title).toBeGreaterThan(hint);
    }
  );
});

describe('the calendar card with the bold text setting on', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('loads the type scale with the setting on', () => {
    expect(BOLD_TEXT).toBe(true);
  });

  it.each([false, true])('draws every text in the app face (dark %s)', async (isDark) => {
    const drawn = await drawnTexts(isDark);
    expect(drawn.length).toBeGreaterThan(8);
    expect(drawn.filter((t) => t.family !== 'Manrope')).toEqual([]);
  });

  it.each([false, true])('draws no text at regular weight (dark %s)', async (isDark) => {
    const drawn = await drawnTexts(isDark);
    expect(drawn.filter((t) => !['600', '700'].includes(String(t.weight)))).toEqual([]);
  });
});
