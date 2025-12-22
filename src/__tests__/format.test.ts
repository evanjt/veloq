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
  formatTSS,
  formatCalories,
  formatLocalDate,
} from '../lib/format';

describe('formatDistance', () => {
  it('should format meters below 1000 as meters', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(500)).toBe('500 m');
    expect(formatDistance(999)).toBe('999 m');
  });

  it('should format 1000+ meters as kilometers with 1 decimal', () => {
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(1500)).toBe('1.5 km');
    expect(formatDistance(10000)).toBe('10.0 km');
    expect(formatDistance(42195)).toBe('42.2 km'); // Marathon
  });

  it('should handle edge cases', () => {
    expect(formatDistance(999.4)).toBe('999 m');
    expect(formatDistance(999.5)).toBe('1000 m'); // rounds up to 1000m, not 1.0km
  });
});

describe('formatDuration', () => {
  it('should format seconds under an hour as mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(30)).toBe('0:30');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(599)).toBe('9:59');
    expect(formatDuration(3599)).toBe('59:59');
  });

  it('should format durations of an hour or more as h:mm:ss', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatDuration(7265)).toBe('2:01:05');
    expect(formatDuration(36000)).toBe('10:00:00');
  });

  it('should pad minutes and seconds with zeros', () => {
    expect(formatDuration(3605)).toBe('1:00:05');
    expect(formatDuration(3660)).toBe('1:01:00');
  });
});

describe('formatPace', () => {
  it('should return --:-- for zero or negative speed', () => {
    expect(formatPace(0)).toBe('--:--');
    expect(formatPace(-1)).toBe('--:--');
  });

  it('should format pace as min:sec per km', () => {
    // 1000m in 300 seconds = 3.33 m/s = 5:00/km
    expect(formatPace(1000 / 300)).toBe('5:00 /km');
    // 1000m in 240 seconds = 4.17 m/s = 4:00/km
    expect(formatPace(1000 / 240)).toBe('4:00 /km');
    // 1000m in 360 seconds = 2.78 m/s = 6:00/km
    expect(formatPace(1000 / 360)).toBe('6:00 /km');
  });

  it('should handle fast paces', () => {
    // World record marathon pace ~2:50/km = ~5.88 m/s
    const pace = formatPace(5.88);
    expect(pace).toMatch(/^2:\d{2} \/km$/);
  });
});

describe('formatPaceCompact', () => {
  it('should return --:-- for zero or negative speed', () => {
    expect(formatPaceCompact(0)).toBe('--:--');
    expect(formatPaceCompact(-1)).toBe('--:--');
  });

  it('should format pace without units', () => {
    expect(formatPaceCompact(1000 / 300)).toBe('5:00');
    expect(formatPaceCompact(1000 / 240)).toBe('4:00');
  });
});

describe('formatSwimPace', () => {
  it('should return --:-- for zero or negative speed', () => {
    expect(formatSwimPace(0)).toBe('--:--');
    expect(formatSwimPace(-1)).toBe('--:--');
  });

  it('should format swim pace as min:sec per 100m', () => {
    // 100m in 90 seconds = 1.11 m/s = 1:30/100m
    expect(formatSwimPace(100 / 90)).toBe('1:30');
    // 100m in 60 seconds = 1.67 m/s = 1:00/100m
    expect(formatSwimPace(100 / 60)).toBe('1:00');
  });
});

describe('formatSpeed', () => {
  it('should convert m/s to km/h', () => {
    expect(formatSpeed(0)).toBe('0.0 km/h');
    expect(formatSpeed(1)).toBe('3.6 km/h');
    expect(formatSpeed(10)).toBe('36.0 km/h');
    // Typical cycling speed ~30 km/h = 8.33 m/s
    expect(formatSpeed(8.33)).toBe('30.0 km/h');
  });
});

describe('formatElevation', () => {
  it('should format elevation in meters', () => {
    expect(formatElevation(0)).toBe('0 m');
    expect(formatElevation(100)).toBe('100 m');
    expect(formatElevation(1234)).toBe('1234 m');
  });

  it('should round to nearest meter', () => {
    expect(formatElevation(99.4)).toBe('99 m');
    expect(formatElevation(99.5)).toBe('100 m');
  });

  it('should handle null, undefined, and NaN', () => {
    expect(formatElevation(null)).toBe('0 m');
    expect(formatElevation(undefined)).toBe('0 m');
    expect(formatElevation(NaN)).toBe('0 m');
  });
});

describe('formatHeartRate', () => {
  it('should format heart rate in bpm', () => {
    expect(formatHeartRate(60)).toBe('60 bpm');
    expect(formatHeartRate(150)).toBe('150 bpm');
    expect(formatHeartRate(185.7)).toBe('186 bpm');
  });
});

describe('formatPower', () => {
  it('should format power in watts', () => {
    expect(formatPower(0)).toBe('0 W');
    expect(formatPower(250)).toBe('250 W');
    expect(formatPower(300.4)).toBe('300 W');
    expect(formatPower(300.5)).toBe('301 W');
  });
});

describe('formatTSS', () => {
  it('should format training stress score', () => {
    expect(formatTSS(0)).toBe('0');
    expect(formatTSS(100)).toBe('100');
    expect(formatTSS(85.7)).toBe('86');
  });
});

describe('formatCalories', () => {
  it('should format calories below 1000 normally', () => {
    expect(formatCalories(0)).toBe('0');
    expect(formatCalories(500)).toBe('500');
    expect(formatCalories(999)).toBe('999');
  });

  it('should format calories 1000+ with k suffix', () => {
    expect(formatCalories(1000)).toBe('1.0k');
    expect(formatCalories(1500)).toBe('1.5k');
    expect(formatCalories(2500)).toBe('2.5k');
  });
});

describe('formatLocalDate', () => {
  it('should format date as YYYY-MM-DD', () => {
    const date = new Date(2024, 0, 15); // Jan 15, 2024
    expect(formatLocalDate(date)).toBe('2024-01-15');
  });

  it('should pad single-digit months and days', () => {
    const date = new Date(2024, 5, 5); // June 5, 2024
    expect(formatLocalDate(date)).toBe('2024-06-05');
  });

  it('should handle year boundaries', () => {
    const date = new Date(2024, 11, 31); // Dec 31, 2024
    expect(formatLocalDate(date)).toBe('2024-12-31');
  });
});
