/**
 * Syncs version from version.json to package.json and public/manifest.json.
 * Run before build/publish so Chrome extension and npm use the same version.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const versionPath = path.join(root, 'version.json');
const pkgPath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'public', 'manifest.json');

const { version } = JSON.parse(fs.readFileSync(versionPath, 'utf8'));

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.version = version;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log('Version synced to', version);
console.log('  - package.json');
console.log('  - public/manifest.json');
