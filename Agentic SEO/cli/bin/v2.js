#!/usr/bin/env node
/**
 * v2.js â€” Unified CLI entry point for {{SITE_NAME}} v2
 *
 * Routes subcommands to their handler modules. Every command outputs
 * structured JSON by default so the AI brain can parse results.
 *
 * Usage:
 *   v2 <command> [subcommand] [options]
 *
 * Examples:
 *   v2 gsc-fetch --days 7 --json
 *   v2 task create --title "..." --priority 800
 *   v2 db snapshot --json
 *   v2 serp-check --keywords "{{NICHE}} seo" --json
 */

const path = require('node:path');
const fs = require('node:fs');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

// Command aliases for convenience
const ALIASES = {
  'gsc':        'gsc-fetch',
  'serp':       'serp-check',
  'crawl-site': 'crawl',
  'tasks':      'task-list',
  'keywords':   'keyword-list',
  'snapshot':   'db-snapshot',
  'health':     'monitor-check',
  'locks':      'lock-list',
  'pagespeed':  'speed-audit',
  'cwv':        'speed-audit',
  'cwv-check':  'speed-audit',
  // Execution-lane aliases â€” the AI invokes a pipeline directly per task it
  // decides to run (pure AI-brain; there is no autonomous queue auto-picker).
  'safe-fix':   'task-execute-safe',
  'semi-safe':  'task-execute-semi',
  'high-risk':  'task-execute-high',
};

// Compound commands: "v2 task create" â†’ "task-create"
const COMPOUND_PREFIXES = new Set([
  'task', 'db', 'lock', 'deploy', 'email',
  'gsc', 'serp', 'keyword', 'report', 'site',
  'outbox', 'semantic', 'sitemap', 'index', 'link',
  'manual', 'security', 'backup', 'brain', 'intelligence',
  'content', 'campaign', 'news', 'social',
]);

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    return;
  }

  if (args[0] === '--version' || args[0] === '-v') {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    console.log(pkg.version);
    return;
  }

  if (args[0] === '--list-commands') {
    listCommands();
    return;
  }

  // Resolve command name
  let commandName = args[0];
  let commandArgs = args.slice(1);

  // Handle compound commands: "v2 task create" â†’ "task-create"
  if (COMPOUND_PREFIXES.has(commandName) && commandArgs.length > 0 && !commandArgs[0].startsWith('-')) {
    const compound = `${commandName}-${commandArgs[0]}`;
    const compoundPath = path.join(COMMANDS_DIR, `${compound}.js`);
    if (fs.existsSync(compoundPath)) {
      commandName = compound;
      commandArgs = commandArgs.slice(1);
    }
  }

  // Apply aliases
  if (ALIASES[commandName]) {
    commandName = ALIASES[commandName];
  }

  // Load and execute command
  const commandPath = path.join(COMMANDS_DIR, `${commandName}.js`);
  if (!fs.existsSync(commandPath)) {
    console.error(`Error: Unknown command "${commandName}"`);
    console.error(`Run "v2 --list-commands" to see available commands.`);
    process.exitCode = 1;
    return;
  }

  // Inject remaining args back into process.argv for the command's arg parser
  process.argv = [process.argv[0], commandPath, ...commandArgs];

  try {
    const command = require(commandPath);
    if (typeof command === 'function') {
      const result = command();
      if (result && typeof result.catch === 'function') {
        result.catch((err) => {
          console.error(JSON.stringify({ error: err.message, stack: err.stack }));
          process.exitCode = 1;
        });
      }
    }
  } catch (err) {
    console.error(JSON.stringify({ error: err.message, stack: err.stack }));
    process.exitCode = 1;
  }
}

function listCommands() {
  if (!fs.existsSync(COMMANDS_DIR)) {
    console.log('No commands directory found.');
    return;
  }
  const files = fs.readdirSync(COMMANDS_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => f.replace('.js', ''))
    .sort();

  const groups = {};
  for (const cmd of files) {
    const prefix = cmd.split('-')[0];
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(cmd);
  }

  console.log('Available commands:\n');
  for (const [group, cmds] of Object.entries(groups)) {
    console.log(`  ${group}:`);
    for (const cmd of cmds) {
      console.log(`    v2 ${cmd.replace('-', ' ')}`);
    }
    console.log();
  }

  if (Object.keys(ALIASES).length > 0) {
    console.log('Aliases:');
    for (const [alias, target] of Object.entries(ALIASES)) {
      console.log(`  v2 ${alias}  â†’  v2 ${target}`);
    }
  }
}

