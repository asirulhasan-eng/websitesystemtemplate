const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  renderMemoryNoteMarkdown,
  memoryNoteRelativePath,
  recallMemory,
  normalizeMemoryType,
} = require('../cli/lib/obsidian_brain');
const { assertSafeObsidianWritePath, renderJob } = require('../cli/commands/outbox-obsidian');

const CLI = path.resolve(__dirname, '../cli/bin/v2.js');

function runCli(args) {
  return spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
}

function parseJson(result) {
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('renderMemoryNoteMarkdown emits managed_by and passes the Brain write-guard', () => {
  const memory = {
    memory_id: 'MEM-TEST-1',
    memory_type: 'lesson',
    title: 'Title rewrite lifted SEO for {{AUDIENCE}}',
    body: 'Rewriting the title tag moved the page from position 7 to 3.',
    created_at: '2026-06-03T00:00:00.000Z',
    tags: ['serp', 'title-tag'],
    related_task: 'TSK-2026-06-03-ABCD1234',
  };
  const rel = memoryNoteRelativePath(memory);
  assert.match(rel, /^01-Agent-Brain\/Lessons\/2026-06-03-/);

  const md = renderMemoryNoteMarkdown(memory);
  assert.match(md, /managed_by: client-agent/);
  assert.match(md, /memory_type: lesson/);
  assert.match(md, /\[\[TSK-2026-06-03-ABCD1234\]\]/);

  // The Outbox guard must accept a Brain write that carries managed_by.
  const vault = tmp('mem-guard-');
  assert.doesNotThrow(() => assertSafeObsidianWritePath(vault, path.join(vault, rel), md));
});

test('write-guard rejects a Brain write without managed_by', () => {
  const vault = tmp('mem-guard2-');
  const rel = '01-Agent-Brain/Lessons/2026-06-03-no-managed-flag.md';
  assert.throws(() => assertSafeObsidianWritePath(vault, path.join(vault, rel), '---\ntype: brain\n---\nbody'));
});

test('renderJob handles write_obsidian_brain_note from payload', () => {
  const job = {
    job_type: 'write_obsidian_brain_note',
    outbox_id: 'OUT-1',
    payload_json: JSON.stringify({
      relative_path: '01-Agent-Brain/Decisions/2026-06-03-test.md',
      markdown: '---\ntype: brain\nmanaged_by: client-agent\n---\n# Decision\n',
    }),
  };
  const rendered = renderJob(null, job, '/tmp/vault');
  assert.strictEqual(rendered.ok, true);
  assert.ok(rendered.notePath.endsWith(path.join('01-Agent-Brain', 'Decisions', '2026-06-03-test.md')));
});

test('normalizeMemoryType rejects unknown types', () => {
  assert.throws(() => normalizeMemoryType('rumor'));
  assert.strictEqual(normalizeMemoryType('Decision'), 'decision');
});

test('recallMemory returns empty gracefully when the vault has no brain', () => {
  const vault = tmp('mem-empty-');
  const result = recallMemory({ vaultRoot: vault, query: 'anything' });
  assert.strictEqual(result.matched, 0);
  assert.deepStrictEqual(result.results, []);
});

test('end-to-end: note add -> outbox sync -> file written -> recall finds it', () => {
  const vault = tmp('mem-e2e-vault-');
  const db = path.join(tmp('mem-e2e-db-'), 'state.db');

  const added = parseJson(runCli([
    'brain', 'note', 'add',
    '--type', 'lesson',
    '--title', 'Title rewrite lifted SEO for {{AUDIENCE}}',
    '--body', 'Rewriting the title tag moved the page from position 7 to 3 within nine days.',
    '--tags', 'serp,title-tag',
    '--task', 'TSK-2026-06-03-ABCD1234',
    '--db', db,
    '--json',
  ]));
  assert.strictEqual(added.ok, true);
  assert.strictEqual(added.memory_type, 'lesson');
  assert.strictEqual(added.queued, true);
  assert.match(added.note_path, /^01-Agent-Brain\/Lessons\//);

  // Drain the outbox into the vault.
  const synced = parseJson(runCli(['outbox', 'obsidian', '--db', db, '--obsidian-root', vault, '--json']));
  assert.strictEqual(synced.processed, 1);
  assert.strictEqual(synced.results[0].status, 'completed');

  const written = path.join(vault, added.note_path);
  assert.ok(fs.existsSync(written), `expected memory note at ${written}`);
  const content = fs.readFileSync(written, 'utf8');
  assert.match(content, /managed_by: client-agent/);
  assert.match(content, /position 7 to 3/);

  // Recall it by query.
  const recalled = parseJson(runCli(['brain', 'recall', '--query', 'title rewrite {{AUDIENCE}} ranking', '--vault', vault, '--json']));
  assert.ok(recalled.matched >= 1, 'expected at least one recalled memory');
  assert.strictEqual(recalled.results[0].title, 'Title rewrite lifted SEO for {{AUDIENCE}}');
  assert.strictEqual(recalled.results[0].memory_type, 'lesson');

  // Type filter + tag filter.
  const byTag = parseJson(runCli(['brain', 'recall', '--type', 'lesson', '--tag', 'serp', '--vault', vault, '--json']));
  assert.ok(byTag.matched >= 1);
});
