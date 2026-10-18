/**
 * Scenario: creating a section and editing its bounds are both work done on the map.
 * Expected behaviour: both run through one bar that names the tool with its live length, gives a
 * hint, and offers Cancel and Save as labelled buttons.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { MapToolBar } from '@/features/maps/components/MapToolBar';
import { mapToolTitle } from '@/features/maps/lib/mapToolTitle';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false }),
}));

describe('mapToolTitle', () => {
  it('joins the label and the length in metric', () => {
    expect(mapToolTitle('New section', 7600, true)).toBe('New section · 7.6 km');
  });

  it('gives the length in miles in imperial', () => {
    expect(mapToolTitle('New section', 7600, false)).toBe('New section · 4.7 mi');
  });

  it('shows the label alone before there is a length', () => {
    expect(mapToolTitle('New section', null, true)).toBe('New section');
  });

  it('shows a zero length rather than dropping it', () => {
    expect(mapToolTitle('Edit bounds', 0, true)).toBe('Edit bounds · 0 m');
  });
});

function bar(over: Partial<React.ComponentProps<typeof MapToolBar>> = {}) {
  const props = {
    title: 'New section · 7.6 km',
    hint: 'Tap to select end point',
    onCancel: jest.fn(),
    onDone: jest.fn(),
    ...over,
  };
  return { props, element: <MapToolBar {...props} /> };
}

describe('MapToolBar', () => {
  it('shows the title, the hint, and Cancel and Save with visible text', async () => {
    await render(bar().element);
    expect(screen.getByText('New section · 7.6 km')).toBeTruthy();
    expect(screen.getByText('Tap to select end point')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common.cancel' })).toHaveTextContent(
      'common.cancel'
    );
    expect(screen.getByRole('button', { name: 'common.save' })).toHaveTextContent('common.save');
  });

  it('calls onDone from Save and onCancel from Cancel, once each', async () => {
    const { props, element } = bar();
    await render(element);
    await fireEvent.press(screen.getByRole('button', { name: 'common.save' }));
    expect(props.onDone).toHaveBeenCalledTimes(1);
    expect(props.onCancel).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'common.cancel' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('refuses Save while it is disabled or busy', async () => {
    const disabled = bar({ doneDisabled: true });
    const view = await render(disabled.element);
    await fireEvent.press(screen.getByRole('button', { name: 'common.save' }));
    expect(disabled.props.onDone).not.toHaveBeenCalled();
    await view.unmount();

    const busy = bar({ busy: true });
    await render(busy.element);
    const save = screen.getByTestId('map-tool-save');
    await fireEvent.press(save);
    expect(busy.props.onDone).not.toHaveBeenCalled();
    // A write under way cannot be taken back, so Cancel is held with it.
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeDisabled();
  });

  it('draws Reset as a labelled secondary only when one is offered', async () => {
    const onReset = jest.fn();
    const view = await render(bar({ reset: { onPress: onReset } }).element);
    await fireEvent.press(screen.getByRole('button', { name: 'common.reset' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    await view.unmount();

    await render(bar().element);
    expect(screen.queryByRole('button', { name: 'common.reset' })).toBeNull();
  });

  it('takes another word for Save, such as Retry after a failure', async () => {
    await render(bar({ doneLabel: 'common.retry' }).element);
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common.save' })).toBeNull();
  });
});
