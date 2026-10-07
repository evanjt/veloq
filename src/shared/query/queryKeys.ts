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
    list: (athleteId: string, oldest: string, newest: string) =>
      ['activities', athleteId, oldest, newest] as const,
    infinite: {
      all: ['activities-infinite'] as const,
      byAthlete: (athleteId: string) => ['activities-infinite', athleteId] as const,
    },
    range: {
      all: ['activities-range'] as const,
      byRange: (athleteId: string, oldest: string, newest: string) =>
        ['activities-range', athleteId, oldest, newest] as const,
    },
    search: {
      all: ['activities-search'] as const,
      byFilter: (
        athleteId: string,
        needle: string,
        groups: readonly string[],
        range: { oldest: string; newest: string } | null
      ) => ['activities-search', athleteId, needle, groups, range?.oldest, range?.newest] as const,
    },
    detail: (id: string) => ['activity', id] as const,
    labels: ['activity-labels'] as const,
    labelsFor: (ids: readonly string[]) => ['activity-labels', ids.join(',')] as const,
    streams: (id: string) => ['activity-streams-v3', id] as const,
    intervals: (id: string) => ['activity-intervals', id] as const,
    mapPreview: (activityId: string) => ['map-preview-streams', activityId] as const,
    previewTrack: (activityId: string) => ['activity-preview-track', activityId] as const,
  },

  strength: {
    all: ['strength'] as const,
    exerciseSets: (activityId: string) => ['strength', 'exercise-sets', activityId] as const,
    exerciseDetail: (category: number) => ['strength', 'exercise-detail', category] as const,
    muscleGroups: (activityId: string) => ['strength', 'muscle-groups', activityId] as const,
    // The whole strength tab, keyed on the period alone: nothing it draws
    // depends on which muscle is selected, so one entry serves a drag across
    // the diagram.
    screenData: (period: string, weekCount: number) =>
      ['strength', 'screen-data', period, weekCount] as const,
  },

  wellness: {
    all: ['wellness'] as const,
    // The window slides with today's date, so the dates are part of identity.
    byRange: (range: string, oldest: string, newest: string) =>
      ['wellness', range, oldest, newest] as const,
    byDate: (date: string | undefined) => ['wellness', 'date', date] as const,
    latestDate: ['wellness', 'latestDate'] as const,
  },

  stats: {
    all: ['engine-stats'] as const,
    training: {
      all: ['engine-stats', 'training'] as const,
      byDay: (day: string) => ['engine-stats', 'training', day] as const,
    },
    period: {
      all: ['engine-stats', 'period'] as const,
      byWindow: (startTs: number, endTs: number) =>
        ['engine-stats', 'period', startTs, endTs] as const,
    },
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
    bestEfforts: {
      all: ['bestEfforts'] as const,
      byDays: (days: number) => ['bestEfforts', days] as const,
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
    yearCounts: ['activityYearCounts'] as const,
    events: (today: string) => ['calendar-events', today] as const,
  },
} as const;
