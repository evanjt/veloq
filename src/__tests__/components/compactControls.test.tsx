/**
 * Scenario: the shared controls were drawn at the full platform tap-target
 * height, so a filter row of chips and range buttons read tall and boxy, and
 * each selector drew its own shape.
 *
 * Expected behaviour: each control is drawn at its rung of `controlHeight`,
 * below the platform minimum, and reaches `layout.minTapTarget` through hit
 * slop. Every selector, the feed's sport chips and range presets and the
 * section page's chips alike, draws the one chip.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { Button, ToggleButton } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';
import { ChipSelector } from '@/shared/ui/ChipSelector';
import { FeedFilterChips } from '@/features/activity/components/FeedFilterChips';
import { controlHeight } from '@/theme';
import { layout } from '@/theme/layout';

jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));

type Slop = number | { top?: number; bottom?: number; left?: number; right?: number } | undefined;
type Node = { props: { style?: unknown; hitSlop?: Slop } };

function styleOf(node: Node): Record<string, number | string | undefined> {
  const resolved =
    typeof node.props.style === 'function'
      ? (node.props.style as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : node.props.style;
  return StyleSheet.flatten(resolved as never) as Record<string, number | string | undefined>;
}

function slopOn(slop: Slop, side: 'top' | 'bottom' | 'left' | 'right'): number {
  if (typeof slop === 'number') return slop;
  return slop?.[side] ?? 0;
}

function drawnHeight(node: Node): number {
  const style = styleOf(node);
  return Math.max(Number(style.height ?? 0), Number(style.minHeight ?? 0));
}

function drawnWidth(node: Node): number {
  const style = styleOf(node);
  return Math.max(Number(style.width ?? 0), Number(style.minWidth ?? 0));
}

function reachHeight(node: Node): number {
  return (
    drawnHeight(node) + slopOn(node.props.hitSlop, 'top') + slopOn(node.props.hitSlop, 'bottom')
  );
}

function reachWidth(node: Node): number {
  return (
    drawnWidth(node) + slopOn(node.props.hitSlop, 'left') + slopOn(node.props.hitSlop, 'right')
  );
}

/** What makes two selectors look like one control. */
function chipShape(node: Node) {
  const style = styleOf(node);
  return {
    height: drawnHeight(node),
    borderRadius: style.borderRadius,
    borderWidth: style.borderWidth ?? 0,
    paddingHorizontal: style.paddingHorizontal,
  };
}

describe('compact controls', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('draws Button at its rung and reaches the minimum through slop, at either size', () => {
    for (const [size, rung] of [
      ['sm', controlHeight.buttonSm],
      ['md', controlHeight.button],
    ] as const) {
      render(<Button label="Save" size={size} onPress={() => {}} testID={`button-${size}`} />);
      const node = screen.getByTestId(`button-${size}`);

      expect(drawnHeight(node)).toBe(rung);
      expect(drawnHeight(node)).toBeLessThan(layout.minTapTarget);
      expect(reachHeight(node)).toBeGreaterThanOrEqual(layout.minTapTarget);
    }
  });

  it('draws ToggleButton as a chip and reaches the minimum through slop', () => {
    render(<ToggleButton label="Distance" onPress={() => {}} testID="toggle" />);
    const node = screen.getByTestId('toggle');

    expect(drawnHeight(node)).toBe(controlHeight.chip);
    expect(reachHeight(node)).toBeGreaterThanOrEqual(layout.minTapTarget);
  });

  it('draws IconButton in the button square and reaches the minimum on both axes', () => {
    render(
      <IconButton accessibilityLabel="Refresh" onPress={() => {}} testID="icon">
        <Text>r</Text>
      </IconButton>
    );
    const node = screen.getByTestId('icon');

    expect(drawnHeight(node)).toBe(controlHeight.button);
    expect(drawnWidth(node)).toBe(controlHeight.button);
    expect(reachHeight(node)).toBeGreaterThanOrEqual(layout.minTapTarget);
    expect(reachWidth(node)).toBeGreaterThanOrEqual(layout.minTapTarget);
  });

  it('draws each ChipSelector option as a chip that reaches the minimum', () => {
    render(
      <ChipSelector
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
        value="a"
        onChange={() => {}}
        optionTestID={(value) => `option-${value}`}
      />
    );

    for (const id of ['option-a', 'option-b']) {
      const node = screen.getByTestId(id);
      expect(drawnHeight(node)).toBe(controlHeight.chip);
      expect(reachHeight(node)).toBeGreaterThanOrEqual(layout.minTapTarget);
    }
  });

  it('draws the feed range preset as the same chip as the sport chips beside it', () => {
    render(
      <FeedFilterChips
        selected={new Set()}
        onSelect={jest.fn()}
        selectedRange="last90Days"
        onSelectRange={jest.fn()}
      />
    );
    const sport = screen.getByTestId('home-filter-cycling');
    const range = screen.getByTestId('home-range-last90Days');

    expect(chipShape(range)).toEqual(chipShape(sport));
    expect(drawnHeight(range)).toBe(controlHeight.chip);
    for (const node of [sport, range]) {
      expect(reachHeight(node)).toBeGreaterThanOrEqual(layout.minTapTarget);
    }
  });

  it('draws the section page chip and the feed chip as one selector', () => {
    const section = render(
      <ChipSelector
        options={[{ value: 'a', label: 'Alpha' }]}
        value="a"
        onChange={() => {}}
        optionTestID={(value) => `option-${value}`}
      />
    );
    const feed = render(
      <FeedFilterChips
        selected={new Set()}
        onSelect={jest.fn()}
        selectedRange={null}
        onSelectRange={jest.fn()}
      />
    );

    expect(chipShape(section.getByTestId('option-a'))).toEqual(
      chipShape(feed.getByTestId('home-filter-running'))
    );
  });
});
