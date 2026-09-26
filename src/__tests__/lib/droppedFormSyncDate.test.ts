import { droppedFormSyncDate } from '@/features/insights/lib/wellnessWindow';

describe('droppedFormSyncDate', () => {
  it('has no caption while the window carries rows', () => {
    expect(droppedFormSyncDate([{ id: '2026-09-13' }], '2026-09-13')).toBeNull();
  });

  it('dates the last sync when the window is empty and wellness has synced', () => {
    expect(droppedFormSyncDate([], '2026-08-08')).toBe('2026-08-08');
  });

  it('has no caption when wellness has never synced', () => {
    expect(droppedFormSyncDate([], null)).toBeNull();
    expect(droppedFormSyncDate([], undefined)).toBeNull();
  });

  it('treats a window that has not loaded as empty, and still needs a date', () => {
    expect(droppedFormSyncDate(null, '2026-08-08')).toBe('2026-08-08');
    expect(droppedFormSyncDate(undefined, null)).toBeNull();
  });
});
