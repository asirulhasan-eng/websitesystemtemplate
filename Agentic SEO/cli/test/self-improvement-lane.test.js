const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../../..');

test('self-improvement command and cron lane are present in generic template', () => {
  const v2 = fs.readFileSync(path.join(repoRoot, 'Agentic SEO/cli/bin/v2.js'), 'utf8');
  assert.match(v2, /self-improve/);
  assert.ok(fs.existsSync(path.join(repoRoot, 'Agentic SEO/cli/commands/self-improve.js')));
  assert.ok(fs.existsSync(path.join(repoRoot, 'Agentic SEO/cli/commands/task-execute-self-improvement.js')));
  assert.ok(fs.existsSync(path.join(repoRoot, 'Agentic SEO/cron/run-self-improvement.sh')));
});

test('cron installer includes AI review and self-improvement lanes', () => {
  const installer = fs.readFileSync(path.join(repoRoot, 'Agentic SEO/cron/install-crons.sh'), 'utf8');
  assert.match(installer, /run-ai-review\.sh/);
  assert.match(installer, /run-self-improvement\.sh/);
  assert.match(installer, /run-blog-pipeline\.sh/);
  assert.match(installer, /run-ops-pipeline\.sh/);
});

test('cron installer renders configured agent root instead of hardcoded template path', () => {
  const installer = path.join(repoRoot, 'Agentic SEO/cron/install-crons.sh');
  const cronDir = path.join(repoRoot, 'Agentic SEO/cron');
  const renderedRoot = '/opt/acme-agent';
  const result = spawnSync('bash', [installer, '--dry-run'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      WEBSITE_AGENT_ROOT: renderedRoot,
      WEBSITE_AGENT_CRON_DIR: cronDir,
    },
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, new RegExp(`${renderedRoot}/cron/run-self-improvement\\.sh`));
  assert.doesNotMatch(result.stdout, /\/opt\/website-agent\/cron\/run-self-improvement\.sh/);
});
