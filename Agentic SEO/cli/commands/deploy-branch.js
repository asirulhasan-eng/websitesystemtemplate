/**
 * deploy-branch.js â€” Create a git branch, stage files, and commit
 *
 * Usage:
 *   v2 deploy branch --site-root /opt/site --branch agent/seo-update --message "Update meta tags"
 *   v2 deploy branch --site-root . --branch agent/fix-title --message "Fix H1" --files index.html,about.html
 *
 * Options:
 *   --site-root      Required. Path to the git repository root
 *   --branch         Required. Branch name to create/checkout
 *   --message        Required. Commit message
 *   --files          Comma-separated files to stage (default: all changed files)
 *   --force-recreate Reset an existing branch to HEAD before committing
 *   --git-user-name  Git author name (default: {{SITE_NAME}} Agent)
 *   --git-user-email Git author email (default: agent@{{DOMAIN}})
 *   --db             If provided, record deployment in deployments table
 *   --task           Associated task_id for deployment record
 *   --json           JSON output (default)
 *   --table          Table output
 *   --sample         Return sample data without git operations
 *   --help           Show this help text
 */

const path = require('node:path');
const { parseArgs, requireArg, listArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { nowIso } = require('../lib/dates');

const TOOL = 'deploy-branch';

const HELP = `
deploy-branch â€” Create a git branch, stage files, and commit

USAGE
  v2 deploy branch --site-root <path> --branch <name> --message <msg> [options]

REQUIRED
  --site-root       Path to the git repository root
  --branch          Branch name to create or checkout (e.g., agent/seo-update)
  --message         Commit message

OPTIONS
  --files           Comma-separated list of files to stage (default: all changed files)
  --force-recreate  Reset an existing branch to HEAD before committing
  --git-user-name   Git author name (default: {{SITE_NAME}} Agent)
  --git-user-email  Git author email (default: agent@{{DOMAIN}})
  --db              If provided, records deployment entry in SQLite
  --task            Associated task_id for deployment tracking
  --json            JSON output (default)
  --table           Table output
  --sample          Return sample data without git operations
  --help            Show this help text

EXAMPLES
  v2 deploy branch --site-root /opt/client-site --branch agent/update-meta --message "Update meta descriptions"
  v2 deploy branch --site-root . --branch agent/fix-h1 --message "Fix H1 tags" --files index.html,about.html
  v2 deploy branch --site-root /opt/site --branch agent/seo-001 --message "SEO improvements" --db state.db --task TSK-123

BEHAVIOR
  1. Validates the path is a git repository
  2. Creates or checks out the specified branch
  3. Stages specified files (or all changed files)
  4. Commits with the given message and author info
  5. Returns branch name, commit SHA, and list of staged files
`.trim();

module.exports = function deployBranch() {
  const args = parseArgs();

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    printOutput(envelope({
      branch: 'agent/seo-update',
      commit_sha: 'a1b2c3d',
      message: 'Update meta tags for {{NICHE}} pages',
      files_staged: ['services/{{NICHE}}.html', 'services/drain-cleaning.html'],
      author: '{{SITE_NAME}} Agent <agent@{{DOMAIN}}>',
      site_root: '/opt/client-site',
    }, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    const { isGitRepo, checkoutNewBranch, add, commit, shortHead, statusPorcelain } = require('../lib/git');

    const siteRoot = path.resolve(requireArg(args, 'site-root', 'Missing --site-root (git repository path)'));
    const branch = requireArg(args, 'branch', 'Missing --branch (branch name)');
    const message = requireArg(args, 'message', 'Missing --message (commit message)');
    const files = listArg(args, 'files');
    const gitUserName = args['git-user-name'] || '{{SITE_NAME}} Agent';
    const gitUserEmail = args['git-user-email'] || 'agent@{{DOMAIN}}';

    // Validate git repo
    if (!isGitRepo(siteRoot)) {
      printOutput(errorEnvelope(`Not a git repository: ${siteRoot}`, { tool: TOOL }), 'json');
      process.exitCode = 1;
      return;
    }

    // Create/checkout branch
    checkoutNewBranch(siteRoot, branch, { forceRecreate: Boolean(args['force-recreate']) });

    // Stage files
    const filesToStage = files.length > 0 ? files : ['.'];
    add(siteRoot, filesToStage);

    // Check if there's anything to commit
    const status = statusPorcelain(siteRoot);
    if (!status) {
      printOutput(envelope({
        branch,
        commit_sha: shortHead(siteRoot),
        message,
        files_staged: [],
        warning: 'Nothing to commit â€” working tree clean',
        site_root: siteRoot,
      }, { tool: TOOL }), getOutputFormat(args));
      return;
    }

    // Commit
    commit(siteRoot, message, { name: gitUserName, email: gitUserEmail });
    const commitSha = shortHead(siteRoot);

    // Parse staged files from status
    const stagedFiles = status.split('\n').filter(Boolean).map(l => l.trim().replace(/^[A-Z?! ]+\s+/, ''));

    // Optionally record in DB
    let deploymentId = null;
    if (args.db) {
      const { openStateDb, makeId } = require('../lib/state_db');
      const db = openStateDb(resolveDbPath(args));
      const now = nowIso();
      deploymentId = makeId('DEP');

      try {
        db.prepare(`
          INSERT INTO deployments (
            deployment_id, task_id, branch_name, commit_sha, deployment_type,
            status, started_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          deploymentId, args.task || null, branch, commitSha, 'branch_commit',
          'committed', now,
          JSON.stringify({ files_staged: stagedFiles, author: `${gitUserName} <${gitUserEmail}>` })
        );
      } finally {
        db.close();
      }
    }

    printOutput(envelope({
      branch,
      commit_sha: commitSha,
      message,
      files_staged: stagedFiles,
      author: `${gitUserName} <${gitUserEmail}>`,
      site_root: siteRoot,
      deployment_id: deploymentId,
    }, { tool: TOOL }), getOutputFormat(args));

  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}
