import { extractPushPayload } from '@/features/insights/lib/pushPayload';

const WORKER_PAYLOAD = {
  event_type: 'ACTIVITY_UPLOADED',
  athlete_id: 'i12345',
  activity_id: 'a99',
};

describe('extractPushPayload', () => {
  it('reads the dataString shape (iOS JSON string wrap)', () => {
    const result = extractPushPayload({ data: { dataString: JSON.stringify(WORKER_PAYLOAD) } });
    expect(result.eventType).toBe('ACTIVITY_UPLOADED');
    expect(result.activityId).toBe('a99');
    expect(result.sourceShape).toBe('dataString');
  });

  it('reads the body shape (Android FCM JSON string wrap)', () => {
    const result = extractPushPayload({ data: { body: JSON.stringify(WORKER_PAYLOAD) } });
    expect(result.eventType).toBe('ACTIVITY_UPLOADED');
    expect(result.activityId).toBe('a99');
    expect(result.sourceShape).toBe('body');
  });

  it('reads a flat data object (the shape the worker sends)', () => {
    const result = extractPushPayload({ data: WORKER_PAYLOAD });
    expect(result.eventType).toBe('ACTIVITY_UPLOADED');
    expect(result.activityId).toBe('a99');
    expect(result.sourceShape).toBe('flat');
  });

  it('reads a nested data.data object', () => {
    const result = extractPushPayload({ data: { data: WORKER_PAYLOAD } });
    expect(result.eventType).toBe('ACTIVITY_UPLOADED');
    expect(result.sourceShape).toBe('nested');
  });

  it('prefers dataString over other shapes when several are present', () => {
    const result = extractPushPayload({
      data: {
        dataString: JSON.stringify({ ...WORKER_PAYLOAD, activity_id: 'from-string' }),
        event_type: 'WELLNESS_UPDATED',
      },
    });
    expect(result.activityId).toBe('from-string');
    expect(result.sourceShape).toBe('dataString');
  });

  it('falls through garbage JSON in dataString to the flat shape', () => {
    const result = extractPushPayload({ data: { dataString: '{not json', ...WORKER_PAYLOAD } });
    expect(result.eventType).toBe('ACTIVITY_UPLOADED');
    expect(result.sourceShape).toBe('flat');
  });

  it('tolerates a null activity_id (non-activity events)', () => {
    const result = extractPushPayload({
      data: { event_type: 'WELLNESS_UPDATED', athlete_id: 'i1', activity_id: null },
    });
    expect(result.eventType).toBe('WELLNESS_UPDATED');
    expect(result.activityId).toBeUndefined();
    expect(result.sourceShape).toBe('flat');
  });

  it('stringifies a numeric activity_id', () => {
    const result = extractPushPayload({
      data: { event_type: 'ACTIVITY_UPLOADED', activity_id: 123 },
    });
    expect(result.activityId).toBe('123');
  });

  it('returns none when there is no event_type anywhere (visible-push wake)', () => {
    const result = extractPushPayload({ notification: { title: 'Activity Recorded' } });
    expect(result.eventType).toBeUndefined();
    expect(result.sourceShape).toBe('none');
    expect(result.rawKeys).toEqual(['notification']);
  });

  it('never throws on undefined, null, or primitive input', () => {
    for (const input of [undefined, null, 42, 'string', []]) {
      const result = extractPushPayload(input);
      expect(result.sourceShape).toBe('none');
      expect(result.eventType).toBeUndefined();
    }
  });
});
