# F-Droid Submission Guide

This document describes how to submit Veloq to the F-Droid repository.

## Prerequisites

- F-Droid metadata is already configured in `fastlane/metadata/android/en-US/`
- Version tags follow the pattern `v{version}` (e.g., `v0.0.1`, `v1.0.0`)
- Each release tag corresponds to `versionCode` in `android/app/build.gradle`

## Upstream Metadata (Already Configured)

The following files are maintained in this repository:

```
fastlane/metadata/android/en-US/
├── title.txt                           # App name
├── short_description.txt               # 30-50 chars
├── full_description.txt                # Full store description
├── changelogs/
│   └── {versionCode}.txt              # Changelog per version
└── images/
    ├── icon.png                        # App icon (512x512)
    └── phoneScreenshots/               # Screenshots (add before submission)
        ├── 1.png
        ├── 2.png
        └── ...
```

## F-Droid Metadata File

When submitting to F-Droid, create `metadata/com.veloq.app.yml` in your fdroiddata fork:

```yaml
Categories:
  - Sports & Health
License: Apache-2.0
AuthorName: Evan Thomas
AuthorEmail: veloq@evanjt.com
SourceCode: https://github.com/evanjt/veloq
IssueTracker: https://github.com/evanjt/veloq/issues

RepoType: git
Repo: https://github.com/evanjt/veloq

Builds:
  - versionName: '0.0.1'
    versionCode: 1
    commit: v0.0.1
    subdir: android/app
    sudo:
      - apt-get update
      - apt-get install -y rustup
      - rustup default stable
      - rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android
      - cargo install cargo-ndk
    init:
      - cd ../..
      - npm ci
      - npx expo prebuild --platform android --clean
    gradle:
      - release
    prebuild:
      - cd ../../rust/route-matcher
      - ./scripts/build-android.sh
      - ./scripts/install-android.sh
    scandelete:
      - node_modules
    ndk: r26d

AutoUpdateMode: Version
UpdateCheckMode: Tags
CurrentVersion: '0.0.1'
CurrentVersionCode: 1
```

## Build Dependencies

The F-Droid build requires:

1. **Rust toolchain** with Android targets:
   - `aarch64-linux-android`
   - `armv7-linux-androideabi`
   - `x86_64-linux-android`
   - `i686-linux-android`

2. **cargo-ndk** for cross-compilation

3. **Node.js** for Expo prebuild

4. **Android NDK r26d** (or compatible version)

## Submission Steps

### 1. Prepare Release

```bash
# Update version in package.json and app.json
# Update versionCode and versionName in android/app/build.gradle

# Create changelog for new versionCode
echo "Changes in this version..." > fastlane/metadata/android/en-US/changelogs/{versionCode}.txt

# Commit and tag
git add .
git commit -m "release: v{version}"
git tag v{version}
git push origin main --tags
```

### 2. Fork fdroiddata

```bash
git clone --depth=1 https://gitlab.com/YOUR_ACCOUNT/fdroiddata ~/fdroiddata
cd ~/fdroiddata
git checkout -b com.veloq.app
```

### 3. Create Metadata

```bash
cp templates/build-gradle.yml metadata/com.veloq.app.yml
# Edit metadata/com.veloq.app.yml with the content above
```

### 4. Test Build Locally

Using the F-Droid Docker container:

```bash
git clone --depth=1 https://gitlab.com/fdroid/fdroidserver ~/fdroidserver
sudo docker run --rm -itu vagrant --entrypoint /bin/bash \
  -v ~/fdroiddata:/build:z \
  -v ~/fdroidserver:/home/vagrant/fdroidserver:Z \
  registry.gitlab.com/fdroid/fdroidserver:buildserver

# Inside container:
. /etc/profile
export PATH="$fdroidserver:$PATH" PYTHONPATH="$fdroidserver"
cd /build
fdroid readmeta
fdroid rewritemeta com.veloq.app
fdroid checkupdates --allow-dirty com.veloq.app
fdroid lint com.veloq.app
fdroid build com.veloq.app
```

### 5. Submit Merge Request

```bash
cd ~/fdroiddata
git add metadata/com.veloq.app.yml
git commit -m "New App: com.veloq.app"
git push origin com.veloq.app
```

Create a merge request at https://gitlab.com/fdroid/fdroiddata with your `com.veloq.app` branch.

## Version Updates

For each new release:

1. Update `CurrentVersion` and `CurrentVersionCode` in the metadata
2. Add a new entry to the `Builds` list
3. Create the corresponding changelog file
4. Submit a merge request with the updates

With `AutoUpdateMode: Version` and `UpdateCheckMode: Tags`, F-Droid will automatically detect new version tags and queue builds.

## Notes

- F-Droid builds from source, ensuring reproducibility
- No proprietary dependencies are included
- All network requests go to Intervals.icu and map tile providers only
- The app contains no tracking, analytics, or ads
