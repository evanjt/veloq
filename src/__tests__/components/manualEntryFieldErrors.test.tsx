/**
 * Scenario: Continue on the manual entry form with a blank duration or an
 * impossible heart rate showed red text no screen reader heard.
 *
 * Expected behaviour: each refused field carries its error under it in a polite
 * live region, the error rides on the field itself, and iOS announces it.
 */

import { AccessibilityInfo, Platform } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { ManualEntryForm } from '@/features/recording/components/ManualEntryForm';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { navigateTo } from '@/shared/app/navigation';
import { inStack } from '../__shared__/testStack';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

const originalOS = Platform.OS;
let announce: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  useRecordingStore.getState().reset();
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});

afterEach(() => {
  Platform.OS = originalOS;
  announce.mockRestore();
});

function liveRegionOf(node: ReactTestInstance): string | undefined {
  for (let at: ReactTestInstance | null = node; at; at = at.parent) {
    if (at.props.accessibilityLiveRegion) return at.props.accessibilityLiveRegion;
  }
  return undefined;
}

it('says a blank duration is refused, in a live region on the field', async () => {
  Platform.OS = 'android';
  const view = await render(inStack(<ManualEntryForm activityType="Yoga" bottomPadding={0} />));
  await fireEvent.press(view.getByTestId('manual-entry-continue'));

  const error = view.getByTestId('manual-entry-duration-error');
  expect(error).toHaveTextContent('recording.durationRequired');
  expect(liveRegionOf(error)).toBe('polite');
  expect(view.getByTestId('manual-entry-duration').props.accessibilityHint).toBe(
    'recording.durationRequired'
  );
  expect(navigateTo).not.toHaveBeenCalled();
});

it('announces a refused heart rate on iOS', async () => {
  Platform.OS = 'ios';
  const view = await render(inStack(<ManualEntryForm activityType="Yoga" bottomPadding={0} />));
  await fireEvent.changeText(view.getByTestId('manual-entry-duration'), '30');
  await fireEvent.changeText(view.getByTestId('manual-entry-hr'), '400');
  await fireEvent.press(view.getByTestId('manual-entry-continue'));

  expect(view.getByTestId('manual-entry-hr-error')).toHaveTextContent('recording.hrInvalid');
  expect(view.queryByTestId('manual-entry-duration-error')).toBeNull();
  expect(announce).toHaveBeenCalledWith('recording.hrInvalid');
});

it('says a distance past 999 is refused and clears it once edited', async () => {
  const view = await render(inStack(<ManualEntryForm activityType="Yoga" bottomPadding={0} />));
  await fireEvent.changeText(view.getByTestId('manual-entry-duration'), '30');
  await fireEvent.changeText(view.getByTestId('manual-entry-distance'), '1200');
  await fireEvent.press(view.getByTestId('manual-entry-continue'));
  expect(view.getByTestId('manual-entry-distance-error')).toHaveTextContent(
    'recording.distanceInvalid'
  );

  await fireEvent.changeText(view.getByTestId('manual-entry-distance'), '12');
  expect(view.queryByTestId('manual-entry-distance-error')).toBeNull();
});
