const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStateDb, updateTaskStatusAtomic } = require('../cli/lib/state_db');
const { checkoutNewBranch, currentBranch } = require('../cli/lib/git');
const { resolveSitePath } = require('../cli/lib/site_paths');
const { previewHostnameForBranch } = require('../cli/lib/preview_urls');
const { renderJob } = require('../cli/commands/outbox-obsidian');
const {
  evaluateRankingDeltas,
  planRankingFollowup,
  createFollowupTask,
  MAX_FOLLOWUP_DEPTH,
} = require('../cli/lib/followups');

const CLI = path.resolve(__dirname, '../cli/bin/v2.js');

function runCli(args, options = {}) {
  return spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    ...options,
  });
}

function parseSingleJson(stdout) {
  const text = stdout.trim();
  assert.ok(text, 'stdout should not be empty');
  return JSON.parse(text);
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function makeGitRepo(prefix = 'client-git-') {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  runGit(repo, ['init']);
  if (runGit(repo, ['branch', '--show-current']) !== 'main') {
    runGit(repo, ['checkout', '-b', 'main']);
  }
  runGit(repo, ['config', 'user.name', 'Test User']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'initial\n');
  runGit(repo, ['add', 'README.md']);
  runGit(repo, ['commit', '-m', 'initial']);
  return repo;
}

function makeBrainVault(prefix = 'client-brain-') {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const brainDir = path.join(vault, '01-Agent-Brain');
  fs.mkdirSync(brainDir, { recursive: true });

  fs.writeFileSync(path.join(brainDir, 'no-go.md'), `---
type: brain
status: active
brain_domain: no_go
blocked_terms:
  - term: never-match-contract-test
    match_type: substring
    severity: block
    reason: Test fixture
---
# No-go
`);
  fs.writeFileSync(path.join(brainDir, 'operating-rules.md'), `---
type: brain
status: active
brain_domain: operating_rules
---
# Operating Rules
`);
  fs.writeFileSync(path.join(brainDir, 'task-generation.md'), `---
type: brain
status: active
brain_domain: task_generation
---
# Task Generation
`);
  fs.writeFileSync(path.join(brainDir, 'risk-lanes.md'), `---
type: brain
status: active
brain_domain: risk_lanes
---
# Risk Lanes
`);

  return vault;
}

test('sample commands emit exactly one JSON envelope', () => {
  for (const args of [
    ['report', 'daily', '--sample', '--json'],
    ['lock', 'list', '--sample', '--json'],
    ['speed-audit', '--sample', '--no-write', '--json'],
    ['deploy', 'status', '--sample', '--json'],
    ['deploy', 'wait', '--sample', '--json'],
    ['backup', 'create', '--sample', '--json'],
    ['backup', 'push', '--sample', '--json'],
    ['brain', 'health', '--sample', '--json'],
    ['task', 'audit', '--sample', '--json'],
    ['task', 'dedupe', '--sample', '--json'],
    ['content', 'blog-cannibalization', '--sample', '--json'],
  ]) {
    const result = runCli(args);
    assert.strictEqual(result.status, 0, `${args.join(' ')} should exit cleanly: ${result.stderr}`);
    const parsed = parseSingleJson(result.stdout);
    assert.strictEqual(parsed.ok, true);
  }
});

test('content blog-cannibalization checks existing blog inventory before a new support post', () => {
  const siteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'client-cannibal-site-'));
  fs.mkdirSync(path.join(siteRoot, 'blog', 'local-seo-checklist-for-{{AUDIENCE}}'), { recursive: true });
  fs.mkdirSync(path.join(siteRoot, 'blog', 'website-speed-for-{{AUDIENCE}}'), { recursive: true });

  fs.writeFileSync(path.join(siteRoot, 'index.html'), `
    <!doctype html><html><head>
      <title>{{NICHE}} SEO Agency</title>
      <meta name="description" content="SEO for {{AUDIENCE}} and {{NICHE}} companies">
    </head><body>
      <h1>SEO for {{AUDIENCE}}</h1>
      <p>{{NICHE}} SEO, {{AUDIENCE}} SEO, and {{NICHE}} SEO agency support.</p>
    </body></html>
  `);
  fs.writeFileSync(path.join(siteRoot, 'blog', 'local-seo-checklist-for-{{AUDIENCE}}', 'index.html'), `
    <!doctype html><html><head>
      <title>Local SEO Checklist for {{AUDIENCE}}</title>
      <meta name="description" content="A practical local SEO checklist for {{NICHE}} companies.">
    </head><body>
      <h1>Local SEO Checklist for {{AUDIENCE}}</h1>
      <h2>Google Business Profile</h2>
      <p>Local SEO for {{AUDIENCE}} depends on Google Maps, reviews, service area pages, local citations, and internal links.</p>
    </body></html>
  `);
  fs.writeFileSync(path.join(siteRoot, 'blog', 'website-speed-for-{{AUDIENCE}}', 'index.html'), `
    <!doctype html><html><head>
      <title>Website Speed for {{AUDIENCE}}</title>
      <meta name="description" content="Improve {{NICHE}} website speed.">
    </head><body>
      <h1>Website Speed for {{AUDIENCE}}</h1>
      <p>Fast pages help {{NICHE}} companies convert more visitors into booked calls.</p>
    </body></html>
  `);

  const blocked = runCli([
    'content', 'blog-cannibalization',
    '--site-root', siteRoot,
    '--topic', 'Local SEO checklist for {{AUDIENCE}}',
    '--target-keyword', 'local SEO for {{AUDIENCE}}',
    '--support-url', '/',
    '--json',
  ]);
  assert.strictEqual(blocked.status, 0, blocked.stderr || blocked.stdout);
  const blockedJson = parseSingleJson(blocked.stdout);
  assert.strictEqual(blockedJson.recommendation, 'refresh_existing_blog');
  assert.strictEqual(blockedJson.risk, 'high');
  assert.strictEqual(blockedJson.support_page.url, 'https://{{DOMAIN}}');
  assert.match(blockedJson.matches[0].url, /local-seo-checklist-for-{{AUDIENCE}}/);

  const clear = runCli([
    'content', 'blog-cannibalization',
    '--site-root', siteRoot,
    '--topic', 'CRM pipeline automation for {{NICHE}} sales teams',
    '--target-keyword', '{{NICHE}} CRM pipeline automation',
    '--support-url', '/',
    '--json',
  ]);
  assert.strictEqual(clear.status, 0, clear.stderr || clear.stdout);
  const clearJson = parseSingleJson(clear.stdout);
  assert.strictEqual(clearJson.recommendation, 'create_new_blog');
  assert.strictEqual(clearJson.risk, 'low');
});

