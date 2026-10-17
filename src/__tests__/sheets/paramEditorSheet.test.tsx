import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ParamEditorSheet from '@/app/sheets/param-editor';
import { PreviewParamPanel } from '@/features/routes/components/preview/PreviewParamPanel';
import { GroupingParamPanel } from '@/features/routes/components/preview/GroupingParamPanel';
import { colors } from '@/theme';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { request?: string } = {};

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    canGoBack: () => true,
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

async function openPanel(kind: 'param' | 'grouping', editKey?: string) {
  const onChange = jest.fn();
  const panel = await render(
    kind === 'param' ? (
      <PreviewParamPanel params={detection} onChange={onChange} />
    ) : (
      <GroupingParamPanel params={grouping} onChange={onChange} />
    )
  );
  const key = editKey ?? (kind === 'param' ? 'maxSectionLength' : 'endpointThreshold');
  void fireEvent.press(panel.getByTestId(`${kind}-edit-${key}`));
  expect(mockPush.mock.calls.at(-1)?.[0].pathname).toBe('sheets/param-editor');
  mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
  const sheet = await render(<ParamEditorSheet />);
  return { onChange, sheet, panel, prefix: `${kind}-editor` };
}

const realOS = Platform.OS;

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const style = node.props.style;
  const resolved =
    typeof style === 'function'
      ? (style as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : style;
  return StyleSheet.flatten(resolved as never) as Record<string, unknown>;
}

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockParams = {};
});
afterEach(() => {
  Platform.OS = realOS;
});

for (const kind of ['param', 'grouping'] as const) {
  it(`${kind} resolves a parsed value through the sheet`, async () => {
    const { onChange, prefix } = await openPanel(kind);
    await fireEvent.changeText(screen.getByTestId(`${prefix}-input`), '500');
    await fireEvent.press(screen.getByTestId(`${prefix}-save`));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        kind === 'param'
          ? { ...detection, maxSectionLength: 500000 }
          : { ...grouping, endpointThreshold: 500 }
      )
    );
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it(`${kind} keeps refused text in the sheet`, async () => {
    const { onChange, prefix } = await openPanel(kind);
    await fireEvent.changeText(screen.getByTestId(`${prefix}-input`), 'wide');
    await fireEvent.press(screen.getByTestId(`${prefix}-save`));
    expect(screen.getByTestId(`${prefix}-input`).props.value).toBe('wide');
    expect(onChange).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it(`${kind} says why it refuses a value of zero and holds Save`, async () => {
    const { onChange, prefix } = await openPanel(kind);
    expect(screen.queryByTestId(`${prefix}-input-error`)).toBeNull();
    await fireEvent.changeText(screen.getByTestId(`${prefix}-input`), '0');

    expect(screen.getByTestId(`${prefix}-input-error`)).toBeTruthy();
    expect(screen.getByTestId(`${prefix}-save`).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await fireEvent.press(screen.getByTestId(`${prefix}-save`));
    expect(onChange).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it(`${kind} names its field by the parameter`, async () => {
    const { prefix } = await openPanel(kind);
    const input = screen.getByTestId(`${prefix}-input`);
    expect(input.props.accessibilityLabel).toMatch(/^settings\./);
    expect(input.props.returnKeyType).toBe('done');
  });

  it(`${kind} cancels without changing the panel`, async () => {
    const { onChange, sheet, prefix } = await openPanel(kind);
    await fireEvent.changeText(screen.getByTestId(`${prefix}-input`), '500');
    await act(async () => {
      await sheet.unmount();
      await Promise.resolve();
    });
    expect(onChange).not.toHaveBeenCalled();
  });
}

describe('a value the sheet refuses', () => {
  it('names the problem under the field and holds Save for a zero distance', async () => {
    const { onChange } = await openPanel('param');
    await fireEvent.changeText(screen.getByTestId('param-editor-input'), '0');

    expect(screen.getByTestId('param-editor-input-error')).toBeTruthy();
    const save = screen.getByTestId('param-editor-save');
    expect(save.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(save);
    expect(onChange).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('names the problem for a blank field', async () => {
    await openPanel('param');
    await fireEvent.changeText(screen.getByTestId('param-editor-input'), '');
    expect(screen.getByTestId('param-editor-input-error')).toBeTruthy();
  });

  it('refuses a match percentage past 100 with its own message', async () => {
    const { onChange } = await openPanel('grouping', 'minMatchPercentage');
    await fireEvent.changeText(screen.getByTestId('grouping-editor-input'), '120');

    expect(screen.getByTestId('grouping-editor-input-error')).toHaveTextContent(
      'settings.groupingParamInvalidPercent'
    );
    const save = screen.getByTestId('grouping-editor-save');
    expect(save.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(save);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the error and frees Save once the value is valid again', async () => {
    await openPanel('param');
    await fireEvent.changeText(screen.getByTestId('param-editor-input'), '0');
    await fireEvent.changeText(screen.getByTestId('param-editor-input'), '50');
    expect(screen.queryByTestId('param-editor-input-error')).toBeNull();
    expect(screen.getByTestId('param-editor-save').props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  it('accepts a value past the tested range without an error', async () => {
    await openPanel('param');
    await fireEvent.changeText(screen.getByTestId('param-editor-input'), '5000');
    expect(screen.queryByTestId('param-editor-input-error')).toBeNull();
    expect(screen.getByTestId('param-editor-range-note')).toBeTruthy();
  });

  it('carries the unit in the field name a screen reader reads', async () => {
    await openPanel('param');
    expect(screen.getByTestId('param-editor-input').props.accessibilityLabel).toContain('km');
  });
});

describe.each(['param', 'grouping'] as const)('%s editor sheet chrome', (kind) => {
  it('titles the sheet with a heading', async () => {
    await openPanel(kind);
    expect(screen.getByRole('header')).toBeTruthy();
  });

  it('emphasises Save over Cancel on iOS', async () => {
    Platform.OS = 'ios';
    const { prefix } = await openPanel(kind);
    expect(styleOf(screen.getByTestId(`${prefix}-save-label`)).fontWeight).toBe('600');
    expect(styleOf(screen.getByTestId(`${prefix}-cancel-label`)).fontWeight).toBe('400');
  });

  it('draws Save as the primary button on Android', async () => {
    Platform.OS = 'android';
    const { prefix } = await openPanel(kind);
    expect(styleOf(screen.getByTestId(`${prefix}-save`)).backgroundColor).toBe(
      colors.actionPrimary
    );
    expect(styleOf(screen.getByTestId(`${prefix}-cancel`)).backgroundColor).toBe('transparent');
  });
});
