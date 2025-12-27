# Veloq Website

This is the landing page for Veloq, hosted at https://veloq.evanjt.com via GitHub Pages.

## Setup

1. Enable GitHub Pages in repository settings:
   - Go to Settings → Pages
   - Source: GitHub Actions
   - The workflow will deploy automatically on pushes to `main`

2. Configure custom domain:
   - Add a CNAME record for `veloq.evanjt.com` pointing to `evanjt.github.io`
   - The CNAME file in this directory tells GitHub Pages the domain

## Screenshots Needed

Add screenshots to the `screenshots/` directory. The website expects these images:

| Filename | Description | Suggested Content |
|----------|-------------|-------------------|
| `1-feed.png` | Activity Feed | Home screen showing recent activities, quick stats pills |
| `2-activity-map.png` | Activity Map | Map view with route highlighted, 3D terrain |
| `3-activity-charts.png` | Multi-Metric Charts | HR, power, pace charts with scrubbing |
| `4-fitness.png` | Fitness Tracking | CTL/ATL/TSB chart with form zones |
| `5-regional-map.png` | Regional Map | All activities on timeline map |
| `6-heatmap.png` | Heatmap | Route density visualization |
| `7-routes.png` | Routes | Matched routes with performance data |
| `8-settings.png` | Settings | Theme and map preferences |

### Screenshot Guidelines

- **Size**: 1080 x 2340 pixels (or similar tall phone aspect ratio)
- **Format**: PNG
- **Style**: Use dark mode for consistency, or provide both light/dark
- **Content**: Use real or realistic sample data
- **Status bar**: Hide or use a clean status bar

### Adding Screenshots

1. Take screenshots on a device or emulator
2. Save to `docs/website/screenshots/`
3. Update `index.html` to replace placeholder divs with `<img>` tags:

```html
<div class="screenshot">
  <img src="screenshots/1-feed.png" alt="Activity Feed">
</div>
```

## Development

The website is a single HTML file with inline CSS for fast loading. No build step required.

To preview locally:

```bash
cd docs/website
python -m http.server 8000
# Open http://localhost:8000
```

## Deployment

The website deploys automatically via GitHub Actions when changes are pushed to `main` in the `docs/website/` directory.

Manual deployment can be triggered from the Actions tab → "Deploy Website" → "Run workflow".
