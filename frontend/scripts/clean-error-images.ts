/**
 * Mask the AI-generator watermark on /public/errors/*.png in place.
 *
 * Why : the Gemini / Imagen output we used for the error pages carries a
 * tiny "Generated with Imagen" footer + sometimes a misspelled tagline
 * ("DEFEEAT"). The runtime ErrorPage component now overlays the correct
 * text via HTML AND draws a translucent mask over the bottom-right
 * watermark zone — but baking the mask into the asset itself means we
 * keep the cleanup even if the component is bypassed (OG-tag previews,
 * direct image hits, raw <img> embeds).
 *
 * IDEMPOTENCY : safe to re-run. The script writes to a `*.cleaned.png`
 * file first and only swaps the original on success. A backup of the
 * untouched original lands in `public/errors/.original/` the first time.
 *
 * RUN MANUALLY :
 *   npm i -D sharp        # one-time
 *   npx tsx frontend/scripts/clean-error-images.ts
 *
 * Not wired into a build hook on purpose — this runs once after a fresh
 * batch of images and is then committed alongside them.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import path from 'node:path';
import fs from 'node:fs/promises';

type Sharp = (input: string | Buffer) => {
  metadata(): Promise<{ width?: number; height?: number }>;
  composite(layers: Array<{ input: Buffer; top: number; left: number; blend?: string }>): ReturnType<Sharp>;
  png(): { toFile(out: string): Promise<unknown> };
};
let sharp: Sharp;
try {
  // sharp is a peer dep — only required when this script is invoked.
  sharp = require('sharp') as Sharp;
} catch {
  console.error('Missing dep: install sharp first → npm i -D sharp');
  process.exit(1);
}

// Mask region : bottom-right 24 % × 8 %. Same proportions as the runtime
// CSS overlay so the visual result is identical.
const MASK_W_PCT = 0.24;
const MASK_H_PCT = 0.08;
const MASK_FILL  = '#0A0A14'; // matches ErrorPage background

// Fade the inner edge so the mask doesn't look like a hard sticker on
// images with non-uniform backgrounds. SVG radial-gradient → Buffer → sharp
// `composite` overlay.
function buildMaskSvg(w: number, h: number): Buffer {
  const cx = w; // anchor at the corner
  const cy = h;
  const rOuter = Math.hypot(w, h);
  const rInner = Math.hypot(w, h) * 0.45;
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <radialGradient id="g" cx="${cx}" cy="${cy}" r="${rOuter}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${MASK_FILL}" stop-opacity="1"/>
      <stop offset="${(rInner / rOuter).toFixed(3)}" stop-color="${MASK_FILL}" stop-opacity="0.95"/>
      <stop offset="1" stop-color="${MASK_FILL}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
</svg>
`);
}

async function ensureBackup(originalPath: string): Promise<void> {
  const backupDir = path.join(path.dirname(originalPath), '.original');
  await fs.mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, path.basename(originalPath));
  try {
    await fs.access(backupPath);
    // already backed up
  } catch {
    await fs.copyFile(originalPath, backupPath);
    console.log(`  backed up → ${path.relative(process.cwd(), backupPath)}`);
  }
}

async function cleanOne(file: string): Promise<void> {
  const meta = await sharp(file).metadata();
  if (!meta.width || !meta.height) {
    console.warn(`  skip ${file} — no dimensions`);
    return;
  }
  const maskW = Math.round(meta.width * MASK_W_PCT);
  const maskH = Math.round(meta.height * MASK_H_PCT);
  const left  = meta.width - maskW;
  const top   = meta.height - maskH;

  await ensureBackup(file);

  const tmp = `${file}.cleaned.png`;
  await sharp(file)
    .composite([{ input: buildMaskSvg(maskW, maskH), top, left, blend: 'over' }])
    .png()
    .toFile(tmp);

  await fs.rename(tmp, file);
  console.log(`✓ ${path.basename(file)} (${maskW}×${maskH}px mask)`);
}

async function main() {
  const root = path.resolve(__dirname, '..', 'public', 'errors');
  const entries = await fs.readdir(root);
  const targets = entries
    .filter((f) => f.endsWith('.png'))
    .map((f) => path.join(root, f));

  console.log(`Cleaning ${targets.length} image(s) under ${path.relative(process.cwd(), root)}/`);
  for (const f of targets) {
    await cleanOne(f);
  }
  console.log('Done. Backups in public/errors/.original/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