test('task create/update accept canonical expanded statuses', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-status-'));
  const dbPath = path.join(tempDir, 'seo-agent.db');

  const create = runCli([
    'task', 'create',
    '--title', 'Needs review smoke',
    '--type', 'meta_fix',
    '--status', 'needs_review',
    '--db', dbPath,
    '--json',
  ]);
  assert.strictEqual(create.status, 0, create.stderr || create.stdout);
  const created = parseSingleJson(create.stdout);
  assert.strictEqual(created.task.status, 'needs_review');

  const update = runCli([
    'task', 'update',
    '--id', created.task.task_id,
    '--status', 'preview_ready',
    '--db', dbPath,
    '--json',
  ]);
  assert.strictEqual(update.status, 0, update.stderr || update.stdout);
  const updated = parseSingleJson(update.stdout);
  assert.strictEqual(updated.results[0].status, 'preview_ready');
});

test('task create requires blog cannibalization evidence for new_blog_post tasks', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-blog-evidence-'));
  const dbPath = path.join(tempDir, 'seo-agent.db');

  const missing = runCli([
    'task', 'create',
    '--title', 'Create blog: Local SEO checklist for {{AUDIENCE}}',
    '--type', 'new_blog_post',
    '--db', dbPath,
    '--json',
  ]);
  assert.notStrictEqual(missing.status, 0);
  const missingJson = parseSingleJson(missing.stdout);
  assert.match(missingJson.error, /blog_cannibalization_check/);

  const created = runCli([
    'task', 'create',
    '--title', 'Create blog: CRM pipeline automation for {{NICHE}} sales teams',
    '--type', 'new_blog_post',
    '--evidence', '{"blog_cannibalization_check":{"recommendation":"create_new_blog","top_match_url":null,"top_match_score":0.04,"support_url":"https://{{DOMAIN}}/"}}',
    '--db', dbPath,
    '--json',
  ]);
  assert.strictEqual(created.status, 0, created.stderr || created.stdout);
  const createdJson = parseSingleJson(created.stdout);
  const metadata = JSON.parse(createdJson.task.metadata_json);
  assert.strictEqual(metadata.evidence.blog_cannibalization_check.recommendation, 'create_new_blog');
});

test('task creation routes explicit-approval task types through guardrails', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-guardrails-'));
  const dbPath = path.join(tempDir, 'seo-agent.db');

  const create = runCli([
    'task', 'create',
    '--title', 'Delete obsolete page',
    '--type', 'delete_page',
    '--status', 'candidate',
    '--db', dbPath,
    '--json',
  ]);
  assert.strictEqual(create.status, 0, create.stderr || create.stdout);
  const created = parseSingleJson(create.stdout);
  assert.strictEqual(created.task.status, 'waiting_for_approval');
  assert.strictEqual(created.task.risk_level, 'high_risk');
  assert.strictEqual(created.task.approval_required, 1);
  assert.ok(created.approval_id);
  assert.ok(created.approval_token);
});

test('task update requires approval proof before manually approving explicit-approval tasks', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-approval-update-'));
  const dbPath = path.join(tempDir, 'seo-agent.db');

  const create = runCli([
    'task', 'create',
    '--title', 'Delete obsolete page',
    '--type', 'delete_page',
    '--status', 'candidate',
    '--db', dbPath,
    '--json',
  ]);
  assert.strictEqual(create.status, 0, create.stderr || create.stdout);
  const created = parseSingleJson(create.stdout);

  const blocked = runCli([
    'task', 'update',
    '--id', created.task.task_id,
    '--status', 'approved',
    '--db', dbPath,
    '--json',
  ]);
  assert.notStrictEqual(blocked.status, 0);
  const blockedOutput = parseSingleJson(blocked.stdout);
  assert.match(blockedOutput.error, /requires an approved approval row or a valid --token/);

  let db = openStateDb(dbPath);
  assert.strictEqual(db.prepare('SELECT status FROM tasks WHERE task_id = ?').get(created.task.task_id).status, 'waiting_for_approval');
  assert.strictEqual(db.prepare('SELECT status FROM approvals WHERE task_id = ?').get(created.task.task_id).status, 'waiting_for_approval');
  db.close();

  const approved = runCli([
    'task', 'update',
    '--id', created.task.task_id,
    '--status', 'approved',
    '--token', created.approval_token,
    '--db', dbPath,
    '--json',
  ]);
  assert.strictEqual(approved.status, 0, approved.stderr || approved.stdout);

  db = openStateDb(dbPath);
  assert.strictEqual(db.prepare('SELECT status FROM tasks WHERE task_id = ?').get(created.task.task_id).status, 'approved');
  assert.strictEqual(db.prepare('SELECT status FROM approvals WHERE task_id = ?').get(created.task.task_id).status, 'approved');
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM events WHERE event_type = 'approval_approved'").get().c, 1);
  db.close();
});

