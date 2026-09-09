/**
 * Scenario: at 360x640 dp with a result on screen the card has about 47 dp of
 * content height for five rows, so every caption draws over the slider under
 * it. Nothing clips and nothing scrolls, so the panel overdraws itself.
 *
 * Expected behaviour: each row holds a tap target's worth of height and the
 * card scrolls once five of them no longer fit. A tall screen still shares the
 * leftover height out, and a run does not lock the rows below the fold away.
 */

import React from 'react';
import { ScrollView } from 'react-native';
import Slider from '@react-native-community/slider';
import { render } from '@testing-library/react-native';

import { PreviewParamPanel } from '@/features/routes/components/preview/PreviewParamPanel';
import { layout } from '@/theme';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const params = {
  proximityThreshold: 200,
  minSectionLength: 150,
  maxSectionLength: 200000,
  minActivities: 2,
  divergenceThreshold: 0.15,
};

// The composite, not the host node getByTestId returns: the style props under
// test are the ones the card is given, before ScrollView splits them across
// RCTScrollView and its content view.
function panel(disabled?: boolean) {
  const tree = render(
    <PreviewParamPanel params={params} onChange={jest.fn()} disabled={disabled} />
  );
  const cards = tree.UNSAFE_getAllByType(ScrollView);
  expect(cards).toHaveLength(1);
  return { tree, node: cards[0] };
}

function flatten(style: unknown) {
  return Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
}

describe('the parameter panel on a short screen', () => {
  it('scrolls the card rather than overdrawing its own rows', () => {
    const { node } = panel();

    expect(node.props.testID).toBe('preview-param-panel');
    expect(node.props.horizontal).toBeFalsy();
  });

  it('still shares the leftover height out when there is room for all five', () => {
    const { node } = panel();

    expect(flatten(node.props.style).flex).toBe(1);
    expect(flatten(node.props.style).height).toBeUndefined();
    expect(flatten(node.props.contentContainerStyle).flexGrow).toBe(1);
  });

  it('carries the padding and the gap on the content, where they still apply', () => {
    const { node } = panel();

    const content = flatten(node.props.contentContainerStyle);
    expect(content.paddingHorizontal).toBeGreaterThan(0);
    expect(content.paddingVertical).toBeGreaterThan(0);
    expect(content.gap).toBeGreaterThan(0);
  });

  it('floors every row at a tap target so a caption and its slider both fit', () => {
    const { tree } = panel();

    const rows = tree.UNSAFE_getAllByType(Slider).map((slider) => slider.parent);
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(flatten(row?.props.style).minHeight).toBe(layout.minTapTarget);
    }
  });

  it('leaves the card scrollable during a run, and disables the sliders instead', () => {
    const { tree, node } = panel(true);

    expect(node.props.pointerEvents).not.toBe('none');
    expect(node.props.scrollEnabled).not.toBe(false);
    for (const slider of tree.UNSAFE_getAllByType(Slider)) {
      expect(slider.props.disabled).toBe(true);
    }
  });

  it('leaves the sliders live when no run is going', () => {
    const { tree } = panel();

    for (const slider of tree.UNSAFE_getAllByType(Slider)) {
      expect(slider.props.disabled).toBeFalsy();
    }
  });
});
