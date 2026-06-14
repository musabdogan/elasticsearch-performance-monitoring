# Release workflow

When the user asks to **pack**, **prepare**, **push to git**, or **release** the extension, complete **all** steps below — not just commit/push.

## Checklist

1. **Version** — bump if needed (`package.json`, `public/manifest.json`, `version.json`; `npm run version:sync` runs on build).
2. **Build & pack**
   ```bash
   npm run pack
   ```
   Output: `chrome-extensions/elasticsearch-performance-monitoring-extension-<version>.zip`
3. **Git** — commit source changes (never commit `dist/` or `chrome-extensions/`).
4. **Push** — `git push origin main`
5. **GitHub Release** — create tag `v<version>` with the zip attached:
   ```bash
   gh release create v<version> \
     "chrome-extensions/elasticsearch-performance-monitoring-extension-<version>.zip" \
     --title "v<version>" \
     --notes "<release notes>"
   ```
   Match the style of prior releases (sections + install instructions). Mark as **Latest**.

## Chrome install (for release notes)

Download the zip from Releases, extract, then **Load unpacked** from `chrome://extensions` (Developer mode).
