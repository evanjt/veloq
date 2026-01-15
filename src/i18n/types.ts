/**
 * Supported locales in the app
 * en-GB is the default language (standard English)
 */
export const SUPPORTED_LOCALES = [
  // English variants
  'en-AU',
  'en-US',
  'en-GB',
  // Spanish variants
  'es',
  'es-ES',
  'es-419',
  // French
  'fr',
  // German variants (including Swiss dialects)
  'de',
  'de-DE',
  'de-CHZ',
  'de-CHB',
  // Dutch
  'nl',
  // Italian
  'it',
  // Portuguese variants
  'pt',
  'pt-BR',
  // Japanese
  'ja',
  // Chinese Simplified
  'zh-Hans',
  // Polish
  'pl',
  // Danish
  'da',
] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Fallback chain for locales
 * When a locale is not fully supported, fall back to these in order
 */
export const LOCALE_FALLBACKS: Record<string, SupportedLocale[]> = {
  // Australian English variants
  'en-AU': ['en-AU', 'en-GB'],
  'en-NZ': ['en-AU', 'en-GB'],

  // British English variants (use British spelling)
  'en-GB': ['en-GB'],
  'en-IE': ['en-GB'],
  'en-ZA': ['en-GB'],
  'en-IN': ['en-GB'],

  // American English variants
  'en-US': ['en-US', 'en-GB'],
  'en-CA': ['en-US', 'en-GB'],

  // Generic English -> British (standard English)
  en: ['en-GB'],

  // Spanish variants
  es: ['es', 'en-GB'],
  'es-ES': ['es-ES', 'es', 'en-GB'],
  'es-419': ['es-419', 'es', 'en-GB'],
  'es-MX': ['es-419', 'es', 'en-GB'],
  'es-AR': ['es-419', 'es', 'en-GB'],
  'es-CO': ['es-419', 'es', 'en-GB'],
  'es-CL': ['es-419', 'es', 'en-GB'],
  'es-PE': ['es-419', 'es', 'en-GB'],
  'es-VE': ['es-419', 'es', 'en-GB'],

  // French variants
  fr: ['fr', 'en-GB'],
  'fr-FR': ['fr', 'en-GB'],
  'fr-CA': ['fr', 'en-GB'],
  'fr-BE': ['fr', 'en-GB'],
  'fr-CH': ['fr', 'en-GB'],

  // German variants
  de: ['de-DE', 'en-GB'],
  'de-DE': ['de-DE', 'en-GB'],
  'de-AT': ['de-DE', 'en-GB'],
  'de-CH': ['de-DE', 'en-GB'],
  'de-CHZ': ['de-CHZ', 'de-DE', 'en-GB'],
  'de-CHB': ['de-CHB', 'de-DE', 'en-GB'],

  // Dutch variants
  nl: ['nl', 'en-GB'],
  'nl-NL': ['nl', 'en-GB'],
  'nl-BE': ['nl', 'en-GB'],

  // Italian variants
  it: ['it', 'en-GB'],
  'it-IT': ['it', 'en-GB'],
  'it-CH': ['it', 'en-GB'],

  // Portuguese variants
  pt: ['pt', 'pt-BR', 'en-GB'],
  'pt-PT': ['pt', 'pt-BR', 'en-GB'],
  'pt-BR': ['pt-BR', 'pt', 'en-GB'],

  // Japanese
  ja: ['ja', 'en-GB'],
  'ja-JP': ['ja', 'en-GB'],

  // Chinese variants
  zh: ['zh-Hans', 'en-GB'],
  'zh-Hans': ['zh-Hans', 'en-GB'],
  'zh-CN': ['zh-Hans', 'en-GB'],
  'zh-SG': ['zh-Hans', 'en-GB'],

  // Polish
  pl: ['pl', 'en-GB'],
  'pl-PL': ['pl', 'en-GB'],

  // Danish
  da: ['da', 'en-GB'],
  'da-DK': ['da', 'en-GB'],
};

/**
 * Display names for each locale (in their own language)
 */
