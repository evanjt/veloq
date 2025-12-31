# Android Release Signing

This document describes how to set up Android release signing for Veloq.

## Generate Release Keystore

Run this command to generate a new release keystore:

```bash
keytool -genkeypair -v \
  -keystore veloq-release.keystore \
  -alias veloq \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass YOUR_STORE_PASSWORD \
  -keypass YOUR_KEY_PASSWORD \
  -dname "CN=Evan Thomas, O=Veloq, L=City, ST=State, C=AU"
```

**Important:**
- Replace `YOUR_STORE_PASSWORD` and `YOUR_KEY_PASSWORD` with strong passwords
- Save these passwords securely - you'll need them forever
- Back up the keystore file - if lost, you cannot update the app on Google Play

## Configure GitHub Secrets

Add the following secrets to your GitHub repository:

1. Go to **Settings → Secrets and variables → Actions**
2. Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded keystore file |
| `ANDROID_KEYSTORE_PASSWORD` | Your keystore password |
| `ANDROID_KEY_ALIAS` | `veloq` |
| `ANDROID_KEY_PASSWORD` | Your key password |

### Encode Keystore to Base64

```bash
base64 -i veloq-release.keystore | tr -d '\n' > keystore-base64.txt
cat keystore-base64.txt
# Copy this output to the ANDROID_KEYSTORE_BASE64 secret
rm keystore-base64.txt
```

## Local Release Build

To build a release APK locally with your keystore:

1. Create `android/keystore.properties`:

```properties
storeFile=../veloq-release.keystore
storePassword=YOUR_STORE_PASSWORD
keyAlias=veloq
keyPassword=YOUR_KEY_PASSWORD
```

2. Add to `.gitignore`:

```
android/keystore.properties
*.keystore
```

3. Build:

```bash
cd android
./gradlew assembleRelease
```

## Google Play App Signing

Google Play recommends using Play App Signing, which means:

1. You sign with your **upload key** (the keystore you created)
2. Google re-signs with their **app signing key** before distribution

### Enrollment

When you first upload to Google Play Console:

1. Go to **Release → Setup → App signing**
2. Choose "Use Google-generated key" (recommended)
3. Upload your keystore as the upload key

This provides:
- Recovery if you lose your upload key
- Smaller APK sizes (optimized per device)
- Future security improvements

## Security Notes

- **Never commit** the keystore or passwords to git
- Store the keystore and passwords in a secure password manager
- Consider using a hardware security key for extra protection
- Keep a secure backup of the keystore file

## Keystore Location

Store your keystore outside the repository:

```
~/keys/veloq/
├── veloq-release.keystore
└── passwords.txt (encrypted)
```
