# Veloq Website

Landing page for Veloq at [veloq.evanjt.com](https://veloq.evanjt.com).

## Structure

```
docs/website/
├── index.html          # Main landing page
├── privacy/
│   └── index.html      # Privacy policy (/privacy/)
├── screenshots/        # Screenshots and videos for carousel
├── icon.png            # App icon
├── CNAME               # Custom domain config
└── README.md           # This file
```

## Deployment

Automatically deployed to GitHub Pages when changes are pushed to `main` branch.

To preview locally:
```bash
cd docs/website
python -m http.server 8000
# Open http://localhost:8000
```

---

## Adding Screenshots and Videos

The website has a phone-frame carousel that shows your app screenshots and demo videos. Currently it shows placeholders - here's how to add real media.

### Required Dimensions

| Type | Dimensions | Format | Notes |
|------|------------|--------|-------|
| Screenshots | 1080 x 2340 px | PNG or WebP | 9:19.5 aspect ratio (modern phone) |
| Videos | 1080 x 2340 px | MP4 (H.264) | Keep under 5MB, 10-30 seconds |

---

## Capturing Screenshots

### Android (Physical Device)

**Option 1: ADB (cleanest)**
```bash
# Connect device via USB with Developer Mode enabled
adb exec-out screencap -p > screenshot.png
```

**Option 2: Button combo**
- Press Power + Volume Down simultaneously
- Find in Photos app or `/sdcard/Pictures/Screenshots/`

### Android (Emulator)

1. Open Android Studio → Device Manager
2. Launch a Pixel 7 or Pixel 8 emulator (closest to 1080x2340)
3. Run the app: `npx expo run:android`
4. Click the camera icon in emulator toolbar
5. Screenshots save to Desktop

### iOS (Simulator)

**Command line:**
```bash
xcrun simctl io booted screenshot screenshot.png
```

**Or via menu:**
- Simulator menu → Device → Screenshot (Cmd+S)

### iOS (Physical Device)

- Press Side button + Volume Up simultaneously
- Find in Photos app

---

## Recording Videos

### Android: scrcpy (Recommended)

`scrcpy` mirrors your Android screen to your computer and can record directly. It's the easiest way to capture smooth video.

**Install:**
```bash
# Arch Linux
sudo pacman -S scrcpy

# Ubuntu/Debian
sudo apt install scrcpy

# macOS
brew install scrcpy

# Or download from: https://github.com/Genymobile/scrcpy
```

**Record:**
```bash
# Connect device via USB, then:
scrcpy --record veloq-demo.mp4

# Just mirror (no recording)
scrcpy
```

**Tips:**
- Use `--max-size 1080` to limit resolution
- Use `--bit-rate 4M` for smaller files
- Press Ctrl+C to stop recording

### Android: Built-in Screen Recorder

1. Swipe down twice for Quick Settings
2. Look for "Screen record" tile (add if missing)
3. Tap to start, stop via notification

### Android: ADB

```bash
# Record for 30 seconds max
adb shell screenrecord --time-limit 30 /sdcard/demo.mp4

# When done, pull the file
adb pull /sdcard/demo.mp4
```

### iOS (Simulator)

```bash
xcrun simctl io booted recordVideo demo.mp4
# Press Ctrl+C to stop
```

### iOS (Physical Device)

1. Swipe down from top-right for Control Center
2. Long-press the Screen Recording button
3. Make sure Microphone is OFF
4. Tap "Start Recording"
5. Tap the red status bar to stop

---

## Processing Media

### Install Tools

```bash
# Arch Linux
sudo pacman -S ffmpeg imagemagick

# Ubuntu/Debian
sudo apt install ffmpeg imagemagick

# macOS
brew install ffmpeg imagemagick
```

### Resize to Correct Dimensions

**Video:**
```bash
ffmpeg -i input.mp4 \
  -vf "scale=1080:2340:force_original_aspect_ratio=decrease,pad=1080:2340:(ow-iw)/2:(oh-ih)/2" \
  output.mp4
```

**Screenshot:**
```bash
convert input.png -resize 1080x2340^ -gravity center -extent 1080x2340 output.png
```

### Compress Video for Web

```bash
# Target ~2-3MB file size
ffmpeg -i input.mp4 -c:v libx264 -crf 28 -preset slow -an output.mp4
```

The `-an` removes audio (you don't need it for a demo).

### Convert to WebP (Optional)

WebP is smaller than PNG:
```bash
cwebp -q 85 screenshot.png -o screenshot.webp
```

---

## Adding Media to Website

### 1. Place Files in screenshots/

```
docs/website/screenshots/
├── feed.png
├── activity-map.png
├── charts.png
├── fitness.png
├── regional-map.png
├── heatmap.png
├── routes.png
├── settings.png
└── demo.mp4          # Optional video
```

### 2. Edit index.html

Find the `mediaItems` array in the `<script>` section and update it:

```javascript
const mediaItems = [
  { type: 'image', src: 'screenshots/feed.png', caption: 'Activity Feed' },
  { type: 'image', src: 'screenshots/activity-map.png', caption: 'Activity Map' },
  { type: 'image', src: 'screenshots/charts.png', caption: 'Multi-Metric Charts' },
  { type: 'image', src: 'screenshots/fitness.png', caption: 'Fitness Tracking' },
  { type: 'image', src: 'screenshots/regional-map.png', caption: 'Regional Map' },
  { type: 'image', src: 'screenshots/heatmap.png', caption: 'Heatmap' },
  { type: 'image', src: 'screenshots/routes.png', caption: 'Routes' },
  { type: 'image', src: 'screenshots/settings.png', caption: 'Settings' },
  { type: 'video', src: 'screenshots/demo.mp4', caption: 'App Demo' },
];
```

### 3. Commit and Push

```bash
git add docs/website/
git commit -m "Add app screenshots and demo video"
git push
```

---

## Recommended Screenshots

Capture these 8 screens to showcase all features:

| # | Screen | What to Show |
|---|--------|--------------|
| 1 | **Activity Feed** | Home screen with list of activities, stats |
| 2 | **Activity Map** | Single activity with GPS route highlighted |
| 3 | **Charts** | HR/power/pace graphs, maybe mid-scrub |
| 4 | **Fitness** | CTL/ATL/TSB chart with form zones |
| 5 | **Regional Map** | Map with multiple activities visible |
| 6 | **Heatmap** | Heatmap overlay showing popular routes |
| 7 | **Routes** | Routes list or a route detail view |
| 8 | **Settings** | Settings screen |

## Recommended Videos

Short clips (10-30 seconds) showing:

1. **Quick overview** - Scroll through the main screens
2. **Activity analysis** - Scrub through charts with map sync
3. **Map exploration** - Pan/zoom the regional map

---

## Tips for Great Captures

- **Use demo mode** (when implemented) for consistent, good-looking data
- **Clear notifications** before capturing
- **Use dark mode** for consistency (or capture both)
- **Show interesting data** - varied activities, nice routes
- **Ensure text is readable** at the carousel size
- **Keep videos short** - 10-30 seconds max, focus on one feature

---

## Website Features

- **Responsive** - Mobile, tablet, and desktop layouts
- **Dark mode** - Follows system preference
- **i18n** - English, Spanish, French
- **Animations** - Fade-in, floating phone effect
- **Carousel** - Auto-play, touch swipe, keyboard navigation
- **Phone frame** - Realistic device mockup

---

## Domain Setup

1. Add CNAME record: `veloq.evanjt.com` → `evanjt.github.io`
2. The `CNAME` file in this directory tells GitHub Pages the domain
3. HTTPS is automatic via GitHub Pages
