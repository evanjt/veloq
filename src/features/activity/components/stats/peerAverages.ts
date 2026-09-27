import type { Activity } from '@/types';

export interface PeerAverages {
  avgLoad: number | null;
  avgIntensity: number | null;
  avgHR: number | null;
}

/**
 * Averages of the recent activities of one type, each over only the
 * activities that carry the field. Coercing a missing value to 0 and dividing
 * by the full count drags the average down and makes an ordinary ride look
 * exceptional.
 */
export function peerAverages(recentActivities: Activity[], type: Activity['type']): PeerAverages {
  const sameType = recentActivities.filter((a) => a.type === type);
  const meanOf = (pick: (a: Activity) => number | null | undefined) => {
    const values = sameType.map(pick).filter((v): v is number => Number.isFinite(v));
    if (values.length === 0) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  };

  return {
    avgLoad: meanOf((a) => a.icu_training_load),
    avgIntensity: meanOf((a) => a.icu_intensity),
    avgHR: meanOf((a) => a.average_heartrate ?? a.icu_average_hr),
  };
}
