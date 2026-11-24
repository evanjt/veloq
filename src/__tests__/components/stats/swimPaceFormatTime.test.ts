import { formatTime } from '@/features/stats/components/SwimPaceCurveChart';

describe('swim pace curve formatTime', () => {
  it('carries a rounded-up 60 seconds into the minute', () => {
    expect(formatTime(239.6)).toBe('4:00');
    expect(formatTime(3599.7)).toBe('1:00:00');
  });

  it('keeps ordinary values and the empty case', () => {
    expect(formatTime(95.2)).toBe('1:35');
    expect(formatTime(0)).toBe('--:--');
    expect(formatTime(NaN)).toBe('--:--');
  });
});
