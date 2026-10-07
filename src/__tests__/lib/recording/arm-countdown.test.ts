/**
 * Scenario: every one-tap surface, the home-screen widget, an iOS Control and a
 * launcher shortcut, deep-links straight to the recording screen, which used to
 * call `startRecording` in a mount effect. A pocket tap therefore recorded a
 * ride, wrote its FIT backup and left the athlete something to stop and
 * discard.
 *
 * Expected behaviour: those arrivals leave the screen idle with its Start
 * button. The entry screen's Start and the picker begin on arrival.
 */
import {
  canStartAfterScopeWarning,
  planRecordingStart,
} from '@/features/recording/lib/armCountdown';

describe('recording after a scope warning', () => {
  it('allows the chosen local ride but not an unknown or missing account', () => {
    expect(canStartAfterScopeWarning(false, 'no_permission', true)).toBe(true);
    expect(canStartAfterScopeWarning(false, 'no_permission', false)).toBe(false);
    expect(canStartAfterScopeWarning(false, 'checking', true)).toBe(false);
    expect(canStartAfterScopeWarning(false, 'not_signed_in', true)).toBe(false);
    expect(canStartAfterScopeWarning(true, 'ok', false)).toBe(true);
  });
});

describe('planRecordingStart', () => {
  it('leaves a one-tap entry idle', () => {
    expect(planRecordingStart({ canRecord: true, status: 'idle', from: 'quickstart' })).toBe(
      'nothing'
    );
  });

  it('starts at once for the Start on the entry screen', () => {
    expect(planRecordingStart({ canRecord: true, status: 'idle', from: 'entry' })).toBe('start');
    expect(
      planRecordingStart({ canRecord: true, status: 'idle', from: 'entry', mode: 'manual' })
    ).toBe('nothing');
    expect(planRecordingStart({ canRecord: false, status: 'idle', from: 'entry' })).toBe('nothing');
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

  it('leaves manual entry to its form on either arrival path', () => {
    expect(
      planRecordingStart({ canRecord: true, status: 'idle', from: 'quickstart', mode: 'manual' })
    ).toBe('nothing');
    expect(
      planRecordingStart({ canRecord: true, status: 'idle', from: undefined, mode: 'manual' })
    ).toBe('nothing');
  });
});
