/**
 * Packs the built Chrome extension (dist/) into a zip for distribution.
 * Run after build: npm run pack (builds then zips).
 * Output: chrome-extensions/elasticsearch-performance-monitoring-extension-<version>.zip
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const distPath = path.join(root, 'dist');
const pkgPath = path.join(root, 'package.json');
const outputDir = path.join(root, 'chrome-extensions');

if (!fs.existsSync(distPath)) {
  console.error('dist/ not found. Run npm run build first.');
  process.exit(1);
}

const { version } = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const zipName = `elasticsearch-performance-monitoring-extension-${version}.zip`;
const zipPath = path.join(outputDir, zipName);

// Ensure output directory exists
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// Remove old zip if present
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

// Zip contents of dist (manifest.json must be at root of zip)
execSync(`cd "${distPath}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });

console.log('Packaged:', zipName);
