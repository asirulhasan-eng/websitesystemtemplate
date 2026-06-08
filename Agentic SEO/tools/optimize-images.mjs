#!/usr/bin/env node
/**
 * optimize-images.mjs — Site-wide image optimization tool
 *
 * Usage:  node tools/optimize-images.mjs [--dry-run] [--quality 82] [--skip-backup]
 *
 * What it does:
 *   1. Backs up every original image to archive/pre-optimization/ (preserving paths)
 *   2. Converts PNG / JPG / JPEG → WebP
 *   3. Strips ALL metadata (EXIF, IPTC, XMP, ICC) from every image
 *   4. Re-optimizes existing WebP files (metadata strip + re-encode)
 *   5. Updates every .html reference from old extension → .webp
 *   6. Removes the originals from the working tree (archive copy is kept)
 *   7. Prints a before / after summary
 */

import sharp from 'sharp';
import { readdir, stat, readFile, writeFile, mkdir, copyFile, unlink } from 'fs/promises';
import { join, extname, basename, relative } from 'path';
import { existsSync } from 'fs';

// ── Config ───────────────────────────────────────────────────────────────
const ROOT       = process.cwd();
const ASSETS_DIR = join(ROOT, 'assets');
const ARCHIVE    = join(ROOT, 'archive', 'pre-optimization');
const SKIP_DIRS  = new Set(['node_modules', '.git', 'archive', 'tools']);
const IMG_EXTS   = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const CONVERT_RE = /\.(png|jpe?g)$/i;

// CLI flags
const args       = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const SKIP_BKP   = args.includes('--skip-backup');
const qualIdx    = args.indexOf('--quality');
const QUALITY    = qualIdx !== -1 ? Number(args[qualIdx + 1]) : 82;

if (DRY_RUN) console.log('⚠️  DRY RUN — no files will be modified\n');

// ── Helpers ──────────────────────────────────────────────────────────────
const KB  = n => `${(n / 1024).toFixed(0)} KB`;
const MB  = n => `${(n / 1048576).toFixed(2)} MB`;
const pct = (before, after) => ((1 - after / before) * 100).toFixed(1);