function printUsage() {
  console.log(`
{{SITE_NAME}} v2 CLI â€” AI-Brain Data Tools

Usage:
  v2 <command> [subcommand] [options]

Data Fetching:
  v2 gsc-fetch              Fetch GSC data from API
  v2 gsc-history             Query historical GSC snapshots
  v2 gsc-compare             Compare two GSC periods
  v2 serp-check              Check live SERP positions
  v2 serp-history            Query historical SERP data
  v2 serp-compare            Compare SERP positions over time
  v2 crawl                   Run technical site audit
  v2 crawl-diff              Compare two crawl runs
  v2 speed-audit             Run PageSpeed Insights / Core Web Vitals audit

Site Content:
  v2 page-read               Read page HTML content
  v2 page-meta               Extract page metadata
  v2 site-pages              List all pages with metadata
  v2 site-links              Analyze internal link structure
  v2 semantic-match          Score topical relevance between two pages
  v2 link-check              Find links to a target URL or broken internal links
  v2 sitemap-audit           Validate sitemap XML and listed URLs
  v2 index-inspect           Inspect URL index status via GSC

Task Management:
  v2 task create             Create task in SQLite
  v2 task list               List/query/filter tasks
  v2 task update             Update task status/priority
  v2 task search             Full-text search across tasks
  v2 task stats              Task queue analytics
  v2 task audit              Audit task lanes, queues, and duplicates
  v2 task next               Pick next ready task in a lane (pipeline worker)
  v2 task dedupe             Cancel duplicate active tasks

Keyword Intelligence:
  v2 keyword track           Add/update tracked keywords
  v2 keyword list            List tracked keywords
  v2 keyword trend           Show keyword position trends

Database:
  v2 db query                Run SQL query, return JSON
  v2 db snapshot             Full system state summary
  v2 db tables               List tables & schema info

Infrastructure:
  v2 lock acquire            Acquire resource lock
  v2 lock release            Release lock by ID
  v2 lock list               List active/stale locks
  v2 deploy branch           Create branch + commit
  v2 deploy push             Push branch to remote
  v2 deploy status           Check deployment status
  v2 deploy wait             Wait for deployment
  v2 email send              Send email notification
  v2 email check             Check inbox for replies
  v2 heartbeat               Manage heartbeats
  v2 monitor-check           Run system health checks
  v2 manual-actions-check    Normalize GSC manual-action checks
  v2 security-issues-check   Normalize GSC security-issue checks
  v2 backup create           Create verified state/artifact backup
  v2 backup push             Commit/push backup repositories
  v2 brain init              Scaffold the Brain (memory folders + seed notes)
  v2 brain compile           Compile Obsidian Agent Brain
  v2 brain summary           Read compact Brain summary
  v2 brain health            Check Brain readiness
  v2 brain recall            Recall memory (decisions/lessons/observations)
  v2 brain note add          Record a memory note (decision|lesson|observation)

Intelligence Pipeline:
  v2 intelligence report     Save a module's analysis report (SQLite + md + brain)
  v2 intelligence latest     Latest report per module (planner input)
  v2 intelligence search     Search historical reports
  v2 intelligence summary    Aggregated summary for the daily planner

Social Distribution:
  v2 social post             Queue a blog's infographics (spec or simple mode)
  v2 social send             Drain the pipeline (cron ~90±11 min, batch drip)
  v2 social status           Inspect the social pipeline queue

Reporting:
  v2 report daily            Generate daily report
  v2 report weekly           Generate weekly report
  v2 report format           Format data into report

Global Options:
  --json                   JSON output (default for most commands)
  --table                  Human-readable table output
  --csv                    CSV output
  --db <path>              SQLite DB path override
  --quiet                  Suppress non-data output
  --help                   Show command help
  --version                Show version
  --list-commands          List all available commands
`);
}

main();