export const LOCALE_DISPLAY_NAMES: Record<SupportedLocale, string> = {
  // English
  'en-AU': 'English (Australia)',
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  // Spanish
  es: 'Español',
  'es-ES': 'Español (España)',
  'es-419': 'Español (Latinoamérica)',
  // French
  fr: 'Français',
  // German
  de: 'Deutsch',
  'de-DE': 'Deutsch (Deutschland)',
  'de-CHZ': 'Züridütsch',
  'de-CHB': 'Bärndütsch',
  // Dutch
  nl: 'Nederlands',
  // Italian
  it: 'Italiano',
  // Portuguese
  pt: 'Português (Portugal)',
  'pt-BR': 'Português (Brasil)',
  // Japanese
  ja: '日本語',
  // Chinese
  'zh-Hans': '中文 (简体)',
  // Polish
  pl: 'Polski',
  // Danish
  da: 'Dansk',
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
    or: string;
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
    loginWithIntervals: string;
    oauthNotConfigured: string;
    oauthFailed: string;
    oauthStateValidationFailed: string;
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
    tryDemo: string;
    noAccount: string;
    createAccountHint: string;
    createAccount: string;
    disclaimer: string;
    privacyPolicy: string;
    termsOfService: string;
    useApiKey: string;
    apiKeyDescription: string;
    getApiKey: string;
    apiKeyPlaceholder: string;
    apiKeyConnect: string;
    localModeNote: string;
    connectedModeNote: string;
    sessionExpired: string;
    sessionRevoked: string;
  };

  demo: {
    banner: string;
    tapToSignIn: string;
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
    primarySportHintCycling: string;
    primarySportHintRunning: string;
    primarySportHintSwimming: string;
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
    cachedQueries: string;
    cacheHint: string;
    routeMatching: string;
    enableRouteMatching: string;
    routeMatchingDescription: string;
    account: string;
    disconnectAccount: string;
    disconnectDescription: string;
    dataSources: string;
    dataSourcesDescription: string;
    demoDataSources: string;
    hideDemoBanner: string;
    hideDemoBannerHint: string;
    support: string;
    subscribe: string;
    sponsorDev: string;
    version: string;
    languageGroups: {
      european: string;
      asian: string;
    };
    dialect: string;
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

  about: {
    title: string;
    version: string;
    description: string;
    disclaimerTitle: string;
    disclaimer: string;
    intervalsPrivacy: string;
    intervalsTerms: string;
    intervalsApiTerms: string;
    veloqPrivacy: string;
    openSource: string;
    sourceCode: string;
    tracematchSource: string;
    dataAttribution: string;
    garminNote: string;
    mapData: string;
    mapAttribution: string;
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
    tss: string;
    pwr: string;
    cal: string;
    temp: string;
    noHeartRateData: string;
    timeInHRZones: string;
    maxHR: string;
    noDataAvailable: string;
    avg: string;
    noMetricData: string;
    noElevationData: string;
    activityStats: string;
    viewInIntervalsICU: string;
    whatIsThis: string;
    tapToClose: string;
    vsYourAvg: string;
    vsTypical: string;
    explanations: {
      trainingLoad: string;
      heartRate: string;
      energy: string;
      conditions: string;
      yourForm: string;
      power: string;
    };
    stats: {
      trainingLoad: string;
      intensityFactor: string;
      trimp: string;
      strain: string;
      yourFitness: string;
      yourFatigue: string;
      average: string;
      peak: string;
      percentOfMaxHR: string;
      percentOfMaxHRLabel: string;
      hrRecovery: string;
      bpmDrop: string;
      restingHRToday: string;
      hrvToday: string;
      energy: string;
      caloriesBurned: string;
      burnRate: string;
      duration: string;
      kcalPerHr: string;
      peakHR: string;
      restingHR: string;
      hrv: string;
      heartRate: string;
      ftp: string;
      normalizedPower: string;
      vi: string;
      ef: string;
      decoup: string;
      conditions: string;
      feelsLike: string;
      feelsLikeLabel: string;
      windSpeed: string;
      weatherData: string;
      deviceSensor: string;
      temperature: string;
      wind: string;
      yourForm: string;
      dailyValue: string;
      formTSB: string;
      fitnessCTL: string;
      fatigueATL: string;
      sleepScore: string;
      max: string;
      maxLabel: string;
      percentOfFTP: string;
      eftpEstimated: string;
      efficiencyFactor: string;
      decoupling: string;
      humidity: string;
    };
    form: {
      fresh: string;
      fatigued: string;
      neutral: string;
    };
    ofMax: string;
    conditions: {
      hot: string;
      cold: string;
    };
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
    computingRoutes: string;
    downloadingGps: string;
    expandDateRange: string;
  };

  statsScreen: {
    title: string;
    days42: string;
    months3: string;
    months6: string;
    year1: string;
    lactateThreshold: string;
    pace: string;
    heartRate: string;
    maxHr: string;
    paceCurve: string;
    powerCurve: string;
    garminNote: string;
  };

  heatmapScreen: {
    title: string;
    noActivityData: string;
    processFirstHint: string;
    goToRoutes: string;
    generatingHeatmap: string;
    activitiesCount: string;
  };

  mapScreen: {
    loadingActivities: string;
    syncing: string;
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
    visits: string;
    autoDetected: string;
    custom: string;
    createSection: string;
    sectionCreated: string;
    sectionCreatedDescription: string;
    sectionCreationFailed: string;
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
    sectionNamePlaceholder: string;
    bestTime: string;
    averageTime: string;
    totalTraversals: string;
    lastActivity: string;
  };

  errorState: {
    defaultTitle: string;
    defaultMessage: string;
    tryAgain: string;
  };

  emptyState: {
    refresh: string;
    clearFilters: string;
    noActivities: {
      title: string;
      description: string;
    };
    noResults: {
      title: string;
      description: string;
    };
    networkError: {
      title: string;
      description: string;
    };
    error: {
      title: string;
      description: string;
    };
    noData: {
      title: string;
      description: string;
    };
    offline: {
      title: string;
      description: string;
    };
  };

  cache: {
    syncingActivities: string;
    analyzingRoutes: string;
  };

  activityDetail: {
    failedToLoad: string;
    avgPace: string;
    avgSpeed: string;
    avgHR: string;
    avgPower: string;
    tabs: {
      charts: string;
      routes: string;
      sections: string;
    };
    noMatchedSections: string;
    noMatchedSectionsDescription: string;
  };

  routeDetail: {
    routeNotFound: string;
    bestTime: string;
    avgTime: string;
    totalActivities: string;
    lastActivity: string;
  };

  attribution: {
    recordedWith: string;
    garminTrademark: string;
    demoData: string;
    osm: string;
    osmLicense: string;
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
