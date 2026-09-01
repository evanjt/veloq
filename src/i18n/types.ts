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

export interface TranslationResource {
  common: {
    loading: string;
    loadingMore: string;
    error: string;
    retry: string;
    cancel: string;
    close: string;
    save: string;
    delete: string;
    hide: string;
    confirm: string;
    back: string;
    ok: string;
    done: string;
    clearSearch: string;
    pullToRefresh: string;
    or: string;
    creating: string;
    showDetails: string;
    hideDetails: string;
    reset: string;
    activities: string;
    undo: string;
    remove: string;
    restore: string;
    on: string;
    off: string;
  };

  navigation: {
    feed: string;
    fitness: string;
    training: string;
    wellness: string;
    health: string;
    map: string;
    settings: string;
    activities: string;
    insights: string;
  };

  feed: {
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
    weight: string;
  };

  login: {
    title: string;
    subtitle: string;
    loginWithIntervals: string;
    oauthNotConfigured: string;
    oauthFailed: string;
    oauthStateValidationFailed: string;
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
    sessionDataKept: string;
    sessionRestore: string;
    sessionRestoreAthlete: string;
  };

  demo: {
    banner: string;
    tapToSignIn: string;
  };

  settings: {
    title: string;
    display: string;
    appearance: string;
    system: string;
    light: string;
    dark: string;
    language: string;
    primarySport: string;
    primarySportHintCycling: string;
    primarySportHintRunning: string;
    primarySportHintSwimming: string;
    maps: string;
    defaultStyle: string;
    exploreMapStyle: string;
    satellite: string;
    customiseByActivity: string;
    default: string;
    defaultMapHint: string;
    dataCache: string;
    syncActivities: string;
    syncActivitiesProgress: string;
    syncStop: string;
    syncStopping: string;
    pauseRouteProcessing: string;
    clearAllReload: string;
    activities: string;
    routesCount: string;
    sectionsCount: string;
    sectionDetection: string;
    sectionProximity: string;
    sectionMinLength: string;
    sectionMinActivities: string;
    reanalyzeSections: string;
    reanalyzeWarning: string;
    elevationBackfillRunning: string;
    elevationBackfillProgress: string;
    elevationBackfillComplete: string;
    elevationBackfillPartial: string;
    elevationBackfillRetrying_one: string;
    elevationBackfillRetrying_other: string;
    elevationBackfillFailed: string;
    elevationBackfillExplainer: string;
    elevationBackfillWhy: string;
    elevationBackfillWhyTitle: string;
    elevationBackfillWhyBody: string;
    previewSections: string;
    previewIntro: string;
    previewPickArea: string;
    previewAreaFallback: string;
    previewAreaVisits: string;
    previewAreaSections: string;
    sectionMaxLength: string;
    sectionSameTraffic: string;
    previewRun: string;
    previewRunning: string;
    previewFailed: string;
    previewPoolUnusable: string;
    previewSuspended: string;
    previewUnchanged: string;
    previewChanged: string;
    previewNew: string;
    previewGone: string;
    previewStatusUnchanged: string;
    previewStatusChanged: string;
    previewStatusNew: string;
    previewStatusGone: string;
    previewCurrentLayer: string;
    previewProposedLayer: string;
    previewKeep: string;
    previewDiscard: string;
    previewKeepTitle: string;
    previewKeepWarning: string;
    previewKeepRefusedTitle: string;
    previewKeepRefused: string;
    database: string;
    dateRange: string;
    noData: string;
    lastSynced: string;
    cachedQueries: string;
    routeMatching: string;
    account: string;
    disconnectAccount: string;
    disconnectAndClearData: string;
    dataSources: string;
    dataSourcesDescription: string;
    hideDemoBanner: string;
    hideDemoBannerHint: string;
    support: string;
    subscribe: string;
    version: string;
    languageGroups: {};
    dialect: string;
    units: string;
    unitsAuto: string;
    unitsAutoHint: string;
    unitsAutoHintWithIntervals: string;
    unitsMetric: string;
    unitsMetricHint: string;
    unitsImperial: string;
    unitsImperialHint: string;
    localDataRange: string;
    summaryCard: string;
    showSummaryCard: string;
    heroMetric: string;
    showSparkline: string;
    supportingMetrics: string;
    maxMetricsHint: string;
    appTour: string;
    appTourDescription: string;
    general: string;
    data: string;
    notificationsAndStorage: string;
    routesAndSections: string;
    heatmapGeneration: string;
    heatmapDescription: string;
    heatmapStorageUsed: string;
    cacheAndDatabase: string;
    sinceDateSubtitle: string;
  };

