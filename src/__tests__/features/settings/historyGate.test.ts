import { historyConfirmCopy } from '@/features/settings/lib/historyGate';

describe('historyConfirmCopy', () => {
  it('names the days a range takes once it exceeds the daily share', () => {
    expect(historyConfirmCopy(2_500, 1_000)).toEqual({ kind: 'days', count: 2_500, days: 3 });
  });

  it('counts one request past the share as a second day', () => {
    expect(historyConfirmCopy(1_001, 1_000)).toEqual({ kind: 'days', count: 1_001, days: 2 });
  });

  it('omits the days when the range fits in one share', () => {
    expect(historyConfirmCopy(1_000, 1_000)).toEqual({ kind: 'size', count: 1_000 });
    expect(historyConfirmCopy(600, 1_000)).toEqual({ kind: 'size', count: 600 });
  });

  it('omits the days when the engine reports no share', () => {
    expect(historyConfirmCopy(5_000, undefined)).toEqual({ kind: 'size', count: 5_000 });
    expect(historyConfirmCopy(5_000, 0)).toEqual({ kind: 'size', count: 5_000 });
  });
});
