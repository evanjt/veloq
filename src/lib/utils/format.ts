export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) {
    return '0 m';
  }
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = meters / 1000;
  return `${km.toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function formatPace(metersPerSecond: number): string {
  if (!Number.isFinite(metersPerSecond) || metersPerSecond <= 0) return '--:--';
  const totalSeconds = Math.round(1000 / metersPerSecond);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')} /km`;
}

// Compact pace format for pill display (no units)
export function formatPaceCompact(metersPerSecond: number): string {
  if (!Number.isFinite(metersPerSecond) || metersPerSecond <= 0) return '--:--';
  const totalSeconds = Math.round(1000 / metersPerSecond);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Format swim pace in min:sec per 100m
export function formatSwimPace(metersPerSecond: number): string {
  if (!Number.isFinite(metersPerSecond) || metersPerSecond <= 0) return '--:--';
  const totalSeconds = Math.round(100 / metersPerSecond);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatSpeed(metersPerSecond: number): string {
  if (!Number.isFinite(metersPerSecond) || metersPerSecond < 0) {
    return '0.0 km/h';
  }
  const kmh = metersPerSecond * 3.6;
  return `${kmh.toFixed(1)} km/h`;
}

export function formatElevation(meters: number | undefined | null): string {
  if (meters == null || isNaN(meters)) return '0 m';
  return `${Math.round(meters)} m`;
}

export function formatHeartRate(bpm: number): string {
  if (!Number.isFinite(bpm) || bpm < 0) {
    return '0 bpm';
  }
  return `${Math.round(bpm)} bpm`;
}

export function formatPower(watts: number): string {
  if (!Number.isFinite(watts) || watts < 0) {
    return '0 W';
  }
  return `${Math.round(watts)} W`;
}

export function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const isCurrentYear = date.getFullYear() === now.getFullYear();

  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  } else if (isCurrentYear) {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } else {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}

export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatTSS(load: number): string {
  return `${Math.round(load)}`;
}

export function formatCalories(kcal: number): string {
  if (!Number.isFinite(kcal) || kcal < 0) {
    return '0';
  }
  if (kcal >= 1000) {
    return `${(kcal / 1000).toFixed(1)}k`;
  }
  return `${Math.round(kcal)}`;
}

/**
 * Format a date as YYYY-MM-DD using local timezone (not UTC).
 * Use this instead of toISOString().split('T')[0] to avoid timezone issues.
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get today's date as YYYY-MM-DD in local timezone
 */
export function getTodayLocalDate(): string {
  return formatLocalDate(new Date());
}

/**
 * Clamp a value between min and max bounds
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
