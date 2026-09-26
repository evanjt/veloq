/**
 * Scenario: every one-tap surface, the home-screen widget, an iOS Control and a
 * launcher shortcut, deep-links straight to the recording screen, which used to
 * call `startRecording` in a mount effect. A pocket tap therefore recorded a
 * ride, wrote its FIT backup and left the athlete something to stop and
 * discard.
 *
 * Expected behaviour, Evan's decision of 2026-09-11: "Tap arms the recording
 * screen with the sport chosen and a 3 s countdown that auto-starts unless
 * cancelled: one tap in practice, accident-proof." The picker path, where the
 * athlete has already tapped twice, keeps starting on arrival.
 */
import { ARM_COUNTDOWN_SECONDS, planRecordingStart } from '@/features/recording/lib/armCountdown';

describe('planRecordingStart', () => {
  it('arms a countdown for a one-tap entry', () => {
    expect(planRecordingStart({ canRecord: true, status: 'idle', from: 'quickstart' })).toBe('arm');
  });

  it('starts at once when the athlete came through the picker', () => {
    expect(planRecordingStart({ canRecord: true, status: 'idle', from: undefined })).toBe('start');
    expect(planRecordingStart({ canRecord: true, status: 'idle', from: 'picker' })).toBe('start');
  });

  it('does nothing without the permission to record', () => {
    expect(planRecordingStart({ canRecord: false, status: 'idle', from: 'quickstart' })).toBe(
      'nothing'
    );
    expect(planRecordingStart({ canRecord: false, status: 'idle', from: undefined })).toBe(
      'nothing'
    );
  });

  it('does nothing when a recording is already under way', () => {
    for (const status of ['recording', 'paused', 'stopped'] as const) {
      expect(planRecordingStart({ canRecord: true, status, from: 'quickstart' })).toBe('nothing');
      expect(planRecordingStart({ canRecord: true, status, from: undefined })).toBe('nothing');
    }
  });

  it('counts down for three seconds, which is what the decision names', () => {
    expect(ARM_COUNTDOWN_SECONDS).toBe(3);
  });
});
