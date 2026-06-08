#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { parseArgs, boolArg, numberArg, resolveDbPath, getOutputFormat } = require("../lib/cli");
const { compactDateTime, nowIso } = require("../lib/dates");
const { ensureDir, writeJson } = require("../lib/io");
const { printOutput, errorEnvelope } = require("../lib/output");
const { openStateDb, makeId } = require("../lib/state_db");

const TOOL = "backup-create";

const HELP = `
backup-create - Create verified SQLite and artifact backups

USAGE
  v2 backup create --db <path> [options]

OPTIONS
  --db <path>             SQLite database path.
  --backup-root <path>    Backup directory root. Default: tools/out/backups.
  --include-tools-out     Copy tools/out into the backup.
  --obsidian-root <path>  Copy Obsidian vault into backup/obsidian.
  --raw-data-root <path>  Copy raw data into backup/raw-data. Default: tools/out.
  --no-raw-data           Do not copy raw-data-root.
  --keep-days <N>         Rotate backup directories older than N days. Default: 30.
  --sample                Return sample data without filesystem/DB writes.
  --json                  JSON output.
  --table                 Table output.
  --help                  Show help.
`.trim();

module.exports = function backupCreate() {
  const args = parseArgs();
  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    printOutput({
      ok: true,
      generated_at: nowIso(),
      tool: TOOL,
      backup_id: "BACKUP-2026-06-03-SAMPLE",
      backup_dir: "tools/out/backups/20260603T000000Z",
      manifest_path: "tools/out/backups/20260603T000000Z/backup-manifest.json",
      size_bytes: 4096,
      integrity: { ok: true, result: "ok" },
    }, getOutputFormat(args));
    return;
  }

  let db;
  try {
    const dbPath = path.resolve(process.cwd(), resolveDbPath(args));
    const backupRoot = path.resolve(process.cwd(), args["backup-root"] || "tools/out/backups");
    const timestamp = compactDateTime();
    const backupDir = path.join(backupRoot, timestamp);
    const backupId = args.id || makeId("BACKUP");
    const startedAt = nowIso();
    const keepDays = numberArg(args, "keep-days", 30);

    ensureDir(backupDir);
    db = openStateDb(dbPath);
    recordBackupStart(db, backupId, "state", dbPath, backupDir, startedAt, { include_tools_out: boolArg(args, "include-tools-out") });

    db.exec("PRAGMA wal_checkpoint(FULL)");
    const dbBackupPath = path.join(backupDir, path.basename(dbPath));
    fs.copyFileSync(dbPath, dbBackupPath);
    copyIfExists(`${dbPath}-wal`, `${dbBackupPath}-wal`);
    copyIfExists(`${dbPath}-shm`, `${dbBackupPath}-shm`);

    const integrity = verifyBackupIntegrity(dbBackupPath);
    const manifest = {
      backup_id: backupId,
      generated_at: nowIso(),
      db_source: dbPath,
      db_backup: dbBackupPath,
      integrity_check: integrity,
      copied_paths: [],
    };

    if (boolArg(args, "include-tools-out")) {
      const source = path.resolve(process.cwd(), "tools/out");
      const target = path.join(backupDir, "tools-out");
      // Exclude backupRoot too — it lives under tools/out, so copying tools/out
      // without it would recursively nest every prior backup inside this one.
      copyDir(source, target, [backupDir, backupRoot]);
      manifest.copied_paths.push({ source, backup: target });
    }

    if (args["obsidian-root"]) {
      const source = path.resolve(process.cwd(), args["obsidian-root"]);
      const target = path.join(backupDir, "obsidian");
      copyDir(source, target, [backupDir]);
      manifest.copied_paths.push({ source, backup: target, type: "obsidian_vault" });
      recordBackupCompleted(db, makeId("BACKUP"), "obsidian_vault", source, target, { source, backup: target });
    }

    if (!boolArg(args, "no-raw-data")) {
      const source = path.resolve(process.cwd(), args["raw-data-root"] || "tools/out");
      if (fs.existsSync(source)) {
        const target = path.join(backupDir, "raw-data");
        copyDir(source, target, [backupDir, backupRoot]);
        manifest.copied_paths.push({ source, backup: target, type: "raw_data" });
        recordBackupCompleted(db, makeId("BACKUP"), "raw_data", source, target, { source, backup: target });
      }
    }

    const manifestPath = path.join(backupDir, "backup-manifest.json");
    writeJson(manifestPath, manifest);
    const sizeBytes = dirSize(backupDir);
    const status = integrity.ok ? "completed" : "integrity_failed";
    recordBackupFinish(db, backupId, status, sizeBytes, manifest);
    const rotatedCount = keepDays > 0 ? rotateOldBackups(backupRoot, keepDays) : 0;

    printOutput({
      ok: integrity.ok,
      generated_at: nowIso(),
      tool: TOOL,
      backup_id: backupId,
      backup_dir: backupDir,
      manifest_path: manifestPath,
      size_bytes: sizeBytes,
      integrity,
      rotated_count: rotatedCount,
    }, getOutputFormat(args));
    if (!integrity.ok) process.exitCode = 1;
  } catch (error) {
    if (db) {
      try {
        recordBackupFailure(db, error.message);
      } catch {}
    }
    printOutput(errorEnvelope(error, { tool: TOOL }), "json");
    process.exitCode = 1;
  } finally {
    try { db?.close(); } catch {}
  }
};