test('updateTaskStatusAtomic rejects missing task IDs without ghost side effects', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-atomic-status-'));
  const dbPath = path.join(tempDir, 'seo-agent.db');
  const db = openStateDb(dbPath);

  assert.throws(
    () => updateTaskStatusAtomic(db, 'TSK-MISSING', 'completed'),
    /Task not found: TSK-MISSING/,
  );
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM events').get().c, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM outbox_jobs').get().c, 0);
  db.close();
});

test('site path and preview helpers reject unsafe paths and slug branch hostnames', () => {
  const siteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'client-site-path-'));
  fs.mkdirSync(path.join(siteRoot, 'services'), { recursive: true });
  const inside = path.join(siteRoot, 'services', '{{NICHE}}-seo.html');
  const outside = path.join(os.tmpdir(), `outside-${Date.now()}.html`);

  assert.strictEqual(resolveSitePath(siteRoot, '/services/{{NICHE}}-seo.html'), inside);
  assert.strictEqual(resolveSitePath(siteRoot, inside), inside);
  assert.throws(() => resolveSitePath(siteRoot, '../outside.html'), /outside siteRoot/);
  assert.throws(() => resolveSitePath(siteRoot, outside), /outside siteRoot/);
  assert.strictEqual(previewHostnameForBranch('agent/TSK-123_Title Fix'), 'agent-tsk-123-title-fix');
});

test('checkoutNewBranch preserves existing agent branch tips unless forced', () => {
  const repo = makeGitRepo('client-branch-');
  runGit(repo, ['checkout', '-b', 'agent/existing']);
  fs.writeFileSync(path.join(repo, 'agent.txt'), 'agent branch\n');
  runGit(repo, ['add', 'agent.txt']);
  runGit(repo, ['commit', '-m', 'agent work']);
  const branchTip = runGit(repo, ['rev-parse', '--short', 'HEAD']);

  runGit(repo, ['checkout', 'main']);
  checkoutNewBranch(repo, 'agent/existing');

  assert.strictEqual(currentBranch(repo), 'agent/existing');
  assert.strictEqual(runGit(repo, ['rev-parse', '--short', 'HEAD']), branchTip);
});

test('deploy-pr --no-draft plans a ready pull request', () => {
  const repo = makeGitRepo('client-pr-');
  const outPath = path.join(repo, 'pr.json');

  const result = runCli([
    'deploy', 'pr',
    '--site-root', repo,
    '--repo', 'owner/example',
    '--head', 'agent/test-preview',
    '--no-draft',
    '--out', outPath,
    '--json',
  ]);
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const parsed = parseSingleJson(result.stdout);
  assert.strictEqual(parsed.payload.draft, false);
});

test('semi-safe and high-risk execution require --apply confirmation before edit commits', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-apply-contract-'));
  const dbPath = path.join(tempDir, 'seo-agent.db');
  const brainVault = makeBrainVault();
  const db = openStateDb(dbPath);
  const now = '2026-06-03T00:00:00.000Z';
  const insert = db.prepare(`
    INSERT INTO tasks (
      task_id, title, description, status, risk_level, priority_score, source,
      target_url, target_file, target_keyword, approval_required, created_at,
      updated_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `);
  insert.run(
    'TSK-SEMI-APPLY',
    'Refresh service page copy',
    'Semi-safe edit fixture',
    'candidate',
    'semi_safe',
    100,
    'test',
    null,
    'services/{{NICHE}}-seo.html',
    null,
    now,
    now,
    JSON.stringify({ task_type: 'content_refresh' }),
  );
  insert.run(
    'TSK-HIGH-APPLY',
    'Approved redirect update',
    'High-risk Phase 2 fixture',
    'approved',
    'high_risk',
    100,
    'test',
    null,
    'redirects.json',
    null,
    now,
    now,
    JSON.stringify({ task_type: 'redirect_setup' }),
  );
  db.close();

  const semi = runCli(['semi-safe', '--task', 'TSK-SEMI-APPLY', '--db', dbPath, '--brain-vault', brainVault, '--json']);
  assert.notStrictEqual(semi.status, 0);
  assert.match(semi.stderr, /--apply --commit/);
  assert.match(semi.stderr, /Pass --apply to confirm/);

  const high = runCli(['high-risk', '--task', 'TSK-HIGH-APPLY', '--db', dbPath, '--brain-vault', brainVault, '--json']);
  assert.notStrictEqual(high.status, 0);
  assert.match(high.stderr, /--apply --commit/);
  assert.match(high.stderr, /Pass --apply to confirm/);

  const highHelp = runCli(['high-risk', '--help']);
  assert.strictEqual(highHelp.status, 0, highHelp.stderr || highHelp.stdout);
  assert.match(highHelp.stdout, /--apply --push --validate --create-pr/);
  assert.match(highHelp.stdout, /Required for Phase 2/);
});