/** Recursively collect files matching a predicate */
async function walk(dir, predicate) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...await walk(full, predicate));
    } else if (predicate(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Back up a file to archive/, mirroring its relative path */
async function backupFile(filePath) {
  if (SKIP_BKP) return;
  const rel  = relative(ROOT, filePath);
  const dest = join(ARCHIVE, rel);
  await mkdir(join(dest, '..'), { recursive: true });
  if (!DRY_RUN) await copyFile(filePath, dest);
  return dest;
}

/** Convert PNG/JPG → WebP, return stats */
async function convertToWebp(filePath) {
  const before  = (await stat(filePath)).size;
  const webpPath = filePath.replace(CONVERT_RE, '.webp');

  if (!DRY_RUN) {
    const buf = await sharp(await readFile(filePath))
      .withMetadata(false)
      .webp({ quality: QUALITY, effort: 6 })
      .toBuffer();
    await writeFile(webpPath, buf);
  }

  const after = DRY_RUN ? before : (await stat(webpPath)).size;
  return { before, after, webpPath, originalPath: filePath };
}

/** Re-encode a WebP in-place (strip metadata) */
async function optimizeWebp(filePath) {
  const before = (await stat(filePath)).size;

  if (!DRY_RUN) {
    const buf = await sharp(await readFile(filePath))
      .withMetadata(false)
      .webp({ quality: QUALITY, effort: 6 })
      .toBuffer();
    await writeFile(filePath, buf);
  }

  const after = DRY_RUN ? before : (await stat(filePath)).size;
  return { before, after };
}

/** Scan all HTML files and swap old image names for .webp equivalents */
async function updateHtmlReferences(conversions) {
  const htmlFiles = await walk(ROOT, f => extname(f).toLowerCase() === '.html');
  let totalUpdates = 0;

  for (const htmlFile of htmlFiles) {
    let content = await readFile(htmlFile, 'utf-8');
    let changed = false;

    for (const { originalPath, webpPath } of conversions) {
      const oldName = basename(originalPath);
      const newName = basename(webpPath);
      if (content.includes(oldName)) {
        content = content.replaceAll(oldName, newName);
        changed = true;
        totalUpdates++;
      }
    }

    if (changed && !DRY_RUN) {
      await writeFile(htmlFile, content, 'utf-8');
      console.log(`  📄 ${relative(ROOT, htmlFile)}`);
    }
  }
  return totalUpdates;
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔍  Scanning for images (quality=${QUALITY})...\n`);

  // Gather images from root + assets (skip archive, tools, node_modules, .git)
  const rootImgs  = (await readdir(ROOT))
    .filter(f => IMG_EXTS.has(extname(f).toLowerCase()))
    .map(f => join(ROOT, f));

  const assetImgs = existsSync(ASSETS_DIR)
    ? await walk(ASSETS_DIR, f => IMG_EXTS.has(extname(f).toLowerCase()))
    : [];

  const allImages = [...new Set([...rootImgs, ...assetImgs])];
  const toConvert = allImages.filter(f => CONVERT_RE.test(f));
  const toOptimize = allImages.filter(f => /\.webp$/i.test(f));

  console.log(`  Total images found : ${allImages.length}`);
  console.log(`  PNG/JPG to convert : ${toConvert.length}`);
  console.log(`  WebP to re-optimize: ${toOptimize.length}\n`);

  let totalBefore = 0, totalAfter = 0, backed = 0;
  const conversions = [];

  // ─── Step 1: Back up + Convert PNGs/JPGs ───────────────────────────────
  if (toConvert.length) {
    console.log(`📦  Converting ${toConvert.length} PNG/JPG → WebP...\n`);
    for (const file of toConvert) {
      try {
        await backupFile(file);
        backed++;
        const r = await convertToWebp(file);
        conversions.push(r);
        totalBefore += r.before;
        totalAfter  += r.after;
        console.log(`  ✅ ${basename(file)} → .webp  ${KB(r.before)} → ${KB(r.after)}  (−${pct(r.before, r.after)}%)`);
      } catch (e) {
        console.error(`  ❌ ${basename(file)}: ${e.message}`);
      }
    }
  }

  // ─── Step 2: Back up + Re-optimize existing WebPs ──────────────────────
  if (toOptimize.length) {
    console.log(`\n🧹  Stripping metadata from ${toOptimize.length} WebP files...\n`);
    for (const file of toOptimize) {
      try {
        await backupFile(file);
        backed++;
        const r = await optimizeWebp(file);
        totalBefore += r.before;
        totalAfter  += r.after;
        const delta = r.after <= r.before
          ? `−${pct(r.before, r.after)}%`
          : `+${((r.after / r.before - 1) * 100).toFixed(1)}%`;
        console.log(`  ✅ ${basename(file)}  ${KB(r.before)} → ${KB(r.after)}  (${delta})`);
      } catch (e) {
        console.error(`  ❌ ${basename(file)}: ${e.message}`);
      }
    }
  }

  // ─── Step 3: Update HTML refs ──────────────────────────────────────────
  let htmlUpdates = 0;
  if (conversions.length) {
    console.log(`\n📝  Updating HTML references...\n`);
    htmlUpdates = await updateHtmlReferences(conversions);

    // ─── Step 4: Remove original PNG/JPGs (archive copy preserved) ───────
    if (!DRY_RUN) {
      console.log(`\n🗑️   Removing ${conversions.length} originals (backed up in archive/)...\n`);
      for (const { originalPath } of conversions) {
        try {
          await unlink(originalPath);
          console.log(`  ✓ ${basename(originalPath)}`);
        } catch (e) {
          console.error(`  ❌ ${basename(originalPath)}: ${e.message}`);
        }
      }
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────────
  const saved = totalBefore - totalAfter;
  console.log(`
${'═'.repeat(60)}
📊  OPTIMIZATION SUMMARY${DRY_RUN ? '  (DRY RUN)' : ''}
${'═'.repeat(60)}
   Quality setting  : ${QUALITY}
   Images processed : ${allImages.length}
   PNG/JPG → WebP   : ${toConvert.length}
   WebPs optimized  : ${toOptimize.length}
   Files backed up  : ${backed}  →  archive/pre-optimization/
   HTML refs updated: ${htmlUpdates}
   ────────────────────────────────
   Before : ${MB(totalBefore)}
   After  : ${MB(totalAfter)}
   Saved  : ${MB(saved)}  (${totalBefore ? pct(totalBefore, totalAfter) : 0}%)
${'═'.repeat(60)}
`);
}

main().catch(err => { console.error('💥 Fatal:', err); process.exit(1); });