function recordBackupStart(db, backupId, type, source, backupPath, startedAt, metadata) {
  db.prepare(`
    INSERT INTO backups (backup_id, backup_type, status, source_path, backup_path, started_at, metadata_json)
    VALUES (?, ?, 'running', ?, ?, ?, ?)
  `).run(backupId, type, source, backupPath, startedAt, JSON.stringify(metadata || {}));
}

function recordBackupCompleted(db, backupId, type, source, backupPath, metadata) {
  const now = nowIso();
  const sizeBytes = dirSize(backupPath);
  db.prepare(`
    INSERT INTO backups (backup_id, backup_type, status, source_path, backup_path, started_at, finished_at, size_bytes, metadata_json)
    VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, ?)
  `).run(backupId, type, source, backupPath, now, now, sizeBytes, JSON.stringify({ ...metadata, size_bytes: sizeBytes }));
}

function recordBackupFinish(db, backupId, status, sizeBytes, manifest) {
  const now = nowIso();
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.prepare(`
      UPDATE backups
      SET status = ?, finished_at = ?, size_bytes = ?, metadata_json = ?
      WHERE backup_id = ?
    `).run(status, now, sizeBytes, JSON.stringify(manifest), backupId);
    db.prepare(`
      INSERT INTO events (
        event_id, event_type, task_id, resource_type, resource_id,
        old_value, new_value, source, agent_name, created_at, metadata_json
      ) VALUES (?, 'backup_completed', NULL, 'backup', ?, 'running', ?, 'backup-create', 'Backup Agent', ?, ?)
    `).run(makeId("EVT"), backupId, status, now, JSON.stringify(manifest));
    db.prepare(`
      INSERT INTO outbox_jobs (outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at)
      VALUES (?, 'update_obsidian_backup_report', 'backup', ?, ?, 'pending', ?)
    `).run(makeId("OUT"), backupId, JSON.stringify(manifest), now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function recordBackupFailure(db, message) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO events (
      event_id, event_type, task_id, resource_type, resource_id,
      old_value, new_value, source, agent_name, created_at, metadata_json
    ) VALUES (?, 'backup_failed', NULL, 'backup', 'backup-create', 'running', 'failed', 'backup-create', 'Backup Agent', ?, ?)
  `).run(makeId("EVT"), now, JSON.stringify({ error: message }));
}

function verifyBackupIntegrity(dbBackupPath) {
  try {
    const checkDb = new DatabaseSync(dbBackupPath, { readOnly: true });
    try {
      const row = checkDb.prepare("PRAGMA integrity_check").get();
      const result = row ? Object.values(row)[0] : "unknown";
      return { ok: result === "ok", result };
    } finally {
      checkDb.close();
    }
  } catch (error) {
    return { ok: false, result: "error", error: error.message };
  }
}

function copyIfExists(source, target) {
  if (fs.existsSync(source)) fs.copyFileSync(source, target);
}

function copyDir(source, target, excludeRoots = []) {
  if (!fs.existsSync(source)) return;
  const resolvedSource = path.resolve(source);
  const resolvedTarget = path.resolve(target);
  const resolvedExcludes = (Array.isArray(excludeRoots) ? excludeRoots : [excludeRoots])
    .filter(Boolean)
    .map((item) => path.resolve(item));
  if (resolvedExcludes.some((exclude) => resolvedSource === exclude || resolvedSource.startsWith(`${exclude}${path.sep}`))) return;
  ensureDir(resolvedTarget);
  for (const entry of fs.readdirSync(resolvedSource, { withFileTypes: true })) {
    const childSource = path.join(resolvedSource, entry.name);
    const childTarget = path.join(resolvedTarget, entry.name);
    if (entry.isDirectory()) copyDir(childSource, childTarget, resolvedExcludes);
    else if (entry.isFile()) fs.copyFileSync(childSource, childTarget);
  }
}

function dirSize(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) total += dirSize(fullPath);
    else if (entry.isFile()) total += fs.statSync(fullPath).size;
  }
  return total;
}

function rotateOldBackups(backupRoot, keepDays) {
  if (!fs.existsSync(backupRoot)) return 0;
  const cutoff = Date.now() - keepDays * 86400000;
  let removed = 0;
  for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(backupRoot, entry.name);
    const stats = fs.statSync(dirPath);
    if (stats.mtimeMs < cutoff) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}

if (require.main === module) {
  module.exports();
}
