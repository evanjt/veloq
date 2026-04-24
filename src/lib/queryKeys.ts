/**
 * Centralized query key factory for TanStack Query.
 *
 * Usage:
 *   queryKey: queryKeys.activities.detail(id)
 *   invalidateQueries({ queryKey: queryKeys.activities.all })
 *
 * Partial key matching: queryKeys.activities.all (['activities']) matches
 * all activity queries when used with invalidateQueries/resetQueries.
 */

export const queryKeys = {
  activities: {
    all: ['activities'] as const,
    list: (athleteId: string, oldest: string, newest: string, includeStats: boolean) =>
      ['activities', athleteId, oldest, newest, includeStats ? 'stats' : 'base'] as const,
    infinite: {
      all: ['activities-infinite'] as const,
      byAthlete: (athleteId: string, includeStats: boolean) =>
        ['activities-infinite', athleteId, includeStats ? 'stats' : 'base'] as const,
    },
    detail: (id: string) => ['activity', id] as const,
    streams: (id: string) => ['activity-streams-v3', id] as const,
    intervals: (id: string) => ['activity-intervals', id] as const,
    mapPreview: (activityId: string) => ['map-preview-streams', activityId] as const,
  },

  strength: {
    exerciseSets: (activityId: string) => ['exercise-sets-v2', activityId] as const,
    muscleGroups: (activityId: string) => ['muscle-groups-v2', activityId] as const,
    volume: (period: string) => ['strength-volume', period] as const,
    progression: (muscleSlug: string) => ['strength-progression', muscleSlug] as const,
    exercisesForMuscle: (period: string, muscleSlug: string) =>
      ['exercises-for-muscle', period, muscleSlug] as const,
    activitiesForExercise: (period: string, muscleSlug: string, exerciseCategory: number) =>
      ['activities-for-exercise', period, muscleSlug, exerciseCategory] as const,
  },

  wellness: {
    all: ['wellness'] as const,
    byRange: (range: string) => ['wellness', range] as const,
    byDate: (date: string | undefined) => ['wellness-date', date] as const,
  },

  athleteSummary: {
    all: ['athlete-summary'] as const,
    byRange: (startDate: string, endDate: string) =>
      ['athlete-summary', startDate, endDate] as const,
  },

  charts: {
    powerCurve: {
      all: ['powerCurve'] as const,
      bySport: (sport: string, days: number) => ['powerCurve', sport, days] as const,
    },
    paceCurve: {
      all: ['paceCurve'] as const,
      bySport: (sport: string, days: number, gap: boolean) =>
        ['paceCurve', sport, days, gap] as const,
    },
  },

  sections: {
    all: ['sections'] as const,
    custom: ['sections', 'custom'] as const,
  },

  profile: {
    athlete: ['athlete'] as const,
    sportSettings: ['sportSettings'] as const,
  },

  calendar: {
    oldestDate: ['oldestActivityDate'] as const,
    events: (today: string) => ['calendar-events', today] as const,
  },
} as const;
