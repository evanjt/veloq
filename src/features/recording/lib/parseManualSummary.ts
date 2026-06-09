export interface ManualSummaryParams {
  durationSeconds?: string;
  distance?: string;
  avgHr?: string;
}

export interface ManualSummary {
  duration: number;
  distance: number;
  avgSpeed: number;
  avgHeartrate: number | null;
}

/**
 * Parse a manual-entry summary from free-form route-param strings. A non-numeric
 * or NaN value must never save as NaN: duration/distance coerce to a finite
 * number or 0, and avgHr stays null unless it parses to a finite number.
 */
export function parseManualSummary(params: ManualSummaryParams): ManualSummary {
  const toFinite = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const duration = toFinite(params.durationSeconds);
  const distance = toFinite(params.distance);
  const avgHrNum = Number(params.avgHr);
  const avgHeartrate = params.avgHr != null && Number.isFinite(avgHrNum) ? avgHrNum : null;
  return {
    duration,
    distance,
    avgSpeed: duration > 0 && distance > 0 ? distance / duration : 0,
    avgHeartrate,
  };
}
