/**
 * Scenario: the sheet laid over the preview map.
 * Expected behaviour: collapsed it shows the summary and hides the controls without
 * unmounting them, so a slider keeps its value. The handle opens and closes it.
 */

import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { PreviewSheet } from '@/features/routes/components/preview/PreviewSheet';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

function renderSheet() {
  return render(
    <PreviewSheet summary={<Text testID="summary">diff</Text>} bottomInset={0} testID="sheet">
      <Text testID="controls">sliders</Text>
    </PreviewSheet>
  );
}

describe('PreviewSheet', () => {
  it('opens collapsed: the summary shows and the controls are hidden but mounted', async () => {
    const tree = await renderSheet();

    expect(tree.getByTestId('summary')).toBeTruthy();
    expect(tree.queryByTestId('controls')).toBeNull();
    expect(tree.getByTestId('controls', { includeHiddenElements: true })).toBeTruthy();
    expect(tree.getByTestId('sheet-handle').props.accessibilityState).toMatchObject({
      expanded: false,
    });
  });

  it('shows the controls when the handle is pressed and hides them on a second press', async () => {
    const tree = await renderSheet();

    await fireEvent.press(tree.getByTestId('sheet-handle'));
    expect(tree.getByTestId('controls')).toBeTruthy();
    expect(tree.getByTestId('summary')).toBeTruthy();

    await fireEvent.press(tree.getByTestId('sheet-handle'));
    expect(tree.queryByTestId('controls')).toBeNull();
  });
});