test('outbox page notes query GSC and SERP using actual schema columns', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-outbox-'));
  const dbPath = path.join(tempDir, 'seo-agent.db');
  const obsidianRoot = path.join(tempDir, 'vault');
  const db = openStateDb(dbPath);
  const pageUrl = 'https://{{DOMAIN}}/services/{{NICHE}}-seo';
  const pageId = 'PG-TEST-PAGE';

  db.prepare(`
    INSERT INTO pages (page_id, url, file_path, title, status, last_crawled_at, created_at, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(pageId, pageUrl, 'services/{{NICHE}}-seo.html', '{{NICHE}} SEO', 'live', '2026-06-03T00:00:00.000Z', '2026-06-03T00:00:00.000Z', '{}');
  db.prepare(`
    INSERT INTO gsc_snapshots (
      snapshot_id, query, page, clicks, impressions, ctr, position,
      date_range_start, date_range_end, captured_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('GSC-TEST', '{{NICHE}} seo', pageUrl, 7, 70, 0.1, 4.5, '2026-06-01', '2026-06-03', '2026-06-03T01:00:00.000Z', '{}');
  db.prepare(`
    INSERT INTO serp_checks (
      serp_check_id, keyword, provider, position, url, domain,
      snapshot_json, checked_at, created_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('SERP-TEST', '{{NICHE}} seo', 'sample', 3, pageUrl, '{{DOMAIN}}', '{}', '2026-06-03T02:00:00.000Z', '2026-06-03T02:00:00.000Z', '{}');

  const rendered = renderJob(db, {
    job_type: 'update_obsidian_page_note',
    entity_id: pageId,
    outbox_id: 'OUT-TEST',
    payload_json: '{}',
  }, obsidianRoot);

  assert.strictEqual(rendered.ok, true);
  assert.match(rendered.markdown, /- Clicks: 7/);
  assert.match(rendered.markdown, /- Impressions: 70/);
  assert.match(rendered.markdown, /- Date: 2026-06-03T01:00:00.000Z/);
  assert.match(rendered.markdown, /- Keyword: {{NICHE}} seo/);
  assert.match(rendered.markdown, /- Rank: 3/);
  assert.match(rendered.markdown, /- Date: 2026-06-03T02:00:00.000Z/);
  db.close();
});

test('task dedupe cancels duplicate active tasks atomically', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-dedupe-'));
  const dbPath = path.join(tempDir, 'seo-agent.db');
  const db = openStateDb(dbPath);
  const now = '2026-06-03T00:00:00.000Z';
  const insert = db.prepare(`
    INSERT INTO tasks (
      task_id, title, description, status, risk_level, priority_score, source,
      target_url, target_file, target_keyword, approval_required, created_at,
      updated_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `);
  insert.run(
    'TSK-KEEP',
    'Refresh {{NICHE}} SEO page',
    'Higher priority duplicate',
    'candidate',
    'semi_safe',
    900,
    'gsc',
    'https://{{DOMAIN}}/services/{{NICHE}}-seo',
    'services/{{NICHE}}-seo.html',
    '{{NICHE}} seo',
    now,
    now,
    JSON.stringify({ task_type: 'content_refresh' }),
  );
  insert.run(
    'TSK-DUP',
    'Refresh {{NICHE}} SEO page',
    'Lower priority duplicate',
    'candidate',
    'semi_safe',
    600,
    'gsc',
    'https://{{DOMAIN}}/services/{{NICHE}}-seo',
    'services/{{NICHE}}-seo.html',
    '{{NICHE}} seo',
    now,
    now,
    JSON.stringify({ task_type: 'content_refresh' }),
  );
  db.close();

  const result = runCli(['task', 'dedupe', '--db', dbPath, '--apply', '--json']);
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const parsed = parseSingleJson(result.stdout);
  assert.strictEqual(parsed.cancelled_count, 1);
  assert.strictEqual(parsed.cancelled[0].task_id, 'TSK-DUP');

  const checkDb = openStateDb(dbPath);
  assert.strictEqual(checkDb.prepare("SELECT status FROM tasks WHERE task_id = 'TSK-KEEP'").get().status, 'candidate');
  assert.strictEqual(checkDb.prepare("SELECT status FROM tasks WHERE task_id = 'TSK-DUP'").get().status, 'cancelled');
  assert.strictEqual(checkDb.prepare("SELECT COUNT(*) AS c FROM events WHERE event_type = 'task_duplicate_superseded'").get().c, 1);
  checkDb.close();
});

test('task next picks the highest-priority ready task per lane and enforces approval rows', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-tasknext-'));
  const dbPath = path.join(tempDir, 'seo-agent.db');
  const db = openStateDb(dbPath);
  const now = '2026-06-03T00:00:00.000Z';
  const insert = db.prepare(`
    INSERT INTO tasks (
      task_id, title, description, status, risk_level, priority_score, source,
      target_url, target_file, target_keyword, approval_required, created_at,
      updated_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, 'workplan', ?, NULL, NULL, ?, ?, ?, ?)
  `);
  // Ready SERP protect task on a blog URL: executor has a deterministic
  // snapshot action, so the picker must not park it in lane review just because
  // the target URL is under /blog/.
  insert.run('TSK-PROTECT', 'Protect ranking gain for pricing', '', 'approved', 'safe', 900,
    'https://{{DOMAIN}}/blog/best-seo-for-{{AUDIENCE}}', 0, now, now, JSON.stringify({ task_type: 'protect_ranking_gain' }));
  // Ready general task (semi_safe â†’ dispatch semi-safe).
  insert.run('TSK-OPS', 'Optimize service page', '', 'approved', 'semi_safe', 800,
    'https://{{DOMAIN}}/services/seo/', 0, now, now, JSON.stringify({ task_type: 'content_optimization' }));
  // Ready blog draft (routes to blog_content / draft_needed).
  insert.run('TSK-BLOG', 'create blog: {{NICHE}} stats 2026', '', 'approved', 'high_risk', 500,
    null, 0, now, now, JSON.stringify({ task_type: 'new_blog_post' }));
  // Not ready (candidate) â€” workers must skip.
  insert.run('TSK-CAND', 'Held idea', '', 'candidate', 'safe', 999,
    null, 0, now, now, JSON.stringify({ task_type: 'meta_fix' }));
  // Reversible high-risk, approval_required=1, but NOT in guardrails require_explicit_approval.
  // Under the opt-out model this must still be worker-runnable in ops once status='approved'.
  insert.run('TSK-REDIRECT', 'Set up redirect for moved page', '', 'approved', 'high_risk', 925,
    'https://{{DOMAIN}}/services/seo-old/', 1, now, now, JSON.stringify({ task_type: 'redirect_setup' }));
  // Page-content rewrite: must route to the Hermes content lane (blog_content /
  // edit_refresh_needed), NOT the deterministic ops lane which has no handler for it.
  insert.run('TSK-SERVICE-GAP', 'Resolve service-page indexability', '', 'approved', 'high_risk', 600,
    'https://{{DOMAIN}}/services/google-maps-seo-for-{{AUDIENCE}}', 0, now, now, JSON.stringify({ task_type: 'service_page_gap' }));
  // Irreversible, status=approved but NO approval row â€” must be excluded.
  insert.run('TSK-DEL', 'delete /old', '', 'approved', 'high_risk', 950,
    'https://{{DOMAIN}}/old/', 1, now, now, JSON.stringify({ task_type: 'delete_page' }));
  db.close();

  const ops = parseSingleJson(runCli(['task', 'next', '--db', dbPath, '--lane', 'general_operational', '--json']).stdout);
  assert.strictEqual(ops.ok, true);
  // TSK-DEL has higher priority but lacks an approval row; TSK-REDIRECT wins because
  // reversible high-risk work is opt-out runnable once status='approved'. service_page_gap
  // and the blog draft route to blog_content, so they are not in this lane's pool.
  assert.strictEqual(ops.task.task_id, 'TSK-REDIRECT');
  assert.strictEqual(ops.task.dispatch, 'high-risk');
  assert.strictEqual(ops.task.canonical_task_type, 'redirect_setup');
  assert.strictEqual(ops.ready_count, 3);

  const blog = parseSingleJson(runCli(['task', 'next', '--db', dbPath, '--lane', 'blog_content', '--json']).stdout);
  // Highest-priority blog_content task is the service-page rewrite (edit_refresh_needed),
  // ahead of the new_blog_post draft (TSK-BLOG).
  assert.strictEqual(blog.task.task_id, 'TSK-SERVICE-GAP');
  assert.strictEqual(blog.task.workflow_bucket, 'edit_refresh_needed');
  assert.strictEqual(blog.ready_count, 2);

  // Add a genuine approval row â†’ the irreversible task becomes eligible and wins on priority.
  const db2 = openStateDb(dbPath);
  db2.prepare("INSERT INTO approvals (approval_id, task_id, status, approved_at) VALUES ('APR-1', 'TSK-DEL', 'approved', ?)").run(now);
  db2.close();
  const opsAfter = parseSingleJson(runCli(['task', 'next', '--db', dbPath, '--lane', 'general_operational', '--json']).stdout);
  assert.strictEqual(opsAfter.task.task_id, 'TSK-DEL');
  assert.strictEqual(opsAfter.task.dispatch, 'high-risk');
  assert.strictEqual(opsAfter.ready_count, 4);
});

test('safe executor drops approved no-action tasks so workers do not pick them forever', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-safe-noaction-'));
  const dbPath = path.join(tempDir, 'seo-agent.db');
  const outPath = path.join(tempDir, 'execution.json');
  const brainVault = makeBrainVault();
  const siteRoot = makeGitRepo('client-safe-site-');
  fs.mkdirSync(path.join(siteRoot, 'blog'), { recursive: true });
  fs.writeFileSync(path.join(siteRoot, 'blog', 'best-seo-for-{{AUDIENCE}}.html'), `
    <!doctype html>
    <html><head><title>Best SEO for {{AUDIENCE}}</title></head>
    <body><h1>Best SEO for {{AUDIENCE}}</h1><p>{{AUDIENCE}} SEO pricing guidance.</p></body></html>
  `);
  runGit(siteRoot, ['add', 'blog/best-seo-for-{{AUDIENCE}}.html']);
  runGit(siteRoot, ['commit', '-m', 'add blog fixture']);

  const db = openStateDb(dbPath);
  const now = '2026-06-03T00:00:00.000Z';
  db.prepare(`
    INSERT INTO tasks (
      task_id, title, description, status, risk_level, priority_score, source,
      target_url, target_file, target_keyword, approval_required, created_at,
      updated_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(
    'TSK-NOACTION',
    'Protect SERP gain cluster',
    'Worker should not retry this forever when no deterministic action exists.',
    'approved',
    'safe',
    1000,
    'workplan',
    'https://{{DOMAIN}}/blog/best-seo-for-{{AUDIENCE}}',
    'blog/best-seo-for-{{AUDIENCE}}.html',
    '{{AUDIENCE}} seo pricing',
    now,
    now,
    JSON.stringify({ task_type: 'ranking_recovery', evidence: { reason: 'fixture intentionally lacks deterministic safe executor support' } }),
  );
  db.close();

  const result = runCli([
    'safe-fix',
    '--task', 'TSK-NOACTION',
    '--db', dbPath,
    '--site-root', siteRoot,
    '--brain-vault', brainVault,
    '--apply',
    '--production',
    '--out', outPath,
    '--json',
  ]);
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const parsed = parseSingleJson(result.stdout);
  assert.strictEqual(parsed.status, 'skipped');
  assert.match(parsed.reason, /not a deterministic safe edit/);

  const checkDb = openStateDb(dbPath);
  const task = checkDb.prepare("SELECT status, completed_at FROM tasks WHERE task_id = 'TSK-NOACTION'").get();
  assert.strictEqual(task.status, 'skipped');
  assert.ok(task.completed_at, 'skipped no-action task should have completed_at for throughput/reporting');
  assert.strictEqual(checkDb.prepare("SELECT COUNT(*) AS c FROM events WHERE task_id = 'TSK-NOACTION' AND event_type = 'task_execution_no_action'").get().c, 1);
  assert.strictEqual(checkDb.prepare("SELECT COUNT(*) AS c FROM outbox_jobs WHERE entity_id = 'TSK-NOACTION' AND status = 'pending'").get().c, 1);
  checkDb.close();

  const next = parseSingleJson(runCli(['task', 'next', '--db', dbPath, '--lane', 'general_operational', '--json']).stdout);
  assert.strictEqual(next.task, null);
  assert.strictEqual(next.ready_count, 0);
});

test('backup create writes a verified manifest for a temp DB', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-backup-'));
  const dbPath = path.join(tempDir, 'seo-agent.db');
  const backupRoot = path.join(tempDir, 'backups');
  const db = openStateDb(dbPath);
  db.prepare(`
    INSERT INTO tasks (task_id, title, status, created_at, updated_at, metadata_json)
    VALUES ('TSK-BACKUP', 'Backup smoke', 'candidate', ?, ?, '{}')
  `).run('2026-06-03T00:00:00.000Z', '2026-06-03T00:00:00.000Z');
  db.close();

  const result = runCli(['backup', 'create', '--db', dbPath, '--backup-root', backupRoot, '--no-raw-data', '--json']);
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const parsed = parseSingleJson(result.stdout);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.integrity.ok, true);
  assert.ok(fs.existsSync(parsed.manifest_path));
  assert.ok(fs.existsSync(path.join(parsed.backup_dir, path.basename(dbPath))));
});

test('task next defers future-scheduled tasks and surfaces them once due', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-defer-'));
  const dbPath = path.join(tempDir, 'seo-agent.db');
  const db = openStateDb(dbPath);
  const now = new Date();
  const future = new Date(now.getTime() + 14 * 86400000).toISOString();
  const past = new Date(now.getTime() - 60000).toISOString();
  const insert = db.prepare(`
    INSERT INTO tasks (
      task_id, title, description, status, risk_level, priority_score, source,
      target_url, target_file, target_keyword, approval_required, scheduled_for,
      created_at, updated_at, metadata_json
    ) VALUES (?, ?, '', 'approved', 'safe', ?, 'executor_followup', ?, NULL, ?, 0, ?, ?, ?, ?)
  `);
  const ts = now.toISOString();
  // Highest priority but scheduled 14 days out: must be invisible to the picker.
  insert.run('TSK-FUT', 'Ranking follow-up: emergency plumber', 999,
    'https://{{DOMAIN}}/services/emergency', 'emergency plumber', future, ts, ts,
    JSON.stringify({ task_type: 'ranking_followup' }));
  // Lower priority but already due.
  insert.run('TSK-NOW', 'Ranking follow-up: drain cleaning', 500,
    'https://{{DOMAIN}}/services/drain', 'drain cleaning', past, ts, ts,
    JSON.stringify({ task_type: 'ranking_followup' }));
  db.close();

  const deferred = parseSingleJson(runCli(['task', 'next', '--db', dbPath, '--lane', 'general_operational', '--json']).stdout);
  // TSK-FUT outranks on priority but is not yet due, so the due TSK-NOW wins.
  assert.strictEqual(deferred.task.task_id, 'TSK-NOW');
  assert.strictEqual(deferred.ready_count, 1);

  // Once the future task's scheduled_for passes, it becomes pickable and wins on priority.
  const db2 = openStateDb(dbPath);
  db2.prepare("UPDATE tasks SET scheduled_for = ? WHERE task_id = 'TSK-FUT'").run(past);
  db2.close();
  const due = parseSingleJson(runCli(['task', 'next', '--db', dbPath, '--lane', 'general_operational', '--json']).stdout);
  assert.strictEqual(due.task.task_id, 'TSK-FUT');
  assert.strictEqual(due.ready_count, 2);
});

test('evaluateRankingDeltas classifies regressions, improvements, lost rankings, and new keywords', () => {
  const evaluation = evaluateRankingDeltas(
    { improved: 5, regressed: 10, stable: 7, lost: 4, noBaseline: null },
    { improved: 3, regressed: 14, stable: 7, lost: null, noBaseline: 6 },
    { dropThreshold: 3 },
  );
  const byKeyword = Object.fromEntries(evaluation.rows.map((r) => [r.keyword, r.status]));
  assert.strictEqual(byKeyword.improved, 'improved');
  assert.strictEqual(byKeyword.regressed, 'regressed');   // 14 - 10 = 4 >= threshold
  assert.strictEqual(byKeyword.stable, 'stable');
  assert.strictEqual(byKeyword.lost, 'regressed');         // had rank 4, now unranked
  assert.strictEqual(byKeyword.noBaseline, 'new');         // nothing to compare against
  assert.strictEqual(evaluation.regressed, true);
  assert.deepStrictEqual(evaluation.regressions.map((r) => r.keyword).sort(), ['lost', 'regressed']);
});

test('executor follow-ups: schedule a deferred ranking_followup with depth cap and dedupe', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-followup-'));
  const dbPath = path.join(tempDir, 'seo-agent.db');
  const db = openStateDb(dbPath);
  const now = '2026-06-07T00:00:00.000Z';
  db.prepare(`
    INSERT INTO tasks (task_id, title, status, risk_level, priority_score, source,
      target_url, target_keyword, created_at, updated_at, metadata_json)
    VALUES ('TSK-OPT', 'Add title to emergency page', 'deployed_to_production', 'safe', 800, 'workplan',
      'https://{{DOMAIN}}/services/emergency', 'emergency plumber', ?, ?, ?)
  `).run(now, now, JSON.stringify({ task_type: 'missing_title', evidence: { type: 'missing_title', current_position: 8 } }));
  const parent = db.prepare("SELECT * FROM tasks WHERE task_id = 'TSK-OPT'").get();
  const parentMeta = JSON.parse(parent.metadata_json);

  const spec = planRankingFollowup(parent, parentMeta, { canonicalTaskType: 'missing_title' });
  assert.ok(spec, 'a ranking-affecting task with a keyword should get a follow-up spec');
  assert.strictEqual(spec.taskType, 'ranking_followup');
  assert.ok(spec.scheduledForIso > now, 'follow-up must be scheduled in the future');
  spec.evidence.baseline_positions = { 'emergency plumber': 8 };

  const created = createFollowupTask(db, spec);
  assert.strictEqual(created.created, true);
  const followup = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(created.task_id);
  assert.strictEqual(followup.status, 'approved');
  assert.ok(followup.scheduled_for > now, 'follow-up row must carry a future scheduled_for');
  const followMeta = JSON.parse(followup.metadata_json);
  assert.strictEqual(followMeta.task_type, 'ranking_followup');
  assert.strictEqual(followMeta.parent_task_id, 'TSK-OPT');
  assert.strictEqual(followMeta.followup_depth, 1);
  assert.strictEqual(followMeta.evidence.baseline_positions['emergency plumber'], 8);
  // A followup_task_created event is recorded for traceability.
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM events WHERE event_type = 'followup_task_created'").get().c, 1);

  // Dedupe: a second follow-up for the same URL+type must be refused.
  const dupe = createFollowupTask(db, spec);
  assert.strictEqual(dupe.created, false);
  assert.strictEqual(dupe.reason, 'duplicate_active_followup');

  // Depth cap: a spec whose parent is already at the max depth is refused.
  const deepSpec = planRankingFollowup(parent, { ...parentMeta, followup_depth: MAX_FOLLOWUP_DEPTH }, { canonicalTaskType: 'missing_title' });
  deepSpec.targetUrl = 'https://{{DOMAIN}}/services/other'; // sidestep the dedupe path
  const deep = createFollowupTask(db, deepSpec);
  assert.strictEqual(deep.created, false);
  assert.match(deep.reason, /max_followup_depth_reached/);
  db.close();
});

