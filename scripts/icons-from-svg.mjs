#!/usr/bin/env node
/**
 * Regenerate extension icons from Searchali logo.
 * Run: node scripts/icons-from-svg.mjs
 */
import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const publicDir = join(root, 'public');
const iconsDir = join(publicDir, 'icons');
const sizes = [16, 32, 48, 128];
const logoPath = join(publicDir, '128x128-searchali_logo.png');

async function main() {
  await mkdir(iconsDir, { recursive: true });
  const buffer = await sharp(logoPath).resize(128, 128).png().toBuffer();

  for (const size of sizes) {
    const outPath = join(iconsDir, `icon${size}.png`);
    await sharp(buffer).resize(size, size).png().toFile(outPath);
    console.log(`Created ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
