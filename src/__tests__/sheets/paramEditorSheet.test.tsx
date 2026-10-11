import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ParamEditorSheet from '@/app/sheets/param-editor';
import { PreviewParamPanel } from '@/features/routes/components/preview/PreviewParamPanel';
import { GroupingParamPanel } from '@/features/routes/components/preview/GroupingParamPanel';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { request?: string } = {};

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/useTheme', () => ({
  useTheme: () => ({ isDark: false }),
}));
jest.mock('@/shared/app/useMetricSystem', () => ({
  useMetricSystem: () => true,
}));

const detection = {
  proximityThreshold: 200,
  minSectionLength: 150,
  maxSectionLength: 200000,
  minActivities: 2,
  divergenceThreshold: 0.15,
};
const grouping = { minMatchPercentage: 55, endpointThreshold: 250 };

function openPanel(kind: 'param' | 'grouping', editKey?: string) {
  const onChange = jest.fn();
  const panel = render(
    kind === 'param' ? (
      <PreviewParamPanel params={detection} onChange={onChange} />
    ) : (
      <GroupingParamPanel params={grouping} onChange={onChange} />
    )
  );
  const key = editKey ?? (kind === 'param' ? 'maxSectionLength' : 'endpointThreshold');
  fireEvent.press(panel.getByTestId(`${kind}-edit-${key}`));
  expect(mockPush.mock.calls.at(-1)?.[0].pathname).toBe('sheets/param-editor');
  mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
  const sheet = render(<ParamEditorSheet />);
  return { onChange, sheet, panel, prefix: `${kind}-editor` };
}

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockParams = {};
});

for (const kind of ['param', 'grouping'] as const) {
  it(`${kind} resolves a parsed value through the sheet`, async () => {
    const { onChange, prefix } = openPanel(kind);
    fireEvent.changeText(screen.getByTestId(`${prefix}-input`), '500');
    fireEvent.press(screen.getByTestId(`${prefix}-save`));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        kind === 'param'
          ? { ...detection, maxSectionLength: 500000 }
          : { ...grouping, endpointThreshold: 500 }
      )
    );
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it(`${kind} keeps refused text in the sheet`, () => {
    const { onChange, prefix } = openPanel(kind);
    fireEvent.changeText(screen.getByTestId(`${prefix}-input`), 'wide');
    fireEvent.press(screen.getByTestId(`${prefix}-save`));
    expect(screen.getByTestId(`${prefix}-input`).props.value).toBe('wide');
    expect(onChange).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it(`${kind} cancels without changing the panel`, async () => {
    const { onChange, sheet, prefix } = openPanel(kind);
    fireEvent.changeText(screen.getByTestId(`${prefix}-input`), '500');
    await act(async () => {
      sheet.unmount();
      await Promise.resolve();
    });
    expect(onChange).not.toHaveBeenCalled();
  });
}

describe('a value the sheet refuses', () => {
  it('names the problem under the field and holds Save for a zero distance', () => {
    const { onChange } = openPanel('param');
    fireEvent.changeText(screen.getByTestId('param-editor-input'), '0');

    expect(screen.getByTestId('param-editor-input-error')).toBeTruthy();
    const save = screen.getByTestId('param-editor-save');
    expect(save.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(save);
    expect(onChange).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('names the problem for a blank field', () => {
    openPanel('param');
    fireEvent.changeText(screen.getByTestId('param-editor-input'), '');
    expect(screen.getByTestId('param-editor-input-error')).toBeTruthy();
  });

  it('refuses a match percentage past 100 with its own message', () => {
    const { onChange } = openPanel('grouping', 'minMatchPercentage');
    fireEvent.changeText(screen.getByTestId('grouping-editor-input'), '120');

    expect(screen.getByTestId('grouping-editor-input-error')).toHaveTextContent(
      'settings.groupingParamInvalidPercent'
    );
    const save = screen.getByTestId('grouping-editor-save');
    expect(save.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(save);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the error and frees Save once the value is valid again', () => {
    openPanel('param');
    fireEvent.changeText(screen.getByTestId('param-editor-input'), '0');
    fireEvent.changeText(screen.getByTestId('param-editor-input'), '50');
    expect(screen.queryByTestId('param-editor-input-error')).toBeNull();
    expect(screen.getByTestId('param-editor-save').props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  it('accepts a value past the tested range without an error', () => {
    openPanel('param');
    fireEvent.changeText(screen.getByTestId('param-editor-input'), '5000');
    expect(screen.queryByTestId('param-editor-input-error')).toBeNull();
    expect(screen.getByTestId('param-editor-range-note')).toBeTruthy();
  });

  it('carries the unit in the field name a screen reader reads', () => {
    openPanel('param');
    expect(screen.getByTestId('param-editor-input').props.accessibilityLabel).toContain('km');
  });
});