test('safe executor schedules a ranking follow-up after a ranking-affecting deploy', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-exec-followup-'));
  const dbPath = path.join(tempDir, 'seo-agent.db');
  const outPath = path.join(tempDir, 'execution.json');
  const brainVault = makeBrainVault();
  const siteRoot = makeGitRepo('client-followup-site-');
  fs.mkdirSync(path.join(siteRoot, 'services'), { recursive: true });
  // Page is missing a <title> so the deterministic safe executor has a real edit.
  fs.writeFileSync(path.join(siteRoot, 'services', 'emergency.html'),
    '<!doctype html><html><head><meta charset="utf-8"></head><body><h1>Emergency Plumber</h1><p>Fast service.</p></body></html>');
  runGit(siteRoot, ['add', 'services/emergency.html']);
  runGit(siteRoot, ['commit', '-m', 'add fixture']);

  const db = openStateDb(dbPath);
  const now = '2026-06-07T00:00:00.000Z';
  db.prepare(`
    INSERT INTO tasks (task_id, title, status, risk_level, priority_score, source,
      target_url, target_file, target_keyword, approval_required, created_at, updated_at, metadata_json)
    VALUES ('TSK-MISSING-TITLE', 'Add title to emergency page', 'approved', 'safe', 800, 'workplan',
      'https://{{DOMAIN}}/services/emergency', 'services/emergency.html', 'emergency plumber', 0, ?, ?, ?)
  `).run(now, now, JSON.stringify({ task_type: 'missing_title', evidence: { type: 'missing_title' } }));
  db.close();

  const result = runCli([
    'safe-fix', '--task', 'TSK-MISSING-TITLE', '--db', dbPath, '--site-root', siteRoot,
    '--brain-vault', brainVault, '--apply', '--commit', '--out', outPath, '--json',
  ], { env: { ...process.env, SEO_AGENT_TIMEZONE: 'UTC' } });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const parsed = parseSingleJson(result.stdout);
  assert.strictEqual(parsed.status, 'executed');
  assert.ok(Array.isArray(parsed.followups) && parsed.followups[0].created, 'a follow-up should be scheduled');

  const checkDb = openStateDb(dbPath);
  const followup = checkDb.prepare(
    "SELECT * FROM tasks WHERE source = 'executor_followup' AND task_id != 'TSK-MISSING-TITLE'",
  ).get();
  assert.ok(followup, 'a ranking_followup task should exist');
  const meta = JSON.parse(followup.metadata_json);
  assert.strictEqual(meta.task_type, 'ranking_followup');
  assert.strictEqual(meta.parent_task_id, 'TSK-MISSING-TITLE');
  assert.strictEqual(followup.status, 'approved');
  // Deferred ~14 days out, so the consumer must not pick it up immediately.
  const daysOut = (new Date(followup.scheduled_for) - new Date()) / 86400000;
  assert.ok(daysOut > 13 && daysOut < 15, `expected ~14 day defer, got ${daysOut}`);
  checkDb.close();

  const next = parseSingleJson(runCli(['task', 'next', '--db', dbPath, '--lane', 'general_operational', '--json']).stdout);
  assert.strictEqual(next.task, null, 'deferred follow-up must not be immediately pickable');
});