  alerts: {
    cacheCleared: string;
    cacheCorruptionMessage: string;
    error: string;
    clearCacheTitle: string;
    clearCacheMessage: string;
    clearReload: string;
    disconnectTitle: string;
    disconnectMessage: string;
    disconnect: string;
    failedToClear: string;
    failedToDisconnect: string;
    accountChangeTitle: string;
    accountChangeMessage: string;
    accountChangeDemoMessage: string;
    accountChangeContinue: string;
    disconnectAndClearTitle: string;
    disconnectAndClearMessage: string;
    disconnectAndClearConfirm: string;
  };

  export: {
    gpx: string;
    exporting: string;
    error: string;
    bulkExport: string;
    bulkExporting: string;
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
    sectionsRestored: string;
    namesRestored: string;
    preferencesRestored: string;
    sectionsSkipped: string;
    databaseRestored: string;
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
    backupSuccessMessage: string;
    backupFailedMessage: string;
    backupFailedAuth: string;
    backupFailedQuota: string;
    backupFailedPath: string;
    backupFailedServer: string;
    backupFailedTransport: string;
    lastAttemptFailed: string;
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
    heartRate: string;
    power: string;
    calories: string;
    noHeartRateData: string;
    timeInHRZones: string;
    timeInPowerZones: string;
    ftp: string;
    maxHR: string;
    noDataAvailable: string;
    zoneDefault: string;
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
    };
    muscle: {
      setCount_one: string;
      setCount_other: string;
      repsCount: string;
    };
  };

  time: {
    today: string;
    yesterday: string;
    daysAgo: string;
    daysCount: string;
    yearsCount: string;
    current: string;
    now: string;
  };

  units: {
    m: string;
    ft: string;
    bpm: string;
    watts: string;
    kcal: string;
  };

  insights: {
    sectionChanged: {
      title: string;
      recut: string;
      split: string;
      restored: string;
      reverted: string;
      body: string;
    };
    title: string;
    noInsights: string;
    noInsightsHint: string;
    sectionPr: string;
    sectionPrSubtitle: string;
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
    strengthBalance: {
      volumeSplit: string;
      balanced: string;
      watch: string;
      imbalanced: string;
      oneSided: string;
      lowSignal: string;
      noSignal: string;
    };
    viewInDetail: string;
  };

  strength: {
    snapshot: string;
    noWorkouts: string;
    noWorkoutsHint: string;
    sets: string;
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
    exercise: string;
    exercises: string;
  };

  fitnessScreen: {
    title: string;
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
    v040: {
      sectionsTitle: string;
      sectionsBody: string;
      rowDeterministic: string;
      rowSameResult: string;
      rowLedger: string;
      rowRevert: string;
      rowRetired: string;
      rowPinned: string;
      rowEveryDevice: string;
      recutRunning: string;
      recutRunningPhase: string;
      phasePreparing: string;
      phaseDetecting: string;
      phaseDiffing: string;
      diffTotals: string;
      diffBreakdown: string;
      diffUnchanged: string;
      recutFailed: string;
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
    sectionPr: {
      title: string;
    };
    fitnessMilestone: {
      title: string;
    };
    periodComparison: {
      title: string;
    };
    tsbForm: {
      title: string;
    };
    hrvTrend: {
      title: string;
    };
    stalePr: {
      title: string;
    };
    sectionCluster: {
      title: string;
    };
    efficiencyTrend: {
      title: string;
    };
    generic: {
      title: string;
    };
    activityRecorded: {
      title: string;
    };
    privacy: {
      title: string;
      brief: string;
      accept: string;
    };
    settings: {
      title: string;
      enable: string;
      requiresOAuth: string;
      privacyHint: string;
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
    trends: string;
  };

  healthScreen: {
    title: string;
  };

  trainingScreen: {
    routes: string;
    sections: string;
  };

  routesScreen: {
    matchingDisabled: string;
    goToSettings: string;
    computingRoutes: string;
    downloadingGps: string;
    expandDateRange: string;
  };

  statsScreen: {
    lactateThreshold: string;
    noEffortData: string;
    pace: string;
    heartRate: string;
    paceCurve: string;
    powerCurve: string;
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
  };

  routes: {
    searchSections: string;
    searchRoutes: string;
    sortActivities: string;
    sortDistance: string;
    sortMostVisited: string;
    sortNameAZ: string;
    sortNearby: string;
    sortSignature: string;
    lookingForRoutes: string;
    checking: string;
    waiting: string;
    loadingRoutes: string;
    analysingRoutes: string;
    thisMayTakeMoment: string;
    noRoutesYet: string;
    routesWillAppear: string;
    noMatchingRoutes: string;
    routesWithTwoPlus: string;
    match: string;
    more: string;
    noFrequentSections: string;
    sectionsDescription: string;
    noSectionsMatchFilter: string;
    adjustSportTypeFilter: string;
    activities: string;
    routeNamePlaceholder: string;
    visits: string;
    custom: string;
    duplicateNameMessage: string;
    duplicateNameTitle: string;
    createSection: string;
    sectionCreationFailed: string;
    gpsTrackNotSynced: string;
    invalidSectionRange: string;
    sectionTooLarge: string;
    sectionTooLargeWithHint: string;
    shareDetailsWithDeveloper: string;
    pointCountHint: string;
    dataRangeHint: string;
    expandInSettings: string;
    routeWord: string;
    sectionWord: string;
    setAsReference: string;
    setAsReferenceConfirm: string;
  };

  sectionHistory: {
    title: string;
    empty: string;
    around: string;
    forkAround: string;
    prEra: string;
    prMoved: string;
    versions: string;
    version: string;
    current: string;
    revert: string;
    revertConfirm: string;
    unpin: string;
    showOnMap: string;
    hideOnMap: string;
    retiredTitle: string;
    retiredEmpty: string;
    retiredInto: string;
    seeRetired: string;
    kind_formed: string;
    kind_restored: string;
    kind_split: string;
    kind_recut: string;
    kind_dissolved: string;
    kind_merged: string;
    kind_superseded: string;
    kind_reverted: string;
    kind_pr_rebased: string;
    kind_baseline: string;
    kind_algorithm_changed: string;
  };
  namedCorridors: {
    title: string;
    link: string;
    empty: string;
    created: string;
    dormant: string;
    onSection: string;
    secondary: string;
    delete: string;
    deleteTitle: string;
    deleteConfirm: string;
  };
  sections: {
    acceptSection: string;
    acceptAllSections: string;
    acceptAllConfirm: string;
    acceptedCount: string;
    pinned: string;
    accepted: string;
    acceptedOnly: string;
    laps: string;
    lap: string;
    avgHr: string;
    maxGrade: string;
    excludeLap: string;
    undoExclude: string;
    lapExcluded: string;
    partlyExcluded: string;
    elevationGain: string;
    avgGrade: string;
    activitiesCount: string;
    performanceOverTime: string;
    legendPr: string;
    legendReverse: string;
    legendThisActivity: string;
    best: string;
    reverse: string;
    scrubHint: string;
    sectionNotFound: string;
    aerobicEfficiency: string;
    aerobicEfficiencyDetail: string;
    aerobicEfficiencyCaption: string;
    traversals: string;
    routesCountLabel: string;
    noActivitiesFound: string;
    sectionNamePlaceholder: string;
    avg: string;
    autoName: string;
    autoNameClimb: string;
    autoNameDescent: string;
    autoNameLoop: string;
    splitName: string;
    splitOrdinal: string;
    splitNorth: string;
    splitEast: string;
    splitSouth: string;
    splitWest: string;
    defaultName: string;
    deleteSection: string;
    deleteSectionConfirm: string;
    duplicateNameMessage: string;
    duplicateNameTitle: string;
    disabled: string;
    removeSection: string;
    removeSectionConfirm: string;
    removed: string;
    restoreSection: string;
    forward: string;
    setAsReference: string;
    setAsReferenceConfirm: string;
    resetReference: string;
    resetReferenceConfirm: string;
    editBounds: string;
    resetBounds: string;
    resetBoundsConfirm: string;
    trimFailed: string;
    trimTooShort: string;
    points: string;
    visitsCount: string;
    traversalsSummary: string;
    scanForMatches: string;
    scanForMore: string;
    scanning: string;
    noMatchesFound: string;
    matchQuality: string;
    atPosition: string;
    addToSection: string;
    nearbySectionsCount: string;
    similarNearbyCount: string;
    mergeSections: string;
    mergeKeepMessage: string;
    mergeInto: string;
    mergeCandidatesTitle: string;
    mergeCandidatesSubtitle: string;
    overlapLabel: string;
    viewSection: string;
    merge: string;
  };

  engine: {
    initFailed: string;
  };

  errorState: {
    defaultTitle: string;
    tryAgain: string;
    unableToLoad: string;
    unableToDisplay: string;
    unableToDisplayChart: string;
    tapToRetry: string;
    restartHint: string;
  };

  emptyState: {
    networkError: {
      title: string;
      description: string;
    };
    error: {
      title: string;
      description: string;
    };
    offline: {
      title: string;
      description: string;
    };
    syncError: {
      title: string;
      lastSynced: string;
      neverSynced: string;
    };
  };

  cache: {
    addingActivities: string;
    allActivitiesSynced: string;
    analyzingRoutes: string;
    complete: string;
    downloadingGpsProgress: string;
    engineNotAvailable: string;
    fetchingGpsData: string;
    loadingDemoGps: string;
    noValidGpsData: string;
    noValidGpsChecked: string;
    offlineUsingCached: string;
    renderingTerrainPreviews: string;
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
    wbal: string;
    temp: string;
  };

  activityDetail: {
    failedToLoad: string;
    tabs: {
      charts: string;
      exercises: string;
      intervals: string;
      route: string;
      sections: string;
    };
    noMatchedSections: string;
    noMatchedSectionsDescription: string;
    noRouteMatch: string;
    noRouteMatchDescription: string;
    feedPreviewUpdated: string;
    primary: string;
    secondary: string;
    exercises: string;
    exercisesSummary: string;
  };

  routeDetail: {
    routeNotFound: string;
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
    daysCount: string;
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
    dragToExplore: string;
    lastDays: string;
    noTrendData: string;
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
  };

  formZones: {
    transition: string;
    fresh: string;
    greyZone: string;
    optimal: string;
    highRisk: string;
  };

  sensors: {
    title: string;
    manageSensors: string;
    paired: string;
    nonePaired: string;
    addSensor: string;
    scan: string;
    stopScan: string;
    searching: string;
    pair: string;
    forget: string;
    bleUnavailable: string;
    bleUnavailableHint: string;
    kinds: {
      heartRate: string;
      power: string;
      cadence: string;
    };
    status: {
      connecting: string;
      connected: string;
      reconnecting: string;
      disconnected: string;
    };
  };
  recording: {
    activityName: string;
    activityType: string;
    allActivities: string;
    avgHr: string;
    avgHrLabel: string;
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
      pause: string;
      resume: string;
      save: string;
      stop: string;
    };
    discard: string;
    distance: string;
    duration: string;
    durationLabel: string;
    durationRequired: string;
    elevation: string;
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
    notes: string;
    notesPlaceholder: string;
    paused: string;
    quickStart: string;
    rec: string;
    reviewActivity: string;
    rpe: string;
    saveError: string;
    startActivity: string;
    status: {
      paused: string;
      recording: string;
    };
    summary: string;
    todaysWorkouts: string;
    types: string;
    uploadErrorMessage: string;
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
    splitBanner: string;
    settings: string;
    settingsAutoPause: string;
    settingsAutoPauseThreshold: string;
    settingsDataFields: string;
    settingsUnits: string;
    settingsUpload: string;
    autoUpload: string;
    autoUploadDescription: string;
    savedLocally: string;
    settingsGps: string;
    gpsMode: string;
    gpsModeDescription: string;
    gpsModes: {
      high: string;
      balanced: string;
      batterySaver: string;
    };
    accuracyFilter: string;
    accuracyFilterDescription: string;
    autoPauseDelay: string;
    keepAwake: string;
    keepAwakeDescription: string;
    library: {
      title: string;
      empty: string;
      emptyHint: string;
      notFound: string;
      recorded: string;
      statusLabel: string;
      uploadNow: string;
      share: string;
      delete: string;
      deleteConfirmTitle: string;
      deleteConfirmMessage: string;
      pendingUploads: string;
      status: {
        localOnly: string;
        pending: string;
        uploading: string;
        uploaded: string;
        failed: string;
        permissionBlocked: string;
      };
    };
    routeOverlay: {
      title: string;
      none: string;
      empty: string;
      activities: string;
    };
    returnToRecording: string;
    batteryOptNudge: string;
    batteryOptOpenSettings: string;
    writeScopeNotGranted: string;
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
    closeSectionPopup: string;
    unavailableTitle: string;
    unavailableHint: string;
    viewDetails: string;
    viewSectionDetails: string;
    allClear: string;
    clear: string;
    activitiesCount: string;
    selected: string;
    cached: string;
    notSynced: string;
    showActivities: string;
    showHeatmap: string;
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
  support: {
    enjoyingTitle: string;
    feedbackDescription: string;
    review: string;
    idea: string;
    forum: string;
    supportDevelopment: string;
    tipTitle: string;
    remindLater: string;
    neverShow: string;
    thankYou: string;
    sponsorGitHub: string;
    tipSmall: string;
    tipMedium: string;
    tipLarge: string;
    shareCrashLog: string;
    noCrashLog: string;
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
