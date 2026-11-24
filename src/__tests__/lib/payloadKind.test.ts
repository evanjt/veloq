import { BODY_STORED_CHANNEL, payloadKind } from '@/shared/native/engineChannels';

describe('payloadKind', () => {
  it('reads the kind an announcement names', () => {
    expect(payloadKind({ kind: 'wellness', activityId: '' })).toBe('wellness');
  });

  it('is undefined when the announcement carries no payload', () => {
    expect(payloadKind(undefined)).toBeUndefined();
    expect(payloadKind(null)).toBeUndefined();
  });

  it('is undefined when the kind is not a string', () => {
    expect(payloadKind({ kind: 3 })).toBeUndefined();
    expect(payloadKind({ activityId: 'a1' })).toBeUndefined();
  });

  it('is undefined for a primitive payload', () => {
    expect(payloadKind('calendar')).toBeUndefined();
  });

  it('names the channel the engine announces stored bodies on', () => {
    expect(BODY_STORED_CHANNEL).toBe('bodyStored');
  });
});
