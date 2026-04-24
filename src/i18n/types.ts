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
  // German variants (including Swiss)
  'de-DE',
  'de-CH',
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
  'de-CH': ['de-CH', 'de-DE', 'en-GB'],

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
  'de-DE': 'Deutsch (Deutschland)',
  'de-CH': 'Schwiizerdütsch',
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
    create: string;
    delete: string;
    disable: string;
    enable: string;
    hide: string;
    show: string;
    confirm: string;
    back: string;
    next: string;
    ok: string;
    done: string;
    search: string;
    clearSearch: string;
    noResults: string;
    pullToRefresh: string;
    or: string;
    creating: string;
    showDetails: string;
    hideDetails: string;
    reset: string;
    activities: string;
    syncing: string;
    undo: string;
    remove: string;
    restore: string;
  };

  navigation: {
    feed: string;
    fitness: string;
    stats: string;
    training: string;
    wellness: string;
    health: string;
    routes: string;
    map: string;
    settings: string;
    activities: string;
    insights: string;
  };

  feed: {
    recentActivities: string;
    activitiesCount: string;
    noActivities: string;
    noMatchingActivities: string;
    failedToLoad: string;
    searchPlaceholder: string;
    groups: {
      cycling: string;
      running: string;
      swimming: string;
      other: string;
    };
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
    activityCount: string;
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
    weight: string;
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
    apiKeyNoNotifications: string;
    sessionExpired: string;
    sessionRevoked: string;
  };

  demo: {
    banner: string;
    tapToSignIn: string;
  };

  settings: {
    title: string;
    display: string;
    displayAndMaps: string;
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
    redetectSections: string;
    redetectSectionsHint: string;
    clearAllReloadDescription: string;
    reanalyseRoutes: string;
    clearRouteDescription: string;
    activities: string;
    routesCount: string;
    sectionsCount: string;
    sectionDetection: string;
    detectionSensitivity: string;
    detectionRelaxed: string;
    detectionStrict: string;
    matchThreshold: string;
    endpointDistance: string;
    reanalyzeSections: string;
    reanalyzeWarning: string;
    cleanupOverlapping: string;
    cleanupResult: string;
    total: string;
    database: string;
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
    geocoding: string;
    geocodingDescription: string;
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
    units: string;
    unitsAuto: string;
    unitsAutoHint: string;
    unitsAutoHintWithIntervals: string;
    unitsMetric: string;
    unitsMetricHint: string;
    unitsImperial: string;
    unitsImperialHint: string;
    cached: string;
    notCached: string;
    expandCache: string;
    localDataRange: string;
    dataCacheHint: string;
    connectionMethod: string;
    connectedViaApiKey: string;
    demoMode: string;
    signedInToIntervals: string;
    dashboardMetrics: string;
    customiseMetrics: string;
    metricsHint: string;
    availableMetrics: string;
    resetToDefaults: string;
    summaryCard: string;
    showSummaryCard: string;
    heroMetric: string;
    showSparkline: string;
    supportingMetrics: string;
    maxMetricsHint: string;
    appTour: string;
    appTourDescription: string;
  };

  alerts: {
    cacheCleared: string;
    cacheCorruptionMessage: string;
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
    redetectSectionsTitle: string;
    redetectSectionsMessage: string;
    redetectSectionsConfirm: string;
    redetectSectionsBusy: string;
  };

  export: {
    gpx: string;
    exporting: string;
    error: string;
    bulkExport: string;
    bulkExporting: string;
    bulkCompressing: string;
    bulkSharing: string;
    bulkComplete: string;
    bulkResult: string;
  };

  backup: {
    exportBackup: string;
    importBackup: string;
    exporting: string;
    importing: string;
    exportError: string;
    importError: string;
    restoreComplete: string;
    nothingToRestore: string;
    sectionsRestored: string;
    namesRestored: string;
    preferencesRestored: string;
    sectionsSkipped: string;
    exportDatabase: string;
    importDatabase: string;
    databaseRestored: string;
    exportingDatabase: string;
    importingDatabase: string;
    autoBackup: string;
    autoBackupDescription: string;
    lastBackup: string;
    lastBackupNever: string;
    backupNow: string;
    backingUp: string;
    selectBackend: string;
    backendLocal: string;
    backendWebdav: string;
    backendIcloud: string;
    serverUrl: string;
    username: string;
    password: string;
    testConnection: string;
    connectionSuccess: string;
    connectionFailed: string;
    restoreFromBackup: string;
    backupFound: string;
    differentAccount: string;
    differentAccountMessage: string;
    clearAndSync: string;
    backupSuccessTitle: string;
    backupSuccessMessage: string;
    backupFailedTitle: string;
    backupFailedMessage: string;
    legacyImportNotice: string;
  };

  bestEffortsScreen: {
    title: string;
    thisSeason: string;
    allTime: string;
    seasonSubtitle: string;
    allTimeSubtitle: string;
    powerBests: string;
    paceBests: string;
    swimBests: string;
    activityNotCached: string;
    sourceNote: string;
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
    thirdPartyLicenses: string;
    tracematchSource: string;
    dataAttribution: string;
    garminNote: string;
    mapData: string;
    mapAttribution: string;
  };

  activity: {
    viewDetails: string;
    share: string;
    mapStyle: string;
    resetToDefault: string;
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
    sectionPr: string;
    sectionCount: string;
    cal: string;
    temp: string;
    noHeartRateData: string;
    timeInHRZones: string;
    timeInPowerZones: string;
    ftp: string;
    maxHR: string;
    noDataAvailable: string;
    zoneDefault: string;
    avg: string;
    xAxisDistance: string;
    xAxisTime: string;
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
    muscle: {
      sets: string;
      reps: string;
      volume: string;
      contributingExercises: string;
      setCount_one: string;
      setCount_other: string;
      repsCount: string;
    };
  };

  time: {
    dayAbbrev: string;
    today: string;
    yesterday: string;
    daysAgo: string;
    daysCount: string;
    weeksAgo: string;
    monthsAgo: string;
    yearsAgo: string;
    yearsCount: string;
    current: string;
    now: string;
    days: string;
    months: string;
    years: string;
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

  insights: {
    title: string;
    noInsights: string;
    noInsightsHint: string;
    sectionPr: string;
    sectionPrSubtitle: string;
    sectionTrendSummary: string;
    sectionTrendSummaryBody: string;
    sectionImproving: string;
    sectionImprovingBody: string;
    sectionDeclining: string;
    sectionDecliningBody: string;
    ftpIncrease: string;
    paceImproved: string;
    weeklyVolumeUp: string;
    weeklyVolumeDown: string;
    weeklyLoadUp: string;
    weeklyLoadDown: string;
    loadBody: string;
    patternMatch: string;
    consistencyStreak: string;
    peakFitness: string;
    formAdvice: {
      fresh: string;
      grey: string;
      optimal: string;
      tired: string;
      overreaching: string;
    };
    volumeBody: string;
    formBody: {
      fresh: string;
      grey: string;
      optimal: string;
      tired: string;
      overreaching: string;
    };
    viewDetails: string;
    today: string;
    tomorrow: string;
    teaser: {
      workoutToday: string;
      prOpportunity: string;
      usualPattern: string;
      improving: string;
      stable: string;
    };
    strengthBalance: {
      volumeSplit: string;
      balanced: string;
      watch: string;
      imbalanced: string;
      oneSided: string;
      lowSignal: string;
      noSignal: string;
      noRecentVolume: string;
      volumeAppeared: string;
      volumeUp: string;
      volumeDown: string;
      volumeSteady: string;
    };
    quickTake: {
      howCalculated: string;
      title: string;
      whatChanged: string;
      whyItMatters: string;
      nextLook: string;
      sectionPr: { changed: string; matters: string; next: string };
      hrvTrend: { changed: string; matters: string; next: string };
      periodComparison: { changed: string; matters: string; next: string };
      fitnessMilestone: {
        changedFtp: string;
        changedSwimPace: string;
        changedRunPace: string;
        mattersFtp: string;
        mattersPace: string;
        nextFtp: string;
        nextPace: string;
      };
      strengthProgression: { changed: string; matters: string; next: string };
      strengthBalance: { changed: string; matters: string; next: string };
      stalePr: {
        changedPowerGrouped: string;
        changedPowerSingle: string;
        changedSwimGrouped: string;
        changedSwimSingle: string;
        changedRunGrouped: string;
        changedRunSingle: string;
        changedGenericGrouped: string;
        changedGenericSingle: string;
        matters: string;
        nextGrouped: string;
        nextSingle: string;
      };
      efficiencyTrend: { changed: string; matters: string; next: string };
    };
    viewInDetail: string;
  };

  strength: {
    snapshot: string;
    muscleInFocus: string;
    muscleStandsOut: string;
    selectedMuscleObservation: string;
    topMuscleWithBalance: string;
    topMuscleOnly: string;
    defaultObservation: string;
    noWorkouts: string;
    noWorkoutsHint: string;
    workoutCount_one: string;
    workoutCount_other: string;
    workoutCount_label_one: string;
    workoutCount_label_other: string;
    sets: string;
    muscleGroups: string;
    muscleGroupVolume: string;
    relativeWeightedSets: string;
    reps: string;
    tapMuscleGroup: string;
    relativeVolume: string;
    balanceObservedPairs: string;
    balancedPairsClose: string;
    balanceDominant: string;
    balanceFootnote: string;
    pairsInfoTitle: string;
    pairsInfoIntro: string;
    pairsInfoThresholds: string;
    pairsInfoMinSignal: string;
    exercisesTargeting: string;
    exerciseSets: string;
    exerciseWorkoutCount_one: string;
    exerciseWorkoutCount_other: string;
    totalVolume: string;
    infoWeighting: string;
    progression: string;
    last4Weeks: string;
    newSignal: string;
    recentAvg: string;
    earlierAvg: string;
    peakWeek: string;
    periodWeek: string;
    period4Weeks: string;
    period3Months: string;
    period6Months: string;
    disclaimer: string;
    showDetails: string;
    hideDetails: string;
    exercise: string;
    exercises: string;
  };

  fitnessScreen: {
    title: string;
    loadingData: string;
    failedToLoad: string;
    current: string;
    ctl: string;
    atl: string;
    tsb: string;
    rampRate: string;
    perWeek: string;
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
    linkFitnessPage: string;
    linkTSBManagement: string;
    linkTrainingLoad: string;
  };

  whatsNew: {
    skipButton: string;
    nextButton: string;
    doneButton: string;
    showMeButton: string;
    seeAllFeatures: string;
    justWhatsNew: string;
    backToTour: string;
    closeTour: string;
    v022: {
      mapStylesTitle: string;
      mapStylesBody: string;
      mapStylesHint: string;
      heatmapTitle: string;
      heatmapBody: string;
      heatmapTip: string;
      fitnessTitle: string;
      fitnessBody: string;
    };
    v030: {
      insightsTitle: string;
      insightsBody: string;
      strengthTitle: string;
      strengthBody: string;
      sectionTrimTitle: string;
      sectionTrimBody: string;
      backupTitle: string;
      backupBody: string;
    };
  };

  notifications: {
    sectionPr: { title: string };
    fitnessMilestone: { title: string };
    periodComparison: { title: string };
    tsbForm: { title: string };
    hrvTrend: { title: string };
    stalePr: { title: string };
    sectionCluster: { title: string };
    efficiencyTrend: { title: string };
    generic: { title: string };
    activityRecorded: { title: string; body: string; placeholder: string };
    privacy: {
      title: string;
      brief: string;
      body: string;
      accept: string;
    };
    settings: {
      title: string;
      enable: string;
      categories: string;
      sectionPr: string;
      fitnessMilestone: string;
      requiresOAuth: string;
      privacyHint: string;
      stravaNote: string;
    };
    prompt: {
      title: string;
      description: string;
      enable: string;
      dismiss: string;
      settingsHint: string;
    };
  };

  wellnessScreen: {
    title: string;
    trends: string;
  };

  healthScreen: {
    title: string;
  };

  trainingScreen: {
    title: string;
    routes: string;
    sections: string;
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
    expandInSettings: string;
    dataRangeHint: string;
  };

  statsScreen: {
    title: string;
    days42: string;
    months3: string;
    months6: string;
    year1: string;
    lactateThreshold: string;
    noEffortData: string;
    pace: string;
    heartRate: string;
    maxHr: string;
    paceCurve: string;
    paceCurveInfo: string;
    powerCurve: string;
    powerCurveInfo: string;
    ref: string;
    garminNote: string;
    seasonBests: string;
    swimPaceCurve: string;
    trainingZones: string;
    eFTPTrend: string;
    ftpLabel: string;
    decoupling: string;
  };

  licenses: {
    title: string;
    intro: string;
    footer: string;
    sectionCoreFramework: string;
    sectionMapData: string;
    sectionMapsGraphics: string;
    sectionNativeEngine: string;
    sectionNetworkingUtilities: string;
    sectionSpecialLicenses: string;
    sectionStateManagement: string;
    sectionUIComponents: string;
  };

  mapScreen: {
    loadingActivities: string;
    loadingOlderActivities: string;
    syncing: string;
  };

  routes: {
    basedOnActivities: string;
    firstRunHint: string;
    pr: string;
    routesFound: string;
    sameDirection: string;
    searchSections: string;
    searchRoutes: string;
    showHidden: string;
    showRemoved: string;
    sortActivities: string;
    sortDistance: string;
    sortMostVisited: string;
    sortNameAZ: string;
    sortNearby: string;
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
    duplicateNameMessage: string;
    duplicateNameTitle: string;
    createSection: string;
    sectionCreated: string;
    sectionCreatedDescription: string;
    sectionCreationFailed: string;
    gpsTrackNotSynced: string;
    invalidSectionRange: string;
    sectionTooLarge: string;
    sectionTooLargeWithHint: string;
    shareDetailsWithDeveloper: string;
    legendSection: string;
    legendYourEffort: string;
    legendFullActivity: string;
    legendRoute: string;
    pointCountHint: string;
    overDays: string;
    overMonths: string;
    overYears: string;
    dataRangeHint: string;
    expandInSettings: string;
    routeWord: string;
    sectionWord: string;
    setAsReference: string;
    setAsReferenceConfirm: string;
  };

  sections: {
    acceptSection: string;
    acceptAllSections: string;
    acceptAllConfirm: string;
    acceptedCount: string;
    pinned: string;
    activitiesCount: string;
    performanceOverTime: string;
    legendPr: string;
    legendReverse: string;
    legendThisActivity: string;
    best: string;
    current: string;
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
    routesCountLabel: string;
    activities: string;
    noActivitiesFound: string;
    sectionNamePlaceholder: string;
    bestTime: string;
    avg: string;
    averageTime: string;
    averagePace: string;
    totalTraversals: string;
    last: string;
    lastActivity: string;
    autoName: string;
    suggestedName: string;
    defaultName: string;
    deleteSection: string;
    deleteSectionConfirm: string;
    disableSection: string;
    duplicateNameMessage: string;
    duplicateNameTitle: string;
    disableSectionConfirm: string;
    disabled: string;
    removeSection: string;
    removeSectionConfirm: string;
    removed: string;
    restoreSection: string;
    excludeActivity: string;
    excludeActivityConfirm: string;
    exclude: string;
    forward: string;
    reference: string;
    setAsReference: string;
    setAsReferenceConfirm: string;
    resetReference: string;
    resetReferenceConfirm: string;
    referenceUpdated: string;
    editBounds: string;
    edited: string;
    moreActions: string;
    trimming: string;
    resetBounds: string;
    resetBoundsConfirm: string;
    boundsModified: string;
    trimFailed: string;
    trimTooShort: string;
    originalDistance: string;
    points: string;
    traversalsCount: string;
    visitsCount: string;
    bestPerWeek: string;
    bestPerMonth: string;
    bestPerQuarter: string;
    bestPerYear: string;
    groupingTitle: string;
    groupingDescription: string;
    performanceHistory: string;
    traversalsSummary: string;
    scanForMatches: string;
    scanForMore: string;
    scanning: string;
    noMatchesFound: string;
    noSectionsFound: string;
    matchQuality: string;
    atPosition: string;
    addToSection: string;
    nearbySections: string;
    nearbySectionsCount: string;
    similarNearby: string;
    similarNearbyCount: string;
    mergeSections: string;
    mergeKeepMessage: string;
    mergeInto: string;
    mergeSuccess: string;
    mergeCandidatesTitle: string;
    mergeCandidatesSubtitle: string;
    overlapLabel: string;
    rescan: string;
    rescanComplete: string;
    forceRedetect: string;
    rematchActivities: string;
    awayDistance: string;
    viewSection: string;
    merge: string;
  };

  engine: {
    initFailed: string;
  };

  errorState: {
    defaultTitle: string;
    defaultMessage: string;
    tryAgain: string;
    unableToLoad: string;
    restartHint: string;
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
    addingActivities: string;
    allActivitiesSynced: string;
    analyzingRouteGroups: string;
    analyzingRoutes: string;
    analyzingRoutesProgress: string;
    cancelled: string;
    complete: string;
    detectingSections: string;
    detectingSectionsProgress: string;
    downloadingActivities: string;
    downloadingGpsProgress: string;
    downloadingTiles: string;
    engineNotAvailable: string;
    fetchingGpsData: string;
    loadingDemoGps: string;
    nativeModuleUnavailable: string;
    noValidGpsData: string;
    noValidGpsChecked: string;
    offlineUsingCached: string;
    processingGpsTracks: string;
    processingRoutes: string;
    renderingTerrainPreviews: string;
    routeAnalysisComplete: string;
    syncComplete: string;
    syncFailed: string;
    syncResetDiscarded: string;
    syncedActivities: string;
    syncedDemoActivities: string;
    syncingActivities: string;
    fetchingTimeStreams: string;
    finalizingHeatmap: string;
  };

  chartTypes: {
    power: string;
    hr: string;
    cad: string;
    speed: string;
    pace: string;
    gap: string;
    elev: string;
    grade: string;
    gradient: string;
    wbal: string;
    dist: string;
    alt: string;
    temp: string;
    watts: string;
    movingTime: string;
    elapsedTime: string;
  };

  activityDetail: {
    failedToLoad: string;
    avgPace: string;
    avgSpeed: string;
    avgHR: string;
    avgPower: string;
    np: string;
    elapsedTime: string;
    tabs: {
      charts: string;
      exercises: string;
      intervals: string;
      route: string;
      routes: string;
      sections: string;
    };
    noMatchedSections: string;
    noMatchedSectionsDescription: string;
    noRouteMatch: string;
    noRouteMatchDescription: string;
    noIntervals: string;
    intervalWork: string;
    intervalRecovery: string;
    chartDisplayOptions: string;
    fullscreenChart: string;
    feedPreviewUpdated: string;
    primary: string;
    secondary: string;
    exercises: string;
    exercisesSummary: string;
    muscleDataSource: string;
    bodyShapeFromProfile: string;
    bodyShapeRandom: string;
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
    current: string;
    distanceHalf: string;
    distanceMile: string;
    previous: string;
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
    auto: string;
    connectHint: string;
    dayAverage: string;
    dragToExplore: string;
    hrs: string;
    insightExtraRecovery: string;
    insightGoodRecovery: string;
    insightStable: string;
    lastDays: string;
    noData: string;
    none: string;
    noTrendData: string;
    rawData: string;
    restingHR: string;
    sleep: string;
    sleepScore: string;
    smoothingDescription: string;
    smoothingHint: string;
    smoothingTitle: string;
    trendHint: string;
    weight: string;
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

  recording: {
    activityName: string;
    activityType: string;
    allActivities: string;
    avgHr: string;
    avgHrLabel: string;
    avgPower: string;
    avgSpeed: string;
    backgroundPermission: string;
    banner: {
      returnToRecording: string;
    };
    categories: {
      cycling: string;
      gym: string;
      other: string;
      racket: string;
      running: string;
      swimming: string;
      water: string;
      winter: string;
    };
    continue: string;
    controls: {
      lap: string;
      lock: string;
      pause: string;
      resume: string;
      save: string;
      stop: string;
    };
    discard: string;
    discardConfirm: string;
    discardMessage: string;
    discardTitle: string;
    distance: string;
    duration: string;
    durationLabel: string;
    durationRequired: string;
    elevation: string;
    error: string;
    fields: {
      avgPace: string;
      avgSpeed: string;
      cadence: string;
      calories: string;
      distance: string;
      elevation: string;
      elevationGain: string;
      heartrate: string;
      lapDistance: string;
      lapTime: string;
      movingTime: string;
      pace: string;
      power: string;
      speed: string;
      timer: string;
    };
    lap: string;
    manualDistance: string;
    manualDuration: string;
    manualHR: string;
    notes: string;
    notesPlaceholder: string;
    paused: string;
    permissionRequired: string;
    quickStart: string;
    rec: string;
    recording: string;
    review: string;
    reviewActivity: string;
    rpe: string;
    saveAndUpload: string;
    saveError: string;
    saveForLater: string;
    saved: string;
    savedForLater: string;
    savedOffline: string;
    saving: string;
    startActivity: string;
    status: {
      paused: string;
      recording: string;
    };
    stop: string;
    stopMessage: string;
    stopTitle: string;
    stopped: string;
    summary: string;
    summaryStats: string;
    todaysWorkouts: string;
    types: string;
    uploadError: string;
    uploadErrorMessage: string;
    uploadSuccess: string;
    slideToUnlock: string;
    trimActivity: string;
    rpeDescription: string;
    savedQueued: string;
    gpsPermissionDenied: string;
    gpsWaiting: string;
    gpsTrackingError: string;
    autoPaused: string;
    autoPausedHint: string;
    resumePrevious: string;
    resumePreviousMessage: string;
    gpsAcquiring: string;
    gpsReady: string;
    gpsWeakWarning: string;
    gpsNone: string;
    gpsAlertTitle: string;
    gpsAlertMessage: string;
    gpsAlertContinue: string;
    gpsAlertSettings: string;
    gpsAlertStop: string;
    changeType: string;
    noWorkoutsPlanned: string;
    splitBanner: string;
    settings: string;
    settingsAutoPause: string;
    settingsAutoPauseThreshold: string;
    settingsDataFields: string;
    settingsUnits: string;
    timeOfDay: {
      morning: string;
      afternoon: string;
      evening: string;
      night: string;
    };
    rpeLabels: {
      easy: string;
      moderate: string;
      hard: string;
      veryHard: string;
      max: string;
    };
  };

  maps: {
    closeMap: string;
    toggleStyle: string;
    enable3D: string;
    disable3D: string;
    colorByGradient: string;
    resetOrientation: string;
    goToLocation: string;
    fitAll: string;
    zoomToActivity: string;
    closePopup: string;
    closeRoutePopup: string;
    closeSectionPopup: string;
    loadingRoute: string;
    viewDetails: string;
    viewRouteDetails: string;
    viewSectionDetails: string;
    allClear: string;
    clear: string;
    syncingActivities: string;
    activitiesCount: string;
    selected: string;
    cached: string;
    notSynced: string;
    showActivities: string;
    showHeatmap: string;
    showMyLocation: string;
    showMyLocationHint: string;
    showRoutes: string;
    showSections: string;
    hideActivities: string;
    hideHeatmap: string;
    hideRoutes: string;
    hideSections: string;
    activityTypes: {
      gym: string;
      hike: string;
      other: string;
      racket: string;
      ride: string;
      run: string;
      snow: string;
      swim: string;
      walk: string;
      water: string;
    };
  };

  activityTypes: {
    AlpineSki: string;
    BackcountrySki: string;
    Badminton: string;
    Canoeing: string;
    Crossfit: string;
    EBikeRide: string;
    Elliptical: string;
    Golf: string;
    GravelRide: string;
    Handcycle: string;
    HighIntensityIntervalTraining: string;
    Hike: string;
    IceSkate: string;
    InlineSkate: string;
    Kayaking: string;
    Kitesurf: string;
    MountainBikeRide: string;
    NordicSki: string;
    OpenWaterSwim: string;
    Other: string;
    Pickleball: string;
    Pilates: string;
    Racquetball: string;
    Ride: string;
    RockClimbing: string;
    RollerSki: string;
    Rowing: string;
    Run: string;
    Sail: string;
    Skateboard: string;
    Snowboard: string;
    Snowshoe: string;
    Soccer: string;
    Squash: string;
    StairStepper: string;
    StandUpPaddling: string;
    Surfing: string;
    Swim: string;
    TableTennis: string;
    Tennis: string;
    TrailRun: string;
    Treadmill: string;
    Velomobile: string;
    VirtualRide: string;
    VirtualRow: string;
    VirtualRun: string;
    Walk: string;
    WeightTraining: string;
    Wheelchair: string;
    Windsurf: string;
    Workout: string;
    Yoga: string;
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