test('safe executor applies deterministic CWV fixes (lazy below-fold images, defer head scripts)', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-cwv-'));
  const dbPath = path.join(tempDir, 'seo-agent.db');
  const outPath = path.join(tempDir, 'execution.json');
  const brainVault = makeBrainVault();
  const siteRoot = makeGitRepo('client-cwv-site-');
  fs.mkdirSync(path.join(siteRoot, 'services'), { recursive: true });
  // Hero img above the first <h2> must stay eager; the two below it get lazy-loaded.
  // The plain head script gets defer; the JSON-LD, already-deferred, and module
  // scripts must be left alone.
  fs.writeFileSync(path.join(siteRoot, 'services', 'slow.html'), [
    '<!doctype html><html><head><title>Slow Page</title>',
    '<script src="/js/main.js"></script>',
    '<script src="/js/ok.js" defer></script>',
    '<script type="module" src="/js/mod.js"></script>',
    '<script type="application/ld+json">{"@context":"https://schema.org"}</script>',
    '</head><body>',
    '<h1>Slow Service</h1><img src="hero.webp" alt="hero">',
    '<h2>Details</h2><img src="a.webp" alt="a"><img src="b.webp" alt="b" loading="eager">',
    '<h2>More</h2><img src="c.webp" alt="c">',
    '</body></html>',
  ].join('\n'));
  runGit(siteRoot, ['add', 'services/slow.html']);
  runGit(siteRoot, ['commit', '-m', 'add cwv fixture']);

  const db = openStateDb(dbPath);
  const now = '2026-06-07T00:00:00.000Z';
  db.prepare(`
    INSERT INTO tasks (task_id, title, status, risk_level, priority_score, source,
      target_url, target_file, target_keyword, approval_required, created_at, updated_at, metadata_json)
    VALUES ('TSK-CWV', 'CWV fix: slow service page', 'approved', 'safe', 700, 'workplan',
      'https://{{DOMAIN}}/services/slow', 'services/slow.html', 'slow service', 0, ?, ?, ?)
  `).run(now, now, JSON.stringify({ task_type: 'cwv_fix', evidence: { type: 'cwv_fix', keywords: ['slow service'] } }));
  db.close();

  // Routing: cwv_fix is a deterministic ops type, dispatched to the safe executor.
  const next = parseSingleJson(runCli(['task', 'next', '--db', dbPath, '--lane', 'general_operational', '--json']).stdout);
  assert.strictEqual(next.task.task_id, 'TSK-CWV');
  assert.strictEqual(next.task.dispatch, 'safe-fix');

  const result = runCli([
    'safe-fix', '--task', 'TSK-CWV', '--db', dbPath, '--site-root', siteRoot,
    '--brain-vault', brainVault, '--apply', '--commit', '--out', outPath, '--json',
  ], { env: { ...process.env, SEO_AGENT_TIMEZONE: 'UTC' } });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const parsed = parseSingleJson(result.stdout);
  assert.strictEqual(parsed.status, 'executed');

  const html = fs.readFileSync(path.join(siteRoot, 'services', 'slow.html'), 'utf8');
  // Render-blocking head script deferred; the others untouched.
  assert.match(html, /<script defer src="\/js\/main\.js"><\/script>/);
  assert.match(html, /<script src="\/js\/ok\.js" defer><\/script>/);
  assert.match(html, /<script type="module" src="\/js\/mod\.js"><\/script>/);
  // Hero (above first <h2>) untouched; below-fold imgs lazy; explicit loading= respected.
  assert.match(html, /<img src="hero\.webp" alt="hero">/);
  assert.match(html, /<img loading="lazy" decoding="async" src="a\.webp" alt="a">/);
  assert.match(html, /<img src="b\.webp" alt="b" loading="eager">/);
  assert.match(html, /<img loading="lazy" decoding="async" src="c\.webp" alt="c">/);

  // A ranking-affecting deploy: a follow-up was scheduled to measure the outcome.
  assert.ok(Array.isArray(parsed.followups) && parsed.followups[0].created, 'cwv_fix should open a measurement window');
});
