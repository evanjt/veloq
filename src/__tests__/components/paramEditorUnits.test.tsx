/**
 * Scenario: an imperial athlete opened a parameter editor captioned in feet or
 * miles and was asked for metres, with the range note in metres too.
 *
 * Expected behaviour: both editors show, bound and take the value in the
 * athlete's unit, and the value saved is metres.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { PreviewParamPanel } from '@/features/routes/components/preview/PreviewParamPanel';
import { GroupingParamPanel } from '@/features/routes/components/preview/GroupingParamPanel';

let mockIsMetric = false;

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join(',')}` : key,
  }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => mockIsMetric,
}));
jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => mockIsMetric }));

const params = {
  proximityThreshold: 200,
  minSectionLength: 150,
  maxSectionLength: 200000,
  minActivities: 2,
  divergenceThreshold: 0.15,
};

beforeEach(() => {
  mockIsMetric = false;
});

describe('the section parameter editor', () => {
  it('shows feet, bounds in feet and saves metres for an imperial athlete', () => {
    const onChange = jest.fn();
    const { getByTestId, getByText } = render(
      <PreviewParamPanel params={params} onChange={onChange} />
    );

    fireEvent.press(getByTestId('param-edit-proximityThreshold'));
    expect(getByTestId('param-editor-input').props.value).toBe('656');
    expect(getByText('settings.sectionParamRange:328 ft,984 ft')).toBeTruthy();

    fireEvent.changeText(getByTestId('param-editor-input'), '500');
    fireEvent.press(getByTestId('param-editor-save'));

    expect(onChange).toHaveBeenCalledWith({ ...params, proximityThreshold: 152 });
  });

  it('edits the long ceiling in miles', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<PreviewParamPanel params={params} onChange={onChange} />);

    fireEvent.press(getByTestId('param-edit-maxSectionLength'));
    expect(getByTestId('param-editor-input').props.value).toBe('124.27');
    fireEvent.changeText(getByTestId('param-editor-input'), '10');
    fireEvent.press(getByTestId('param-editor-save'));

    expect(onChange).toHaveBeenCalledWith({ ...params, maxSectionLength: 16093 });
  });

  it('saving an editor left untouched keeps the stored metres exactly', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<PreviewParamPanel params={params} onChange={onChange} />);

    fireEvent.press(getByTestId('param-edit-maxSectionLength'));
    fireEvent.press(getByTestId('param-editor-save'));

    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ maxSectionLength: 199998 })
    );
  });

  it('leaves metres alone for a metric athlete and the visit count unitless', () => {
    mockIsMetric = true;
    const { getByTestId, getByText } = render(
      <PreviewParamPanel params={params} onChange={jest.fn()} />
    );

    fireEvent.press(getByTestId('param-edit-proximityThreshold'));
    expect(getByTestId('param-editor-input').props.value).toBe('200');
    expect(getByText('settings.sectionParamRange:100 m,300 m')).toBeTruthy();
  });

  it('keeps the visit count and divergence free of a unit', () => {
    const { getByTestId, getByText } = render(
      <PreviewParamPanel params={params} onChange={jest.fn()} />
    );

    fireEvent.press(getByTestId('param-edit-minActivities'));
    expect(getByTestId('param-editor-input').props.value).toBe('2');
    expect(getByText('settings.sectionParamRange:2,10')).toBeTruthy();
  });
});

describe('the grouping parameter editor', () => {
  it('shows feet and saves metres for the endpoint distance', () => {
    const onChange = jest.fn();
    const grouping = { minMatchPercentage: 55, endpointThreshold: 250 };
    const { getByTestId, getByText } = render(
      <GroupingParamPanel params={grouping} onChange={onChange} />
    );

    fireEvent.press(getByTestId('grouping-edit-endpointThreshold'));
    expect(getByTestId('grouping-editor-input').props.value).toBe('820');
    expect(getByText('settings.sectionParamRange:591 ft,984 ft')).toBeTruthy();

    fireEvent.changeText(getByTestId('grouping-editor-input'), '1000');
    fireEvent.press(getByTestId('grouping-editor-save'));

    expect(onChange).toHaveBeenCalledWith({ ...grouping, endpointThreshold: 305 });
  });

  it('keeps the match percentage a percentage', () => {
    const { getByTestId } = render(
      <GroupingParamPanel
        params={{ minMatchPercentage: 55, endpointThreshold: 250 }}
        onChange={jest.fn()}
      />
    );
    fireEvent.press(getByTestId('grouping-edit-minMatchPercentage'));
    expect(getByTestId('grouping-editor-input').props.value).toBe('55');
  });
});
