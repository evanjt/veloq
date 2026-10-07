/**
 * Scenario: the five sliders reach only the range the detector was validated
 * over, and there was no other way to set a parameter. An athlete who wants to
 * try a 500 km ceiling, or a split sensitivity past where the detector stops
 * distinguishing, had nowhere to type it and no way to set all five at once.
 *
 * Expected behaviour: the caption opens a numeric editor that takes a value
 * past the slider and says when the detector will stop telling it apart, and
 * three presets set all five fields together.
 */

import React, { useState } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { PreviewParamPanel } from '@/features/routes/components/preview/PreviewParamPanel';
import { DETECTION_PRESETS } from '@/features/routes/lib/detectionParams';

import ParamEditorSheet from '@/app/sheets/param-editor';

let mockSetRoute: (request: string | null) => void = () => {};
let mockRequest: string | undefined;
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: ({ params }: { params: { request: string } }) => mockSetRoute(params.request),
    back: () => mockSetRoute(null),
  },
  useLocalSearchParams: () => ({ request: mockRequest }),
}));

function renderWithSheet(panel: React.ReactElement) {
  function Harness() {
    const [request, setRequest] = useState<string | null>(null);
    mockSetRoute = setRequest;
    mockRequest = request ?? undefined;
    return (
      <>
        {panel}
        {request && <ParamEditorSheet key={request} />}
      </>
    );
  }
  return render(<Harness />);
}

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join(',')}` : key,
  }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

const params = {
  proximityThreshold: 200,
  minSectionLength: 150,
  maxSectionLength: 200000,
  minActivities: 2,
  divergenceThreshold: 0.15,
};

function panel(overrides: Partial<typeof params> = {}) {
  const onChange = jest.fn();
  const view = renderWithSheet(
    <PreviewParamPanel params={{ ...params, ...overrides }} onChange={onChange} />
  );
  return { ...view, onChange };
}

describe('typing a parameter', () => {
  it('opens on the caption and starts from the value already set', () => {
    const { getByTestId, queryByTestId } = panel();

    expect(queryByTestId('param-editor')).toBeNull();
    fireEvent.press(getByTestId('param-edit-maxSectionLength'));

    expect(getByTestId('param-editor-input').props.value).toBe('200');
  });

  it('takes a value past the slider, which is the reason it exists', async () => {
    const { getByTestId, onChange } = panel();

    fireEvent.press(getByTestId('param-edit-maxSectionLength'));
    fireEvent.changeText(getByTestId('param-editor-input'), '500');
    fireEvent.press(getByTestId('param-editor-save'));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        ...params,
        maxSectionLength: 500000,
      })
    );
  });

  it('says when the detector stops telling the value apart', () => {
    const { getByTestId, queryByTestId } = panel();

    fireEvent.press(getByTestId('param-edit-divergenceThreshold'));
    expect(queryByTestId('param-editor-clamp-note')).toBeNull();

    fireEvent.changeText(getByTestId('param-editor-input'), '0.8');
    expect(getByTestId('param-editor-clamp-note')).toBeTruthy();
  });

  it('refuses a value the detector could not be given, and changes nothing', () => {
    const { getByTestId, onChange } = panel();

    fireEvent.press(getByTestId('param-edit-minSectionLength'));
    fireEvent.changeText(getByTestId('param-editor-input'), 'wide');
    fireEvent.press(getByTestId('param-editor-save'));

    expect(onChange).not.toHaveBeenCalled();
    expect(getByTestId('param-editor')).toBeTruthy();
  });

  it('leaves the value alone when the edit is cancelled', () => {
    const { getByTestId, queryByTestId, onChange } = panel();

    fireEvent.press(getByTestId('param-edit-minActivities'));
    fireEvent.changeText(getByTestId('param-editor-input'), '7');
    fireEvent.press(getByTestId('param-editor-cancel'));

    expect(onChange).not.toHaveBeenCalled();
    expect(queryByTestId('param-editor')).toBeNull();
  });

  it('grows the slider to reach a value typed past its end', () => {
    const { UNSAFE_getAllByType } = renderWithSheet(
      <PreviewParamPanel params={{ ...params, maxSectionLength: 500000 }} onChange={jest.fn()} />
    );
    const Slider = require('@react-native-community/slider').default;
    const reach = UNSAFE_getAllByType(Slider).map((s) => s.props.maximumValue);

    expect(reach).toContain(500000);
  });
});

describe('the presets', () => {
  it('set all five fields at once', () => {
    const { getByTestId, onChange } = panel();

    fireEvent.press(getByTestId('preset-strict'));

    expect(onChange).toHaveBeenCalledWith(DETECTION_PRESETS.strict);
  });

  it('offer the way back to the configuration the detector is validated at', () => {
    const { getByTestId, onChange } = panel({ minActivities: 9 });

    fireEvent.press(getByTestId('preset-default'));

    expect(onChange).toHaveBeenCalledWith(DETECTION_PRESETS.default);
  });
});

describe('a run in flight', () => {
  it('closes the editor and the presets, not just the sliders', () => {
    const { getByTestId, queryByTestId } = renderWithSheet(
      <PreviewParamPanel params={params} onChange={jest.fn()} disabled />
    );

    fireEvent.press(getByTestId('param-edit-minActivities'));
    expect(queryByTestId('param-editor')).toBeNull();
    expect(getByTestId('preset-strict').props.accessibilityState.disabled).toBe(true);
  });
});
