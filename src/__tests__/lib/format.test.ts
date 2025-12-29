import {
  formatDistance,
  formatDuration,
  formatPace,
  formatPaceCompact,
  formatSwimPace,
  formatSpeed,
  formatElevation,
  formatHeartRate,
  formatPower,
  formatCalories,
  formatLocalDate,
  clamp,
} from '@/lib/utils/format';

describe('formatDistance', () => {
  it('formats meters for distances under 1km', () => {
    expect(formatDistance(500)).toBe('500 m');
    expect(formatDistance(999)).toBe('999 m');
    expect(formatDistance(50)).toBe('50 m');
  });

  it('formats kilometers for distances 1km and over', () => {
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(5000)).toBe('5.0 km');
    expect(formatDistance(42195)).toBe('42.2 km');
  });

  it('handles edge cases', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(1)).toBe('1 m');
  });
});

describe('formatDuration', () => {
  it('formats minutes and seconds for durations under 1 hour', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(30)).toBe('0:30');
    expect(formatDuration(90)).toBe('1:30');
    expect(formatDuration(3599)).toBe('59:59');
  });

  it('formats hours, minutes, and seconds for durations 1 hour and over', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatDuration(7200)).toBe('2:00:00');
    expect(formatDuration(7384)).toBe('2:03:04');
  });
});

describe('formatPace', () => {
  it('formats pace in min/km', () => {
    // 5 m/s = 3:20/km
    expect(formatPace(5)).toBe('3:20 /km');
    // 4 m/s = 4:10/km
    expect(formatPace(4)).toBe('4:10 /km');
    // 3 m/s = 5:33/km
    expect(formatPace(3)).toBe('5:33 /km');
  });

  it('handles zero or negative pace', () => {
    expect(formatPace(0)).toBe('--:--');
    expect(formatPace(-1)).toBe('--:--');
  });
});

describe('formatPaceCompact', () => {
  it('formats pace without units', () => {
    expect(formatPaceCompact(5)).toBe('3:20');
    expect(formatPaceCompact(4)).toBe('4:10');
  });

  it('handles zero pace', () => {
    expect(formatPaceCompact(0)).toBe('--:--');
  });
});

describe('formatSwimPace', () => {
  it('formats swim pace in min:sec per 100m', () => {
    // 1 m/s = 1:40 per 100m
    expect(formatSwimPace(1)).toBe('1:40');
    // 1.5 m/s = 1:07 per 100m
    expect(formatSwimPace(1.5)).toBe('1:07');
    // 2 m/s = 0:50 per 100m
    expect(formatSwimPace(2)).toBe('0:50');
  });

  it('handles zero pace', () => {
    expect(formatSwimPace(0)).toBe('--:--');
  });
});

describe('formatSpeed', () => {
  it('converts m/s to km/h', () => {
    expect(formatSpeed(10)).toBe('36.0 km/h');
    expect(formatSpeed(5)).toBe('18.0 km/h');
    expect(formatSpeed(2.78)).toBe('10.0 km/h');
  });

  it('handles zero speed', () => {
    expect(formatSpeed(0)).toBe('0.0 km/h');
  });
});

describe('formatElevation', () => {
  it('formats elevation in meters', () => {
    expect(formatElevation(500)).toBe('500 m');
    expect(formatElevation(1234)).toBe('1234 m');
  });

  it('rounds to nearest meter', () => {
    expect(formatElevation(500.4)).toBe('500 m');
    expect(formatElevation(500.6)).toBe('501 m');
  });

  it('handles null and undefined', () => {
    expect(formatElevation(null)).toBe('0 m');
    expect(formatElevation(undefined)).toBe('0 m');
  });

  it('handles NaN', () => {
    expect(formatElevation(NaN)).toBe('0 m');
  });
});

describe('formatHeartRate', () => {
  it('formats heart rate in bpm', () => {
    expect(formatHeartRate(140)).toBe('140 bpm');
    expect(formatHeartRate(180)).toBe('180 bpm');
  });

  it('rounds to nearest bpm', () => {
    expect(formatHeartRate(140.4)).toBe('140 bpm');
    expect(formatHeartRate(140.6)).toBe('141 bpm');
  });
});

describe('formatPower', () => {
  it('formats power in watts', () => {
    expect(formatPower(250)).toBe('250 W');
    expect(formatPower(1000)).toBe('1000 W');
  });

  it('rounds to nearest watt', () => {
    expect(formatPower(250.4)).toBe('250 W');
    expect(formatPower(250.6)).toBe('251 W');
  });
});

describe('formatCalories', () => {
  it('formats calories under 1000', () => {
    expect(formatCalories(500)).toBe('500');
    expect(formatCalories(999)).toBe('999');
  });

  it('formats calories 1000 and over with k suffix', () => {
    expect(formatCalories(1000)).toBe('1.0k');
    expect(formatCalories(1500)).toBe('1.5k');
    expect(formatCalories(2300)).toBe('2.3k');
  });
});

describe('formatLocalDate', () => {
  it('formats date as YYYY-MM-DD', () => {
    const date = new Date(2024, 0, 15); // January 15, 2024
    expect(formatLocalDate(date)).toBe('2024-01-15');
  });

  it('pads single-digit months and days', () => {
    const date = new Date(2024, 5, 5); // June 5, 2024
    expect(formatLocalDate(date)).toBe('2024-06-05');
  });
});

describe('clamp', () => {
  it('returns value when within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('clamps to min when below', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(-100, 0, 10)).toBe(0);
  });

  it('clamps to max when above', () => {
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(100, 0, 10)).toBe(10);
  });
});
