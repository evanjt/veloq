/**
 * Scenario: an athlete adjusts the accuracy filter, the auto-pause delay and the per-sport
 * auto-pause thresholds in recording settings, on metric or imperial units, by touch or with a
 * screen reader.
 *
 * Expected behaviour: each row is one adjustable element reading its value in the athlete's unit,
 * its minus and plus are disabled at the row's bounds, and a press steps a whole unit of the
 * displayed system (15 ft, 0.5 mph) while the store keeps metres and km/h.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import RecordingSettingsScreen from '@/app/recording-settings';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { KM_TO_MI, M_TO_FT } from '@/shared/format/format';

let mockIsMetric = true;

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { textSecondary: '#888' } }),
  useMetricSystem: () => mockIsMetric,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

function disabled(node: { props: { accessibilityState?: { disabled?: boolean } } }) {
  return node.props.accessibilityState?.disabled === true;
}

beforeEach(() => {
  mockIsMetric = true;
  useRecordingPreferences.setState({
    autoPauseEnabled: true,
    accuracyRejectThreshold: 50,
    autoPauseDurationMs: 5000,
    autoPauseThresholds: { cycling: 2, running: 1, walking: 0.5 },
  });
});

describe('recording settings steppers', () => {
  it('exposes the accuracy filter at its ceiling as one adjustable element with plus disabled', async () => {
    useRecordingPreferences.setState({ accuracyRejectThreshold: 100 });
    const view = await render(<RecordingSettingsScreen />);
    const stepper = view.getByTestId('settings-accuracy-filter-value');
    expect(stepper.props.accessibilityRole).toBe('adjustable');
    expect(stepper.props.accessibilityLabel).toBe('Accuracy filter');
    expect(stepper.props.accessibilityValue).toEqual({ text: '100 m' });
    expect(disabled(view.getByTestId('settings-accuracy-filter-plus'))).toBe(true);
    expect(disabled(view.getByTestId('settings-accuracy-filter-minus'))).toBe(false);
  });

  it('gives every stepper row exactly one adjustable element', async () => {
    const view = await render(<RecordingSettingsScreen />);
    expect(view.getAllByRole('adjustable')).toHaveLength(5);
  });

  it('disables minus on the accuracy filter at its floor', async () => {
    useRecordingPreferences.setState({ accuracyRejectThreshold: 10 });
    const view = await render(<RecordingSettingsScreen />);
    expect(disabled(view.getByTestId('settings-accuracy-filter-minus'))).toBe(true);
    await fireEvent.press(view.getByTestId('settings-accuracy-filter-minus'));
    expect(useRecordingPreferences.getState().accuracyRejectThreshold).toBe(10);
  });

  it('disables the auto-pause delay at both ends', async () => {
    useRecordingPreferences.setState({ autoPauseDurationMs: 10_000 });
    const top = await render(<RecordingSettingsScreen />);
    expect(disabled(top.getByTestId('settings-auto-pause-delay-plus'))).toBe(true);
    await top.unmount();

    useRecordingPreferences.setState({ autoPauseDurationMs: 1000 });
    const bottom = await render(<RecordingSettingsScreen />);
    expect(disabled(bottom.getByTestId('settings-auto-pause-delay-minus'))).toBe(true);
  });

  it('disables a sport threshold at its ceiling', async () => {
    useRecordingPreferences.setState({
      autoPauseThresholds: { cycling: 10, running: 1, walking: 0.5 },
    });
    const view = await render(<RecordingSettingsScreen />);
    expect(disabled(view.getByTestId('settings-threshold-cycling-plus'))).toBe(true);
    expect(disabled(view.getByTestId('settings-threshold-walking-minus'))).toBe(true);
  });

  it('steps metric rows by 5 m, 0.5 s and 0.5 km/h', async () => {
    const view = await render(<RecordingSettingsScreen />);
    await fireEvent.press(view.getByTestId('settings-accuracy-filter-plus'));
    await fireEvent.press(view.getByTestId('settings-auto-pause-delay-minus'));
    await fireEvent.press(view.getByTestId('settings-threshold-cycling-plus'));
    const state = useRecordingPreferences.getState();
    expect(state.accuracyRejectThreshold).toBe(55);
    expect(state.autoPauseDurationMs).toBe(4500);
    expect(state.autoPauseThresholds.cycling).toBe(2.5);
    expect(view.getByTestId('settings-accuracy-filter-value').props.accessibilityValue).toEqual({
      text: '55 m',
    });
  });

  it('steps the accuracy filter by 15 ft for an imperial athlete and stores metres', async () => {
    mockIsMetric = false;
    useRecordingPreferences.setState({ accuracyRejectThreshold: 45 / M_TO_FT });
    const view = await render(<RecordingSettingsScreen />);
    const stepper = () => view.getByTestId('settings-accuracy-filter-value');
    expect(stepper().props.accessibilityValue).toEqual({ text: '45 ft' });

    await fireEvent.press(view.getByTestId('settings-accuracy-filter-plus'));
    expect(stepper().props.accessibilityValue).toEqual({ text: '60 ft' });
    expect(useRecordingPreferences.getState().accuracyRejectThreshold).toBeCloseTo(60 / M_TO_FT, 9);

    await fireEvent(stepper(), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(stepper().props.accessibilityValue).toEqual({ text: '75 ft' });
  });

  it('steps a sport threshold by 0.5 mph for an imperial athlete and stores km/h', async () => {
    mockIsMetric = false;
    const view = await render(<RecordingSettingsScreen />);
    const stepper = () => view.getByTestId('settings-threshold-cycling-value');
    expect(stepper().props.accessibilityValue).toEqual({ text: '1.2 mph' });

    await fireEvent.press(view.getByTestId('settings-threshold-cycling-plus'));
    expect(stepper().props.accessibilityValue).toEqual({ text: '1.5 mph' });
    expect(useRecordingPreferences.getState().autoPauseThresholds.cycling).toBeCloseTo(
      1.5 / KM_TO_MI,
      9
    );

    await fireEvent.press(view.getByTestId('settings-threshold-cycling-plus'));
    expect(stepper().props.accessibilityValue).toEqual({ text: '2.0 mph' });
  });
});
