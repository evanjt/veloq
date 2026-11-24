/**
 * Scenario: dismissing the opt-in card persists the dismissal and nothing else.
 * Expected behaviour: no timer is left running and the state carries no hint flag.
 */
import { setSetting, removeSetting } from '@/shared/storage';
import { useNotificationPrompt } from '@/features/settings/stores/NotificationPromptStore';

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
  removeSetting: jest.fn().mockResolvedValue(undefined),
}));

describe('notification prompt store', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useNotificationPrompt.setState({ dismissed: false, isLoaded: true });
  });
  afterEach(() => jest.useRealTimers());

  it('dismiss persists the dismissal and schedules nothing', () => {
    useNotificationPrompt.getState().dismiss();
    expect(useNotificationPrompt.getState().dismissed).toBe(true);
    expect(setSetting).toHaveBeenCalledWith('veloq-notification-prompt-dismissed', 'true');
    expect(jest.getTimerCount()).toBe(0);
    expect(Object.keys(useNotificationPrompt.getState())).not.toContain('showingSettingsHint');
  });

  it('reset clears the dismissal and its stored flag', () => {
    useNotificationPrompt.getState().dismiss();
    useNotificationPrompt.getState().reset();
    expect(useNotificationPrompt.getState().dismissed).toBe(false);
    expect(removeSetting).toHaveBeenCalledWith('veloq-notification-prompt-dismissed');
  });
});
