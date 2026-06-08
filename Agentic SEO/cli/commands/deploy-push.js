/**
 * deploy-push.js â€” Push a branch to a remote
 *
 * Usage:
 *   v2 deploy push --site-root /opt/site --branch agent/seo-update
 *   v2 deploy push --site-root . --force
 *   v2 deploy push --site-root /opt/site --remote origin --branch main
 *
 * Options:
 *   --site-root      Required. Path to the git repository root
 *   --branch         Branch to push (defaults to current branch)
 *   --remote         Remote name (default: origin)
 *   --force          Force push (--force-with-lease)
 *   --set-upstream   Set upstream tracking branch
 *   --db             If provided, update deployment record
 *   --deployment-id  Existing deployment_id to update
 *   --json           JSON output (default)
 *   --table          Table output
 *   --sample         Return sample data without git operations
 *   --help           Show this help text
 */

const path = require('node:path');
const { parseArgs, requireArg, boolArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { nowIso } = require('../lib/dates');

const TOOL = 'deploy-push';

const HELP = `
deploy-push â€” Push a branch to a remote

USAGE
  v2 deploy push --site-root <path> [options]

REQUIRED
  --site-root       Path to the git repository root

OPTIONS
  --branch          Branch to push (defaults to current branch)
  --remote          Remote name (default: origin)
  --force           Force push with --force-with-lease
  --set-upstream    Set upstream tracking branch
  --db              If provided, updates deployment record in SQLite
  --deployment-id   Existing deployment_id to update after push
  --json            JSON output (default)
  --table           Table output
  --sample          Return sample data without git operations
  --help            Show this help text

EXAMPLES
  v2 deploy push --site-root /opt/client-site --branch agent/seo-update
  v2 deploy push --site-root . --force --set-upstream
  v2 deploy push --site-root /opt/site --remote upstream --branch main

BEHAVIOR
  1. Resolves the current branch if --branch is not provided
  2. Pushes to the specified remote (default: origin)
  3. Retries up to 3 times on transient failures
  4. Optionally updates a deployment record in the SQLite database
`.trim();

module.exports = function deployPush() {
  const args = parseArgs();

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    printOutput(envelope({
      branch: 'agent/seo-update',
      remote: 'origin',
      commit_sha: 'a1b2c3d',
      pushed: true,
      force: false,
      message: 'Branch pushed successfully',
    }, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    const { isGitRepo, currentBranch, shortHead, push } = require('../lib/git');

    const siteRoot = path.resolve(requireArg(args, 'site-root', 'Missing --site-root (git repository path)'));
    const remote = args.remote || 'origin';
    const forceFlag = boolArg(args, 'force');
    const setUpstream = boolArg(args, 'set-upstream', true);

    if (!isGitRepo(siteRoot)) {
      printOutput(errorEnvelope(`Not a git repository: ${siteRoot}`, { tool: TOOL }), 'json');
      process.exitCode = 1;
      return;
    }

    const branch = args.branch || currentBranch(siteRoot);
    if (!branch) {
      printOutput(errorEnvelope('Could not determine current branch. Specify --branch explicitly.', { tool: TOOL }), 'json');
      process.exitCode = 1;
      return;
    }

    // Handle force push
    if (forceFlag) {
      const { git } = require('../lib/git');
      const pushArgs = ['push', '--force-with-lease'];
      if (setUpstream) pushArgs.push('--set-upstream');
      pushArgs.push(remote, branch);
      git(siteRoot, pushArgs);
    } else {
      push(siteRoot, remote, branch, setUpstream);
    }

    const commitSha = shortHead(siteRoot);

    // Optionally update deployment in DB
    if (args.db) {
      const { openStateDb, makeId } = require('../lib/state_db');
      const db = openStateDb(resolveDbPath(args));
      const now = nowIso();
      const deploymentId = args['deployment-id'];

      try {
        if (deploymentId) {
          db.prepare(`
            UPDATE deployments SET status = ?, metadata_json = json_set(
              COALESCE(metadata_json, '{}'), '$.pushed_at', ?, '$.remote', ?, '$.force', ?
            ) WHERE deployment_id = ?
          `).run('pushed', now, remote, forceFlag ? 'true' : 'false', deploymentId);
        } else {
          const newId = makeId('DEP');
          db.prepare(`
            INSERT INTO deployments (
              deployment_id, branch_name, commit_sha, deployment_type,
              status, started_at, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            newId, branch, commitSha, 'push',
            'pushed', now,
            JSON.stringify({ remote, force: forceFlag })
          );
        }
      } finally {
        db.close();
      }
    }

    printOutput(envelope({
      branch,
      remote,
      commit_sha: commitSha,
      pushed: true,
      force: forceFlag,
      message: `Branch "${branch}" pushed to ${remote} successfully`,
    }, { tool: TOOL }), getOutputFormat(args));

  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}