#!/usr/bin/env node

function runPreflight() {
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.replace('v', '').split('.')[0], 10);
  const minor = parseInt(nodeVersion.split('.')[1], 10);

  if (major < 22 || (major === 22 && minor < 5)) {
    console.error(`[ERROR] Node.js version ${nodeVersion} is too old. Node.js 22.5.0+ is required.`);
    process.exit(1);
  }

  try {
    const sqlite = require('node:sqlite');
    if (!sqlite.DatabaseSync) {
      console.error('[ERROR] node:sqlite module found, but DatabaseSync is missing. Check your Node.js build.');
      process.exit(1);
    }
  } catch (err) {
    console.error('[ERROR] Failed to load node:sqlite. Ensure you are using a Node.js build with SQLite support.');
    console.error(err);
    process.exit(1);
  }

  console.log('[OK] Node.js preflight checks passed.');
}

if (require.main === module) {
  runPreflight();
}
