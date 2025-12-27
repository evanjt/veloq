# Google Play Store - Data Safety

This document contains the responses for Google Play Console's Data Safety questionnaire.

## Overview

Veloq is designed with privacy as a core principle. All data processing happens on-device, and no data is collected or shared by the developer.

---

## Data Collection & Sharing

### Does your app collect or share any of the required user data types?

**Answer:** Yes

*While Veloq doesn't send data to the developer, it does handle user data that must be declared.*

---

## Data Types Collected

### Location

| Question | Answer | Details |
|----------|--------|---------|
| **Approximate location** | No | |
| **Precise location** | Yes | Used to display activity maps and current position |

**Purpose:** App functionality (displaying activity routes on maps)
**Is this data required?** Optional (app works without location permission)
**Is this data processed ephemerally?** Yes
**Can users request deletion?** Yes (clear app data)

### Personal Info

| Question | Answer | Details |
|----------|--------|---------|
| **Name** | No | |
| **Email address** | No | |
| **User IDs** | Yes | Intervals.icu athlete ID stored locally |
| **Address** | No | |
| **Phone number** | No | |
| **Race and ethnicity** | No | |
| **Political or religious beliefs** | No | |
| **Sexual orientation** | No | |
| **Other info** | No | |

**Purpose:** App functionality (API authentication)
**Is this data encrypted?** Yes (platform secure storage)
**Can users request deletion?** Yes (logout clears credentials)

### Financial Info

| Question | Answer |
|----------|--------|
| **User payment info** | No |
| **Purchase history** | No |
| **Credit score** | No |
| **Other financial info** | No |

### Health and Fitness

| Question | Answer | Details |
|----------|--------|---------|
| **Health info** | Yes | HRV, resting heart rate, sleep data, wellness metrics |
| **Fitness info** | Yes | Activities, power, pace, heart rate zones, training load |

**Purpose:** App functionality (core app features)
**Is this data shared?** No
**Is this data required?** Yes
**Is this data processed ephemerally?** No (cached for offline access)
**Can users request deletion?** Yes (clear app data or uninstall)

### Messages

| Question | Answer |
|----------|--------|
| **Emails** | No |
| **SMS or MMS** | No |
| **Other in-app messages** | No |

### Photos and Videos

| Question | Answer |
|----------|--------|
| **Photos** | No |
| **Videos** | No |

### Audio Files

| Question | Answer |
|----------|--------|
| **Voice or sound recordings** | No |
| **Music files** | No |
| **Other audio files** | No |

### Files and Docs

| Question | Answer |
|----------|--------|
| **Files and docs** | No |

### Calendar

| Question | Answer |
|----------|--------|
| **Calendar events** | No |

### Contacts

| Question | Answer |
|----------|--------|
| **Contacts** | No |

### App Activity

| Question | Answer |
|----------|--------|
| **App interactions** | No |
| **In-app search history** | No |
| **Installed apps** | No |
| **Other user-generated content** | No |
| **Other actions** | No |

### Web Browsing

| Question | Answer |
|----------|--------|
| **Web browsing history** | No |

### App Info and Performance

| Question | Answer |
|----------|--------|
| **Crash logs** | No |
| **Diagnostics** | No |
| **Other app performance data** | No |

### Device or Other IDs

| Question | Answer |
|----------|--------|
| **Device or other IDs** | No |

---

## Data Sharing

### Is any of the collected data shared with third parties?

**Answer:** Yes (with important context)

Data is shared with:

1. **Intervals.icu** (Required)
   - User credentials (API key) sent to authenticate
   - No user data is uploaded, only downloaded

2. **Map tile providers** (Required)
   - Standard web requests to load map tiles
   - Providers: OpenStreetMap, Carto, Stadia Maps
   - Only map tile URLs are requested, no user data sent

**Note:** The developer (Evan Thomas) does not receive any user data.

---

## Security Practices

### Is data encrypted in transit?

**Answer:** Yes

All network requests use HTTPS.

### Is data encrypted at rest?

**Answer:** Partial

- **Credentials:** Encrypted using platform secure storage (Keychain/Keystore)
- **Cached data:** Standard app storage (not encrypted beyond OS-level encryption)

### Do you provide a way for users to request that their data be deleted?

**Answer:** Yes

Users can:
1. Log out (clears credentials)
2. Clear app data in device settings
3. Uninstall the app

---

## Summary for Data Safety Form

When filling out the Google Play Console Data Safety form:

| Section | Response |
|---------|----------|
| Data collection | Yes |
| Data sharing | Yes (with Intervals.icu and map providers only) |
| Data encrypted in transit | Yes |
| Data deletion available | Yes |
| Committed to Play Families Policy | No (not a kids app) |
| Independent security review | No |

### Data Types to Declare:

1. **Location > Precise location**
   - Collected: Yes
   - Shared: No
   - Purpose: App functionality

2. **Personal info > User IDs**
   - Collected: Yes
   - Shared: Yes (with Intervals.icu for authentication)
   - Purpose: App functionality

3. **Health and fitness > Health info**
   - Collected: Yes
   - Shared: No
   - Purpose: App functionality

4. **Health and fitness > Fitness info**
   - Collected: Yes
   - Shared: No
   - Purpose: App functionality
