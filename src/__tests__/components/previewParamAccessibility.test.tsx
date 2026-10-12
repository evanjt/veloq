/**
 * Scenario: the detection and grouping preview sliders carried no label and no
 * value, so a screen reader read "slider" and a bare number in metres, the
 * typed editor opened from a caption-sized line of text, and the selected
 * preset showed only as a teal border.
 *
 * Expected behaviour: every slider names itself and speaks its value in the
 * athlete's unit, every caption that opens the editor says so, and the presets
 * are the shared selector chip with its state on `accessibilityState`.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { PreviewParamPanel } from '@/features/routes/components/preview/PreviewParamPanel';
import { GroupingParamPanel } from '@/features/routes/components/preview/GroupingParamPanel';
import { ToggleButton } from '@/shared/ui';
import { formatDistance } from '@/shared/format/format';
import { DETECTION_PRESETS } from '@/features/routes/lib/detectionParams';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

let mockMetric = false;
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => mockMetric,
}));
jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => mockMetric }));

const detection = { ...DETECTION_PRESETS.default };

const grouping = { minMatchPercentage: 65, endpointThreshold: 200 };

const DISTANCE_KEYS = ['proximityThreshold', 'minSectionLength', 'maxSectionLength'] as const;

function detectionPanel() {
  return render(<PreviewParamPanel params={detection} onChange={jest.fn()} />);
}

function groupingPanel() {
  return render(<GroupingParamPanel params={grouping} onChange={jest.fn()} />);
}

beforeEach(() => {
  mockMetric = false;
});

describe('the detection sliders', () => {
  it.each(Object.keys(detection))('names the %s slider and speaks its value', async (key) => {
    const slider = (await detectionPanel()).getByTestId(`param-slider-${key}`);

    expect(String(slider.props.accessibilityLabel ?? '').trim()).not.toBe('');
    expect(String(slider.props.accessibilityValue?.text ?? '').trim()).not.toBe('');
  });

  it.each(DISTANCE_KEYS)(
    'speaks the %s distance in feet or miles for an imperial athlete',
    async (key) => {
      const slider = (await detectionPanel()).getByTestId(`param-slider-${key}`);

      expect(slider.props.accessibilityValue.text).toBe(formatDistance(detection[key], false));
      expect(slider.props.accessibilityValue.text).toMatch(/ (ft|mi)$/);
    }
  );

  it('speaks a short proximity in feet', async () => {
    const slider = (await detectionPanel()).getByTestId('param-slider-proximityThreshold');

    expect(slider.props.accessibilityValue.text).toBe(
      formatDistance(detection.proximityThreshold, false)
    );
    expect(slider.props.accessibilityValue.text).toMatch(/ ft$/);
  });

  it('speaks the distances in metres for a metric athlete', async () => {
    mockMetric = true;
    const slider = (await detectionPanel()).getByTestId('param-slider-minSectionLength');

    expect(slider.props.accessibilityValue.text).toBe('150 m');
  });

  it('speaks the count and the ratio as the captions print them', async () => {
    const tree = await detectionPanel();

    expect(tree.getByTestId('param-slider-minActivities').props.accessibilityValue.text).toBe(
      String(detection.minActivities)
    );
    expect(tree.getByTestId('param-slider-divergenceThreshold').props.accessibilityValue.text).toBe(
      detection.divergenceThreshold.toFixed(2)
    );
  });
});

describe('the grouping sliders', () => {
  it.each(Object.keys(grouping))('names the %s slider and speaks its value', async (key) => {
    const slider = (await groupingPanel()).getByTestId(`grouping-slider-${key}`);

    expect(String(slider.props.accessibilityLabel ?? '').trim()).not.toBe('');
    expect(String(slider.props.accessibilityValue?.text ?? '').trim()).not.toBe('');
  });

  it('speaks the ends apart in feet for an imperial athlete', async () => {
    const slider = (await groupingPanel()).getByTestId('grouping-slider-endpointThreshold');

    expect(slider.props.accessibilityValue.text).toBe('656 ft');
  });

  it('speaks the overlap as a percentage', async () => {
    const slider = (await groupingPanel()).getByTestId('grouping-slider-minMatchPercentage');

    expect(slider.props.accessibilityValue.text).toBe('65%');
  });
});

describe('the typed editor', () => {
  it.each(Object.keys(detection))(
    'tells a screen reader the %s caption takes a value',
    async (key) => {
      const edit = (await detectionPanel()).getByTestId(`param-edit-${key}`);

      expect(edit.props.accessibilityRole).toBe('button');
      expect(String(edit.props.accessibilityHint ?? '').trim()).not.toBe('');
    }
  );

  it.each(Object.keys(grouping))(
    'tells a screen reader the %s caption takes a value',
    async (key) => {
      const edit = (await groupingPanel()).getByTestId(`grouping-edit-${key}`);

      expect(edit.props.accessibilityRole).toBe('button');
      expect(String(edit.props.accessibilityHint ?? '').trim()).not.toBe('');
    }
  );
});

describe('the presets', () => {
  it('draws each preset as the shared selector chip, the matching one selected', async () => {
    const chips = (await detectionPanel()).UNSAFE_getAllByType(ToggleButton);

    expect(chips.map((chip) => [chip.props.testID, Boolean(chip.props.selected)])).toEqual([
      ['preset-default', true],
      ['preset-strict', false],
      ['preset-relaxed', false],
    ]);
  });

  it('puts the selection on the accessibility state', async () => {
    const tree = await detectionPanel();

    expect(tree.getByTestId('preset-default').props.accessibilityState.selected).toBe(true);
    expect(tree.getByTestId('preset-strict').props.accessibilityState.selected).toBe(false);
  });

  it('selects none once a value leaves every preset', async () => {
    const tree = await render(
      <PreviewParamPanel params={{ ...detection, minActivities: 9 }} onChange={jest.fn()} />
    );

    const chips = tree.UNSAFE_getAllByType(ToggleButton);
    expect(chips).toHaveLength(3);
    for (const chip of chips) {
      expect(Boolean(chip.props.selected)).toBe(false);
    }
  });
});
