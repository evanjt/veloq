/**
 * Scenario: the athlete taps a start and an end on the activity map to make a section.
 * Expected behaviour: the tool runs in the shared map tool bar, headed "New section" with the
 * length once both ends are placed, and the compact bar it used to draw is gone.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  SectionCreationOverlay,
  type CreationState,
} from '@/features/maps/components/SectionCreationOverlay';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false }),
}));

function tool(state: CreationState, over: Record<string, unknown> = {}) {
  const handlers = {
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
    onReset: jest.fn(),
    onDismissError: jest.fn(),
  };
  const placed = state === 'complete' || state === 'creating' || state === 'error';
  const element = (
    <SectionCreationOverlay
      state={state}
      startIndex={state === 'selectingStart' ? null : 10}
      sectionDistance={placed ? 7600 : null}
      sectionPointCount={placed ? 80 : null}
      {...handlers}
      {...over}
    />
  );
  return { element, handlers };
}

describe('section creation in the map tool bar', () => {
  it('heads the bar with the name and the live length, and saves from Save', async () => {
    const { element, handlers } = tool('complete');
    await render(element);
    expect(screen.getByTestId('map-tool-bar')).toBeTruthy();
    expect(screen.getByText('maps.newSection · 7.6 km')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'common.save' }));
    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'common.cancel' }));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it('draws none of the old compact bar', async () => {
    await render(tool('complete').element);
    expect(screen.queryByRole('button', { name: 'routes.createSection' })).toBeNull();
    expect(screen.queryByRole('button', { expanded: false })).toBeNull();
  });

  it('prompts for the start with no length and no Save yet', async () => {
    const { element, handlers } = tool('selectingStart');
    await render(element);
    expect(screen.getByText('maps.newSection')).toBeTruthy();
    expect(screen.getByText('maps.tapSelectStart')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'common.save' });
    expect(save).toBeDisabled();
    await fireEvent.press(save);
    expect(handlers.onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'common.reset' })).toBeNull();
  });

  it('offers Reset once a point is placed', async () => {
    const { element, handlers } = tool('selectingEnd');
    await render(element);
    expect(screen.getByText('maps.tapSelectEnd')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'common.reset' }));
    expect(handlers.onReset).toHaveBeenCalledTimes(1);
  });

  it('holds both buttons while the section is being created', async () => {
    const { element, handlers } = tool('creating');
    await render(element);
    await fireEvent.press(screen.getByTestId('map-tool-save'));
    expect(handlers.onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeDisabled();
  });

  it('names the failure in the hint and retries from the done button', async () => {
    const { element, handlers } = tool('error', {
      error: { message: 'Could not save', technicalDetails: 'engine said no' },
    });
    await render(element);
    expect(screen.getByText('Could not save')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }));
    expect(handlers.onDismissError).toHaveBeenCalledTimes(1);
    expect(handlers.onConfirm).not.toHaveBeenCalled();
  });
});
