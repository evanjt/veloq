/**
 * Supported locales in the app
 * en-AU is the default language
 */
export const SUPPORTED_LOCALES = ['en-AU', 'en-US', 'en-GB', 'es', 'fr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Fallback chain for locales
 * When a locale is not fully supported, fall back to these in order
 */
export const LOCALE_FALLBACKS: Record<string, SupportedLocale[]> = {
  // Australian English variants
  'en-AU': ['en-AU'],
  'en-NZ': ['en-AU', 'en-GB'],

  // British English variants (use British spelling)
  'en-GB': ['en-GB', 'en-AU'],
  'en-IE': ['en-GB', 'en-AU'],
  'en-ZA': ['en-GB', 'en-AU'],
  'en-IN': ['en-GB', 'en-AU'],

  // American English variants
  'en-US': ['en-US', 'en-AU'],
  'en-CA': ['en-US', 'en-AU'],

  // Generic English -> Australian (our default)
  'en': ['en-AU'],

  // Spanish variants
  'es': ['es', 'en-AU'],
  'es-ES': ['es', 'en-AU'],
  'es-MX': ['es', 'en-AU'],
  'es-AR': ['es', 'en-AU'],

  // French variants
  'fr': ['fr', 'en-AU'],
  'fr-FR': ['fr', 'en-AU'],
  'fr-CA': ['fr', 'en-AU'],
  'fr-BE': ['fr', 'en-AU'],
};

/**
 * Display names for each locale (in their own language)
 */
export const LOCALE_DISPLAY_NAMES: Record<SupportedLocale, string> = {
  'en-AU': 'English (Australia)',
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  'es': 'Español',
  'fr': 'Français',
};

/**
 * Type for the translation resource structure
 * This ensures type-safety when accessing translations
 */
export interface TranslationResource {
  common: {
    loading: string;
    loadingMore: string;
    error: string;
    retry: string;
    cancel: string;
    save: string;
    delete: string;
    confirm: string;
    back: string;
    next: string;
    done: string;
    search: string;
    clearSearch: string;
    noResults: string;
    pullToRefresh: string;
  };

  navigation: {
    feed: string;
    fitness: string;
    stats: string;
    training: string;
    wellness: string;
    routes: string;
    heatmap: string;
    map: string;
    settings: string;
    activities: string;
  };

  feed: {
    recentActivities: string;
    activitiesCount: string;
    noActivities: string;
    noMatchingActivities: string;
    failedToLoad: string;
    searchPlaceholder: string;
  };

  filters: {
    showFilters: string;
    hideFilters: string;
    cycling: string;
    running: string;
    swimming: string;
    hiking: string;
    walking: string;
    snowSports: string;
    waterSports: string;
    climbing: string;
    racketSports: string;
    other: string;
  };

  metrics: {
    hrv: string;
    rhr: string;
    week: string;
    ftp: string;
    pace: string;
    css: string;
    form: string;
    fitness: string;
    fatigue: string;
    hr: string;
  };

  login: {
    title: string;
    subtitle: string;
    gettingStarted: string;
    instructions: string;
    openSettings: string;
    apiKey: string;
    connect: string;
    connecting: string;
    apiKeyRequired: string;
    invalidApiKey: string;
    connectionFailed: string;
    securityNote: string;
  };

  settings: {
    title: string;
    appearance: string;
    system: string;
    light: string;
    dark: string;
    language: string;
    primarySport: string;
    primarySportHint: string;
    maps: string;
    defaultStyle: string;
    satellite: string;
    customiseByActivity: string;
    default: string;
    defaultMapHint: string;
    dataCache: string;
    syncAllHistory: string;
    syncAllHistoryDescription: string;
    syncInProgress: string;
    viewRoutes: string;
    pauseRouteProcessing: string;
    clearAllReload: string;
    clearAllReloadDescription: string;
    reanalyseRoutes: string;
    clearRouteDescription: string;
    activities: string;
    routesCount: string;
    total: string;
    dateRange: string;
    noData: string;
    lastSynced: string;
    bounds: string;
    gpsTraces: string;
    cacheHint: string;
    routeMatching: string;
    enableRouteMatching: string;
    routeMatchingDescription: string;
    account: string;
    disconnectAccount: string;
    disconnectDescription: string;
    dataSources: string;
    dataSourcesDescription: string;
    support: string;
    subscribe: string;
    sponsorDev: string;
  };

  alerts: {
    error: string;
    clearCacheTitle: string;
    clearCacheMessage: string;
    clearReload: string;
    clearRouteCacheTitle: string;
    clearRouteCacheMessage: string;
    syncAllTitle: string;
    syncAllMessage: string;
    sync: string;
    disconnectTitle: string;
    disconnectMessage: string;
    disconnect: string;
    failedToClear: string;
    failedToDisconnect: string;
  };

  activity: {
    viewDetails: string;
    share: string;
    distance: string;
    duration: string;
    elevation: string;
    speed: string;
    heartRate: string;
    power: string;
    cadence: string;
    calories: string;
  };

  time: {
    today: string;
    yesterday: string;
    daysAgo: string;
    weeksAgo: string;
    monthsAgo: string;
    yearsAgo: string;
    current: string;
    now: string;
  };

  units: {
    km: string;
    mi: string;
    m: string;
    ft: string;
    kmh: string;
    mph: string;
    bpm: string;
    watts: string;
    rpm: string;
    kcal: string;
    hours: string;
    minutes: string;
    seconds: string;
  };

  fitnessScreen: {
    title: string;
    loadingData: string;
    failedToLoad: string;
    current: string;
    ctl: string;
    atl: string;
    tsb: string;
    fitnessAndFatigue: string;
    understandingMetrics: string;
    fitnessDescription: string;
    fatigueDescription: string;
    formDescription: string;
    optimalZone: string;
    toBuildFitness: string;
    fresh: string;
    forRaces: string;
    highRiskZone: string;
    toPreventOvertraining: string;
    learnMore: string;
  };

  wellnessScreen: {
    title: string;
    trends: string;
  };

  trainingScreen: {
    title: string;
    routes: string;
    sections: string;
    heatmap: string;
    disabledInSettings: string;
    potentialMatches: string;
    checkingActivities: string;
    groupingRoutes: string;
    fetchingGps: string;
    routesFromActivities: string;
    discoverRoutes: string;
    visualizeActivities: string;
    seeWhereYouTravel: string;
  };

  routesScreen: {
    title: string;
    matchingDisabled: string;
    enableInSettings: string;
    goToSettings: string;
    analysingRoutes: string;
  };

  routes: {
    basedOnActivities: string;
    routesFound: string;
    sameDirection: string;
    reverse: string;
    partial: string;
    overlap: string;
    lookingForRoutes: string;
    checking: string;
    waiting: string;
    expandTimeline: string;
    loadingRoutes: string;
    analysingRoutes: string;
    thisMayTakeMoment: string;
    noRoutesYet: string;
    routesWillAppear: string;
    noMatchingRoutes: string;
    routesWithTwoPlus: string;
    readyToProcess: string;
    foundPotentialMatches: string;
    checkingActivities: string;
    fetchingGpsData: string;
    analysingActivities: string;
    groupingRoutes: string;
    analysisComplete: string;
    errorOccurred: string;
    newRoute: string;
    matches: string;
    moreActivitiesProcessed: string;
    matchesLabel: string;
    checkedLabel: string;
    match: string;
    more: string;
    loadingSections: string;
    noFrequentSections: string;
    sectionsDescription: string;
    noSectionsMatchFilter: string;
    adjustSportTypeFilter: string;
    frequentSectionsInfo: string;
    activities: string;
    partOfRoutes: string;
    partOfRoutesPlural: string;
    matchedRoute: string;
    thisActivity: string;
    selected: string;
    thisPace: string;
    thisSpeed: string;
    best: string;
    bestOn: string;
    same: string;
    fastest: string;
    routeNamePlaceholder: string;
  };

  sections: {
    performanceOverTime: string;
    best: string;
    same: string;
    reverse: string;
    scrubHint: string;
    scrubHintScrollable: string;
    bestPace: string;
    bestSpeed: string;
    date: string;
    sectionNotFound: string;
    traversals: string;
    routesCount: string;
    activities: string;
    noActivitiesFound: string;
  };

  stats: {
    activityCalendar: string;
    activitiesCount: string;
    noActivityData: string;
    completeActivitiesHeatmap: string;
    less: string;
    more: string;
    swimPaceCurve: string;
    noSwimPaceData: string;
    paceCurve: string;
    noPaceData: string;
    gap: string;
    time: string;
    powerCurve: string;
    noPowerData: string;
    estimatedFtp: string;
    from3MonthsAgo: string;
    noFtpData: string;
    completePowerActivities: string;
    upcomingEvents: string;
    race: string;
    daysCount: string;
    noUpcomingEvents: string;
    addEventsHint: string;
    powerZones: string;
    heartRateZones: string;
    last30Days: string;
    noZoneData: string;
    completeActivitiesPower: string;
    completeActivitiesHr: string;
    totalTime: string;
    seasonComparison: string;
    completeActivitiesYearComparison: string;
    hours: string;
    tss: string;
    thisWeek: string;
    vsLastWeek: string;
    thisMonth: string;
    vsLastMonth: string;
    last3Months: string;
    vsPrevious3Months: string;
    last6Months: string;
    vsPrevious6Months: string;
    thisYear: string;
    vsLastYear: string;
    week: string;
    month: string;
    threeMonths: string;
    sixMonths: string;
    year: string;
    noActivitiesInPeriod: string;
    activities: string;
    loadTss: string;
    workoutLibrary: string;
    noWorkoutsAvailable: string;
    createWorkoutsHint: string;
    all: string;
    aerobicDecoupling: string;
    noDecouplingData: string;
    completeDecouplingHint: string;
    goodAerobicFitness: string;
    needsImprovement: string;
    targetLessThan5: string;
    firstHalf: string;
    secondHalf: string;
    avgPower: string;
    avgHr: string;
    efficiency: string;
    decouplingExplanation: string;
  };

  wellness: {
    noData: string;
    connectHint: string;
    restingHR: string;
    sleep: string;
    sleepScore: string;
    weight: string;
    hrs: string;
    insightGoodRecovery: string;
    insightExtraRecovery: string;
    insightStable: string;
    noTrendData: string;
    trendHint: string;
    dragToExplore: string;
    lastDays: string;
  };

  fitness: {
    noData: string;
    formTSB: string;
    fitnessCTL: string;
    fatigueATL: string;
    fitAbbrev: string;
    fatAbbrev: string;
    activitiesCount: string;
    restDay: string;
    selectActivity: string;
    timeRange: {
      '7d': string;
      '1m': string;
      '42d': string;
      '3m': string;
      '6m': string;
      '1y': string;
    };
  };

  formZones: {
    transition: string;
    fresh: string;
    greyZone: string;
    optimal: string;
    highRisk: string;
  };

  maps: {
    closeMap: string;
    toggleStyle: string;
    enable3D: string;
    disable3D: string;
    resetOrientation: string;
    goToLocation: string;
    zoomToActivity: string;
    closePopup: string;
    loadingRoute: string;
    viewDetails: string;
    allClear: string;
    clear: string;
    syncingActivities: string;
    activitiesCount: string;
    selected: string;
    cached: string;
    notSynced: string;
    activityTypes: {
      ride: string;
      run: string;
      swim: string;
      walk: string;
      hike: string;
      other: string;
    };
  };

  heatmap: {
    visitedTimes: string;
    uniqueRoutes: string;
    lastVisit: string;
    showActivities: string;
  };
}

/**
 * Type for react-i18next
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: TranslationResource;
    };
  }
}
