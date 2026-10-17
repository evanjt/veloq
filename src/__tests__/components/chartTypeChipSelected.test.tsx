/**
 * Scenario: a chart type chip is selected. Its label, icon and value are text
 * on the chip's ground, in either theme, for every stream.
 *
 * Expected behaviour: the selected chip takes the standard selected fill and
 * outline, every text on it clears 4.5:1 against that fill, and the stream is
 * told by a dot in its own hue, selected or not.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { ChartTypeSelector } from '@/features/activity/components/ChartTypeSelector';
import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import { chartStreamColour, colors, darkColors } from '@/theme';
import { underBar } from '../__shared__/drawnContrast';

let mockIsDark = false;
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockIsDark }) }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const STREAMS = Object.values(CHART_CONFIGS);
const THEMES = [
  ['light', false, colors],
  ['dark', true, darkColors],
] as const;

function groundOf(testID: string, tree: Awaited<ReturnType<typeof render>>): string {
  return StyleSheet.flatten(tree.getByTestId(testID).props.style).backgroundColor as string;
}

describe.each(THEMES)('a selected chart type chip in the %s theme', (_, isDark, palette) => {
  beforeEach(() => {
    mockIsDark = isDark;
  });

  it.each(STREAMS.map((c) => [c.id, c] as const))(
    '%s takes the selected fill and its text clears 4.5:1 on it',
    async (id, config) => {
      const tree = await render(
        <ChartTypeSelector
          available={[config]}
          selected={[id]}
          onToggle={jest.fn()}
          metricValues={[{ id, value: '123', unit: config.unit ?? '', isAverage: true }]}
        />
      );
      const chip = tree.getByTestId(`chart-type-${id}`);
      const ground = groundOf(`chart-type-${id}`, tree);

      expect(ground).toBe(palette.controlOn);
      expect(StyleSheet.flatten(chip.props.style).borderColor).toBe(palette.focusRing);
      expect(underBar(ground, chip)).toEqual([]);
    }
  );

  it.each(STREAMS.map((c) => [c.id, c] as const))(
    '%s shows its stream as a dot in both states',
    async (id, config) => {
      for (const selected of [[id], []]) {
        const tree = await render(
          <ChartTypeSelector available={[config]} selected={selected} onToggle={jest.fn()} />
        );
        expect(groundOf(`chart-type-${id}-mark`, tree)).toBe(
          chartStreamColour(config.stream, mockIsDark)
        );
        tree.unmount();
      }
    }
  );
});
