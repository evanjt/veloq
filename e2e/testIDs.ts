/**
 * Test IDs for E2E testing with Detox.
 *
 * These IDs should be added to components using the testID prop.
 * Example: <View testID={testIDs.login.demoButton} />
 */
export const testIDs = {
  // Login Screen
  login: {
    screen: 'login-screen',
    apiKeyInput: 'login-api-key-input',
    loginButton: 'login-button',
    demoButton: 'login-demo-button',
    errorText: 'login-error-text',
  },

  // Home/Feed Screen
  home: {
    screen: 'home-screen',
    activityList: 'home-activity-list',
    searchInput: 'home-search-input',
    filterButton: 'home-filter-button',
    profileButton: 'home-profile-button',
    refreshControl: 'home-refresh-control',
    loadingIndicator: 'home-loading-indicator',
    emptyState: 'home-empty-state',
  },

  // Activity Card
  activityCard: {
    container: 'activity-card',
    title: 'activity-card-title',
    stats: 'activity-card-stats',
    map: 'activity-card-map',
  },

  // Activity Detail Screen
  activityDetail: {
    screen: 'activity-detail-screen',
    map: 'activity-detail-map',
    statsSection: 'activity-detail-stats',
    chartsSection: 'activity-detail-charts',
    backButton: 'activity-detail-back',
  },

  // Settings Screen
  settings: {
    screen: 'settings-screen',
    themeToggle: 'settings-theme-toggle',
    clearCacheButton: 'settings-clear-cache',
    logoutButton: 'settings-logout-button',
    versionText: 'settings-version-text',
  },

  // Routes Screen
  routes: {
    screen: 'routes-screen',
    routeList: 'routes-list',
    routeCard: 'route-card',
    emptyState: 'routes-empty-state',
  },

  // Stats Screen
  stats: {
    screen: 'stats-screen',
    timeRangeSelector: 'stats-time-range',
    sportFilter: 'stats-sport-filter',
    chartContainer: 'stats-chart',
  },

  // Navigation
  nav: {
    settingsButton: 'nav-settings-button',
    backButton: 'nav-back-button',
  },

  // Common UI Elements
  common: {
    loadingSpinner: 'loading-spinner',
    errorState: 'error-state',
    retryButton: 'retry-button',
  },
} as const;

export type TestIDs = typeof testIDs;
