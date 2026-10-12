import { fireEvent, render } from '@testing-library/react-native';

import { ManualEntryForm } from '@/features/recording/components/ManualEntryForm';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { navigateTo } from '@/shared/app/navigation';
import { useMetricSystem } from '@/shared/app/useMetricSystem';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: jest.fn(() => true) }));

const metric = jest.mocked(useMetricSystem);

beforeEach(() => {
  jest.clearAllMocks();
  metric.mockReturnValue(true);
  useRecordingStore.getState().reset();
});

function continueWith(fields: { duration?: string; distance?: string; hr?: string }) {
  const view = render(<ManualEntryForm activityType="Run" bottomPadding={0} />);
  if (fields.duration != null)
    fireEvent.changeText(view.getByTestId('manual-entry-duration'), fields.duration);
  if (fields.distance != null)
    fireEvent.changeText(view.getByTestId('manual-entry-distance'), fields.distance);
  if (fields.hr != null) fireEvent.changeText(view.getByTestId('manual-entry-hr'), fields.hr);
  fireEvent.press(view.getByTestId('manual-entry-continue'));
  return view;
}

function reviewParams(): Record<string, string | undefined> {
  expect(navigateTo).toHaveBeenCalledTimes(1);
  return (jest.mocked(navigateTo).mock.calls[0]![0] as { params: Record<string, string> }).params;
}

it('carries a decimal comma into review as the whole value', () => {
  continueWith({ duration: '45,5', distance: '10,5', hr: '150' });

  const params = reviewParams();
  expect(params.durationSeconds).toBe('2730');
  expect(params.distance).toBe('10500');
  expect(params.avgHr).toBe('150');
});

it('refuses a number it cannot read whole rather than truncating it', () => {
  const view = continueWith({ duration: '45', distance: '10,5,1' });

  expect(navigateTo).not.toHaveBeenCalled();
  expect(view.getByText(/^recording\.distanceInvalid/)).toBeTruthy();
});

it('refuses a duration with trailing text', () => {
  const view = continueWith({ duration: '45min' });

  expect(navigateTo).not.toHaveBeenCalled();
  expect(view.getByText(/^recording\.durationRequired/)).toBeTruthy();
});

it('reads the distance in miles for an imperial athlete and saves metres', () => {
  metric.mockReturnValue(false);
  const view = continueWith({ duration: '60', distance: '10,5' });

  expect(view.getByTestId('manual-entry-distance').props.accessibilityLabel).toContain(
    '"unit":"mi"'
  );
  expect(reviewParams().distance).toBe('16898');
});

it('labels the distance in kilometres for a metric athlete', () => {
  const view = render(<ManualEntryForm activityType="Run" bottomPadding={0} />);

  expect(view.getByTestId('manual-entry-distance').props.accessibilityLabel).toContain(
    '"unit":"km"'
  );
});

it('caps the distance in the unit the athlete reads', () => {
  metric.mockReturnValue(false);
  continueWith({ duration: '600', distance: '999' });
  expect(Number(reviewParams().distance)).toBe(1607735);

  jest.clearAllMocks();
  continueWith({ duration: '600', distance: '999,5' });
  expect(navigateTo).not.toHaveBeenCalled();
});

it('offers a decimal pad for decimals and a number pad for heart rate', () => {
  const view = render(<ManualEntryForm activityType="Run" bottomPadding={0} />);

  expect(view.getByTestId('manual-entry-duration').props.keyboardType).toBe('decimal-pad');
  expect(view.getByTestId('manual-entry-distance').props.keyboardType).toBe('decimal-pad');
  expect(view.getByTestId('manual-entry-hr').props.keyboardType).toBe('number-pad');
});
