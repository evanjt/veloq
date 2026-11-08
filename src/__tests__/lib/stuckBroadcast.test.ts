/**
 * Scenario: a watch is broadcasting heart rate, the app holds a subscription,
 * and no sample arrives. The watch advertises only while it is broadcasting,
 * so an advertisement seen beside a silent subscription means the broadcast is
 * stuck rather than off.
 *
 * Expected behaviour: wait while the evidence is incomplete, recover once with
 * a fresh service table, then tell the athlete.
 */

import { SENSOR_NO_DATA_MS, stuckBroadcastAction } from '@/features/sensors/lib/connectionHealth';

const silent = {
  advertisementSeen: true,
  samplesSinceSubscribe: 0,
  silentMs: SENSOR_NO_DATA_MS,
  recoveryTried: false,
};

describe('stuckBroadcastAction', () => {
  it('recovers once when the watch advertises and the subscription is silent', () => {
    expect(stuckBroadcastAction(silent)).toBe('recover');
  });

  it('tells the athlete once the recovery has been tried and the link is still silent', () => {
    expect(stuckBroadcastAction({ ...silent, recoveryTried: true })).toBe('tell');
  });

  it('waits when no advertisement was seen, because broadcast is off', () => {
    expect(stuckBroadcastAction({ ...silent, advertisementSeen: false })).toBe('wait');
    expect(stuckBroadcastAction({ ...silent, advertisementSeen: false, recoveryTried: true })).toBe(
      'wait'
    );
  });

  it('waits for a link that has streamed, which resumes by itself', () => {
    expect(stuckBroadcastAction({ ...silent, samplesSinceSubscribe: 1 })).toBe('wait');
  });

  it('waits until the link has been silent for the no-data window', () => {
    expect(stuckBroadcastAction({ ...silent, silentMs: SENSOR_NO_DATA_MS - 1 })).toBe('wait');
    expect(stuckBroadcastAction({ ...silent, silentMs: 0 })).toBe('wait');
  });
});
