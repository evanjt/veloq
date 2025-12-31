# Google Play Store - App Information

This document contains the information needed for the Google Play Console "App content" section.

## App Details

| Field | Value |
|-------|-------|
| **App name** | Veloq |
| **Package name** | com.veloq.app |
| **Default language** | English (United States) |
| **Category** | Health & Fitness |
| **App type** | App (not Game) |

## Contact Details

| Field | Value |
|-------|-------|
| **Email** | veloq@evanjt.com |
| **Website** | https://veloq.evanjt.com |
| **Phone** | *(Optional - leave blank)* |

## Privacy Policy

**URL:** https://github.com/evanjt/veloq#privacy-policy

The privacy policy is maintained in the README.md file and covers:
- Data handling (all data stays on device)
- No data collection by the developer
- Third-party services used (Intervals.icu, map tile providers)
- Credential storage (encrypted using platform secure storage)

## App Access

**Requires login credentials:** Yes

Since Veloq requires an Intervals.icu API key to function, you must provide test credentials for Google Play review:

### Test Credentials for Review

*Create a test account at intervals.icu for the review team:*

| Field | Value |
|-------|-------|
| **Instructions** | 1. Open app → Enter API key below |
| **Athlete ID** | *(Your test athlete ID)* |
| **API Key** | *(Generate a key at intervals.icu/settings → Developer Settings)* |

**Note:** Create a dedicated test account with sample activity data for the review team. Do not use your personal account.

## Ads Declaration

| Question | Answer |
|----------|--------|
| **Does your app contain ads?** | No |

## Target Audience

| Question | Answer |
|----------|--------|
| **Target age group** | 13 and over |
| **Is this app designed for children?** | No |
| **Does the app appeal to children?** | No |

This app is designed for adult athletes who track their fitness activities. It contains no features designed to appeal to children and requires integration with an external fitness tracking service.

## News Apps

| Question | Answer |
|----------|--------|
| **Is this a news app?** | No |

## Government Apps

| Question | Answer |
|----------|--------|
| **Is this a government app?** | No |

## Financial Features

| Question | Answer |
|----------|--------|
| **Does your app provide financial services?** | No |

## Health Features

| Question | Answer |
|----------|--------|
| **Is this a health app?** | Yes |
| **Health data types** | Fitness/Exercise data |
| **Is health data shared with third parties?** | No |
| **Is this app a medical device?** | No |
| **Does app provide health-related advice?** | No |

### Health App Declaration

Veloq displays fitness metrics retrieved from Intervals.icu including:
- Heart rate data (average, max, zones)
- Power output (for cycling)
- Pace data (for running/swimming)
- Training load metrics (CTL/ATL/TSB)
- Wellness metrics (HRV, resting HR, sleep data)

The app does not provide medical advice and is intended for fitness tracking purposes only. All data originates from user-connected devices and the Intervals.icu platform.
