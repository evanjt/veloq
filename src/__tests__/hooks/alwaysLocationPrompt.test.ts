/**
 * Scenario: a rider starts a ride from a widget, a control, a shortcut or the
 * tile. That is the moment the Always location dialog earns itself, and the only
 * one: iOS shows it once and a denial is expensive to walk back.
 *
 * Expected behaviour: ask once ever, only from a quick-start surface, only once
 * When In Use is already held, and only after the ride is running so a refusal
 * costs the athlete nothing. A refusal leaves every existing path working, which
 * is the case most athletes will be on and so the one tested first.
 */

import { renderHook, waitFor } from '@testing-library/react-native';

import { useAlwaysLocationPrompt } from '@/features/recording/hooks/useAlwaysLocationPrompt';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';

const mockRequestBackground = jest.fn();
const mockGetForeground = jest.fn();

jest.mock('expo-location', () => ({
  requestBackgroundPermissionsAsync: (...a: unknown[]) => mockRequestBackground(...a),
  getForegroundPermissionsAsync: (...a: unknown[]) => mockGetForeground(...a),
}));

const marked = () => useRecordingPreferences.getState().alwaysLocationAsked;

function render(opts: { fromQuickStart: boolean; recording: boolean }) {
  return renderHook(() =>
    useAlwaysLocationPrompt(opts.fromQuickStart, opts.recording ? 'recording' : 'idle')
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetForeground.mockResolvedValue({ status: 'granted' });
  mockRequestBackground.mockResolvedValue({ status: 'granted' });
  useRecordingPreferences.setState({ alwaysLocationAsked: false, isLoaded: true });
});

describe('the Always prompt is asked once, at the moment it earns the dialog', () => {
  it('asks when a quick-start surface has a ride running', async () => {
    render({ fromQuickStart: true, recording: true });
    await waitFor(() => expect(mockRequestBackground).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(marked()).toBe(true));
  });

  it('does not ask from an in-app start, which needs nothing extra', async () => {
    render({ fromQuickStart: false, recording: true });
    await waitFor(() => expect(marked()).toBe(false));
    expect(mockRequestBackground).not.toHaveBeenCalled();
  });

  it('waits for the ride to be running, so a refusal costs nothing', async () => {
    render({ fromQuickStart: true, recording: false });
    await waitFor(() => expect(marked()).toBe(false));
    expect(mockRequestBackground).not.toHaveBeenCalled();
  });

  it('never asks twice, because iOS only shows it once', async () => {
    useRecordingPreferences.setState({ alwaysLocationAsked: true });
    render({ fromQuickStart: true, recording: true });
    await waitFor(() => expect(mockGetForeground).not.toHaveBeenCalled());
    expect(mockRequestBackground).not.toHaveBeenCalled();
  });

  it('does not ask before When In Use is held: Always is an upgrade, not a first ask', async () => {
    mockGetForeground.mockResolvedValue({ status: 'denied' });
    render({ fromQuickStart: true, recording: true });
    await waitFor(() => expect(mockGetForeground).toHaveBeenCalled());
    expect(mockRequestBackground).not.toHaveBeenCalled();
    expect(marked()).toBe(false);
  });

  it('waits for the preferences to load, or it would ask a second time on a restart', async () => {
    useRecordingPreferences.setState({ isLoaded: false });
    render({ fromQuickStart: true, recording: true });
    await waitFor(() => expect(mockGetForeground).not.toHaveBeenCalled());
    expect(mockRequestBackground).not.toHaveBeenCalled();
  });
});

describe('a refusal breaks nothing', () => {
  it('records the ask so the athlete is never nagged again', async () => {
    mockRequestBackground.mockResolvedValue({ status: 'denied' });
    render({ fromQuickStart: true, recording: true });
    await waitFor(() => expect(marked()).toBe(true));
  });

  it('survives the request throwing, which is what a refusal can look like', async () => {
    mockRequestBackground.mockRejectedValue(new Error('no'));
    render({ fromQuickStart: true, recording: true });
    await waitFor(() => expect(marked()).toBe(true));
  });
});
