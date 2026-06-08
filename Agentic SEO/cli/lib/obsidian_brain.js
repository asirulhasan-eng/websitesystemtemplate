const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { ensureDir, writeJson, writeText } = require('./io');
const { nowIso } = require('./dates');

const DEFAULT_VAULT = '/opt/client-obsidian';
const BRAIN_DIR = '01-Agent-Brain';
const COMPILED_DIR = path.join(BRAIN_DIR, 'Compiled');
const REQUIRED_DOMAINS = ['no_go', 'operating_rules', 'task_generation', 'risk_lanes'];
// Episodic memory lives in these subfolders. They are excluded from the policy
// compiler (so growing memory never churns the compiled-policy hash) and are
// read instead through recallMemory().
const MEMORY_FOLDERS = { decision: 'Decisions', lesson: 'Lessons', observation: 'Observations' };
const MEMORY_FOLDER_NAMES = new Set(Object.values(MEMORY_FOLDERS));
const MEMORY_STOPWORDS = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'was', 'were', 'are', 'has', 'have', 'had', 'not', 'but', 'all', 'any', 'our', 'its', 'their', 'a', 'an', 'of', 'to', 'in', 'on', 'is', 'it', 'as', 'at', 'by', 'or', 'be']);
const SUPPORTED_MATCH_TYPES = new Set(['domain', 'substring', 'exact', 'regex']);
const SUPPORTED_RISK_LEVELS = new Set(['safe', 'semi_safe', 'high_risk', 'blocked']);

function resolveVaultRoot(input) {
  return path.resolve(process.cwd(), input || process.env.CLIENT_BRAIN_VAULT || DEFAULT_VAULT);
}

function brainRoot(vaultRoot) {
  return path.join(resolveVaultRoot(vaultRoot), BRAIN_DIR);
}

function compiledRoot(vaultRoot) {
  return path.join(resolveVaultRoot(vaultRoot), COMPILED_DIR);
}

function parseMarkdownNote(filePath, vaultRoot) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const relative_path = path.relative(resolveVaultRoot(vaultRoot), filePath).replace(/\\/g, '/');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const frontmatter = match ? parseSimpleYaml(match[1]) : {};
  const body = match ? match[2] : raw;
  return {
    relative_path,
    file_path: filePath,
    title: frontmatter.title || path.basename(filePath, '.md'),
    frontmatter,
    body,
    source_hash: sha256(raw),
  };
}

function collectBrainNotes(vaultRoot) {
  const root = brainRoot(vaultRoot);
  if (!fs.existsSync(root)) throw new Error(`Obsidian Brain directory not found: ${root}`);
  return walkMarkdown(root)
    .filter((file) => !file.includes(`${path.sep}Compiled${path.sep}`))
    .filter((file) => !isMemoryFile(file))
    .map((file) => parseMarkdownNote(file, vaultRoot))
    .filter((note) => note.frontmatter.type === 'brain' && note.frontmatter.status !== 'archived');
}

function walkMarkdown(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkMarkdown(filePath));
    else if (entry.isFile() && entry.name.endsWith('.md')) results.push(filePath);
  }
  return results.sort();
}

function compileBrain(options = {}) {
  const vaultRoot = resolveVaultRoot(options.vaultRoot || options.vault);
  const notes = collectBrainNotes(vaultRoot);
  const now = nowIso();
  validateRequiredDomains(notes);
  const blocked_terms = collectBlockedTerms(notes);
  const risk_rules = collectRiskRules(notes);
  validateRuleIds([...blocked_terms, ...risk_rules]);
  const source_hash = computeSourceHash(notes);
  const source_files = notes.map((note) => ({
    path: note.relative_path,
    title: note.title,
    brain_domain: note.frontmatter.brain_domain || null,
    priority: note.frontmatter.priority || null,
    source_hash: note.source_hash,
    credential_storage: note.frontmatter.credential_storage || null,
  }));
  const noteSummaries = notes.map((note) => sanitizeNoteForCompact(note));
  const brain = {
    schema_version: 1,
    generated_at: now,
    source_hash,
    vault_root: vaultRoot,
    source_files,
    no_go_terms: blocked_terms.map((term) => term.term),
    blocked_terms,
    risk_rules,
    notes: noteSummaries,
  };
  const full = {
    ...brain,
    notes: notes.map((note) => ({
      path: note.relative_path,
      title: note.title,
      frontmatter: note.frontmatter,
      body: note.body,
      source_hash: note.source_hash,
    })),
  };
  const markdown = renderBrainMarkdown(brain);
  const outDir = compiledRoot(vaultRoot);
  ensureDir(outDir);
  atomicWriteJson(path.join(outDir, 'BRAIN.json'), brain);
  atomicWriteJson(path.join(outDir, 'BRAIN.full.json'), full);
  atomicWriteText(path.join(outDir, 'BRAIN.md'), markdown);
  // Last-good is replaced only after the complete compile has succeeded.
  atomicWriteJson(path.join(outDir, 'BRAIN.last-good.json'), brain);
  atomicWriteText(path.join(outDir, 'BRAIN.last-good.md'), markdown);
  return { ok: true, vault_root: vaultRoot, compiled_dir: outDir, generated_at: now, source_hash, no_go_terms: brain.no_go_terms, source_files };
}

function validateRequiredDomains(notes) {
  const domains = new Set(notes.map((note) => note.frontmatter.brain_domain).filter(Boolean));
  for (const domain of REQUIRED_DOMAINS) {
    if (!domains.has(domain)) throw new Error(`Missing required Brain domain: ${domain}`);
  }
  const noGoNotes = notes.filter((note) => note.frontmatter.brain_domain === 'no_go');
  if (!noGoNotes.some((note) => Array.isArray(note.frontmatter.blocked_terms) && note.frontmatter.blocked_terms.length > 0)) {
    throw new Error('No-go Brain notes must include machine-readable frontmatter blocked_terms.');
  }
}

function collectBlockedTerms(notes) {
  const terms = [];
  for (const note of notes) {
    const list = note.frontmatter.blocked_terms;
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const term = normalizeBlockedTerm(raw, note);
      terms.push(term);
    }
  }
  return terms;
}

function collectRiskRules(notes) {
  const rules = [];
  for (const note of notes) {
    const list = note.frontmatter.risk_rules;
    if (!Array.isArray(list)) continue;
    for (const raw of list) rules.push(normalizeRiskRule(raw, note));
  }
  return rules;
}

function normalizeRiskRule(raw, note) {
  const term = String(raw.term || '').trim();
  if (!term) throw new Error(`Risk rule in ${note.relative_path} is missing term.`);
  const risk_level = String(raw.risk_level || '').trim();
  if (!SUPPORTED_RISK_LEVELS.has(risk_level)) throw new Error(`Risk rule ${raw.rule_id || term} has unsupported risk_level: ${risk_level}`);
  const match_type = raw.match_type || 'substring';
  if (!SUPPORTED_MATCH_TYPES.has(match_type)) throw new Error(`Risk rule ${raw.rule_id || term} has unsupported match_type: ${match_type}`);
  return {
    term,
    match_type,
    risk_level,
    applies_to_fields: Array.isArray(raw.applies_to_fields) && raw.applies_to_fields.length ? raw.applies_to_fields : ['target_url', 'target_keyword', 'title', 'description', 'source', 'metadata'],
    reason: raw.reason || '',
    rule_id: raw.rule_id || `risk-${slug(term)}-${risk_level}`,
    rule_note: note.relative_path,
  };
}

function validateRuleIds(rules) {
  const seen = new Map();
  const conflicts = new Map();
  for (const rule of rules) {
    if (!rule.rule_id) throw new Error(`Brain rule for ${rule.term} is missing rule_id.`);
    if (seen.has(rule.rule_id)) {
      const first = seen.get(rule.rule_id);
      throw new Error(`Duplicate active Brain rule_id ${rule.rule_id} in ${first.rule_note} and ${rule.rule_note}.`);
    }
    seen.set(rule.rule_id, rule);
    const conflictKey = `${rule.match_type}:${String(rule.term).toLowerCase()}:${(rule.applies_to_fields || []).join(',')}`;
    if (conflicts.has(conflictKey)) {
      const first = conflicts.get(conflictKey);
      const firstDisposition = first.risk_level || first.severity;
      const thisDisposition = rule.risk_level || rule.severity;
      if (firstDisposition !== thisDisposition) {
        throw new Error(`Conflicting active Brain rules for ${rule.term}: ${first.rule_id}=${firstDisposition}, ${rule.rule_id}=${thisDisposition}.`);
      }
    } else {
      conflicts.set(conflictKey, rule);
    }
  }
}

function normalizeBlockedTerm(raw, note) {
  const term = String(raw.term || '').trim();
  if (!term) throw new Error(`Blocked term in ${note.relative_path} is missing term.`);
  const match_type = raw.match_type || 'substring';
  if (!SUPPORTED_MATCH_TYPES.has(match_type)) throw new Error(`Blocked term ${term} has unsupported match_type: ${match_type}`);
  const severity = raw.severity || 'block';
  if (!['block', 'warn'].includes(severity)) throw new Error(`Blocked term ${term} has unsupported severity: ${severity}`);
  return {
    term,
    match_type,
    severity,
    applies_to_fields: Array.isArray(raw.applies_to_fields) && raw.applies_to_fields.length ? raw.applies_to_fields : ['target_url', 'target_keyword', 'title', 'description', 'source', 'metadata'],
    reason: raw.reason || '',
    override_allowed: Boolean(raw.override_allowed),
    rule_id: raw.rule_id || `brain-${slug(term)}`,
    rule_note: note.relative_path,
  };
}

function sanitizeNoteForCompact(note) {
  const domain = note.frontmatter.brain_domain || 'general';
  const isCredential = domain === 'credentials' || note.frontmatter.credential_storage === 'intentional';
  return {
    path: note.relative_path,
    title: note.title,
    brain_domain: domain,
    priority: note.frontmatter.priority || null,
    credential_storage: note.frontmatter.credential_storage || null,
    body_summary: isCredential ? '[credential note intentionally stored; values omitted from compact Brain summary]' : summarizeBody(note.body),
  };
}

function summarizeBody(body) {
  return String(body || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('---'))
    .slice(0, 20)
    .join('\n')
    .slice(0, 4000);
}

function renderBrainMarkdown(brain) {
  const lines = [
    '# {{SITE_NAME}} Agent Brain',
    '',
    `Generated: ${brain.generated_at}`,
    `Source hash: ${brain.source_hash}`,
    '',
    '## No-go terms',
  ];
  for (const term of brain.blocked_terms) {
    lines.push(`- ${term.term} (${term.match_type}, ${term.severity}) â€” ${term.reason || term.rule_id}`);
  }
  lines.push('', '## Risk reminders');
  for (const note of brain.notes.filter((n) => ['risk_lanes', 'operating_rules', 'task_generation', 'no_go'].includes(n.brain_domain))) {
    lines.push('', `### ${note.title}`, '', note.body_summary || '');
  }
  const credentialNotes = brain.notes.filter((n) => n.brain_domain === 'credentials' || n.credential_storage === 'intentional');
  if (credentialNotes.length) {
    lines.push('', '## Credential notes', '', '- Credential notes exist in full Brain artifacts; values are omitted from this compact prompt summary.');
  }
  return `${lines.join('\n')}\n`;
}

function loadBrain(options = {}) {
  const vaultRoot = resolveVaultRoot(options.vaultRoot || options.vault || options['brain-vault']);
  const mode = options.mode || 'read_only';
  const outDir = compiledRoot(vaultRoot);
  const jsonPath = options.brainPath || path.join(outDir, 'BRAIN.json');
  const lastGoodPath = path.join(outDir, 'BRAIN.last-good.json');
  if (!fs.existsSync(jsonPath)) {
    if (options.autoCompile !== false) compileBrain({ vaultRoot });
    else if (options.allowMissing) return { brain: null, missing: true, warning: `Brain missing at ${jsonPath}` };
  }
  let brain = readJsonStrict(jsonPath);
  let stale = false;
  try {
    stale = brain.source_hash !== computeCurrentSourceHash(vaultRoot);
  } catch (error) {
    if (mode !== 'read_only') throw error;
    stale = true;
  }
  if (stale) {
    if (mode === 'read_only' && fs.existsSync(lastGoodPath)) {
      const lastGood = readJsonStrict(lastGoodPath);
      return { brain: lastGood, stale: true, used_last_good: true, warning: 'Compiled Brain is stale; using last-good snapshot for read-only summary.' };
    }
    if (options.autoCompile !== false) {
      compileBrain({ vaultRoot });
      brain = readJsonStrict(jsonPath);
    } else {
      throw new Error('Compiled Brain is stale. Run tools/compile_obsidian_brain.js before generation/execution.');
    }
  }
  return { brain, stale: false, used_last_good: false, warning: null };
}

function computeCurrentSourceHash(vaultRoot) {
  return computeSourceHash(collectBrainNotes(vaultRoot));
}

function computeSourceHash(notes) {
  const hash = crypto.createHash('sha256');
  for (const note of [...notes].sort((a, b) => a.relative_path.localeCompare(b.relative_path))) {
    hash.update(note.relative_path);
    hash.update('\0');
    hash.update(note.source_hash);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function assertAllowedByBrain(entity, brain) {
  const terms = brain && Array.isArray(brain.blocked_terms) ? brain.blocked_terms : [];
  const flattened = flattenEntity(entity);
  let firstWarning = null;
  for (const rule of terms) {
    const fields = rule.applies_to_fields || [];
    const matched = findRuleMatch(rule, flattened, fields);
    if (!matched) continue;
    const result = {
      allowed: rule.severity === 'warn',
      warning: rule.severity === 'warn',
      term: rule.term,
      rule_id: rule.rule_id,
      rule_note: rule.rule_note,
      field: matched.field,
      value: matched.value,
      reason: `${rule.term}: ${rule.reason || `Blocked by Brain rule ${rule.rule_id || rule.term}`}`,
    };
    // Block rules take immediate precedence over any earlier warn matches
    if (!result.allowed) return result;
    // Collect first warning but continue checking for block rules
    if (!firstWarning) firstWarning = result;
  }
  // Return warning if any matched (but no block rules triggered)
  if (firstWarning) return firstWarning;
  return { allowed: true };
}

function findRuleMatch(rule, flattened, fields) {
  for (const { field, value } of flattened) {
    if (!fieldApplies(field, fields)) continue;
    if (matchesRule(rule, value)) return { field, value };
  }
  return null;
}

function fieldApplies(field, fields) {
  if (fields.includes('*')) return true;
  for (const item of fields) {
    if (item === field || field.startsWith(`${item}.`)) return true;
    if (item === 'metadata' && (field === 'metadata_json' || field.startsWith('metadata_json.') || field.startsWith('evidence.'))) return true;
  }
  return false;
}

function matchesRule(rule, value) {
  const text = String(value || '');
  if (!text) return false;
  const term = String(rule.term || '');
  if (rule.match_type === 'domain') return domainMatches(text, term);
  if (rule.match_type === 'exact') return text.trim().toLowerCase() === term.toLowerCase();
  if (rule.match_type === 'regex') {
    // Guard against ReDoS: reject overly complex patterns and limit input length
    if (term.length > 200) return false;
    try {
      const re = new RegExp(term, 'i');
      // Test on a truncated input to bound execution time
      return re.test(text.length > 10000 ? text.slice(0, 10000) : text);
    } catch {
      // Invalid regex pattern in Brain rule â€” treat as non-match
      return false;
    }
  }
  return text.toLowerCase().includes(term.toLowerCase());
}

function domainMatches(value, term) {
  const lowerTerm = term.toLowerCase().replace(/^www\./, '');
  const candidates = extractHostsAndText(value);
  return candidates.some((candidate) => {
    const host = candidate.toLowerCase().replace(/^www\./, '');
    if (host === lowerTerm || host.endsWith(`.${lowerTerm}`)) return true;
    const escapedTerm = lowerTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9.-])${escapedTerm}([^a-z0-9.-]|$)`, "i").test(candidate);
  });
}

function extractHostsAndText(value) {
  const text = String(value || '');
  const hosts = [];
  for (const match of text.matchAll(/https?:\/\/[^\s)>'"]+/gi)) {
    try { hosts.push(new URL(match[0]).hostname); } catch {}
  }
  try { hosts.push(new URL(text).hostname); } catch {}
  return hosts.length ? hosts : [text];
}

function flattenEntity(entity) {
  const out = [];
  function visit(value, prefix) {
    if (value === undefined || value === null) return;
    if (typeof value === 'string' && looksJson(value)) {
      out.push({ field: prefix, value });
      try { visit(JSON.parse(value), prefix); } catch {}
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${prefix}.${index}`));
      return;
    }
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) visit(child, prefix ? `${prefix}.${key}` : key);
      return;
    }
    out.push({ field: prefix, value: String(value) });
  }
  visit(entity || {}, '');
  return out.filter((item) => item.field);
}

function evaluateRiskWithBrain(entity, brain) {
  const rules = brain && Array.isArray(brain.risk_rules) ? brain.risk_rules : [];
  const flattened = flattenEntity(entity);
  for (const rule of rules) {
    const matched = findRuleMatch(rule, flattened, rule.applies_to_fields || []);
    if (!matched) continue;
    return {
      risk_level: rule.risk_level,
      rule_id: rule.rule_id,
      rule_note: rule.rule_note,
      field: matched.field,
      value: matched.value,
      reason: `${rule.term}: ${rule.reason || `Risk classified by Brain rule ${rule.rule_id || rule.term}`}`,
    };
  }
  return null;
}

function logBrainEvent(db, entity, result, source = 'brain_guard') {
  if (!db || !result || result.allowed) return;
  try {
    const now = nowIso();
    const taskId = entity.task_id || entity.candidate_id || null;
    db.prepare(`INSERT INTO events (event_id,event_type,task_id,resource_type,resource_id,old_value,new_value,source,agent_name,created_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      `EVT-${crypto.randomUUID()}`,
      'brain_guard_blocked',
      taskId,
      taskId ? 'task' : 'candidate',
      taskId,
      null,
      'blocked',
      source,
      'Obsidian Brain Guard',
      now,
      JSON.stringify(result),
    );
  } catch (_) {
    // Guard logging must not mask the real blocking decision.
  }
}

/**
 * parseSimpleYaml
 * A minimal custom YAML parser built to maintain the zero-dependency architecture.
 *
 * IMPORTANT CONSTRAINTS - This will BREAK if you use:
 * - Multi-line strings (|, >)
 * - Flow sequences ([a, b, c])
 * - Anchors and aliases (&, *)
 * - Nested maps deeper than 2 levels
 * - Comments on the same line as values
 *
 * If the frontmatter evolves to require these features, you must migrate
 * to the `yaml` npm package. Until then, keep Obsidian frontmatter simple.
 */
function parseSimpleYaml(source) {
  const lines = String(source || '').replace(/\t/g, '  ').split(/\r?\n/);
  const root = {};
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith('#')) { index += 1; continue; }
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) { index += 1; continue; }
    const [, key, rawValue] = keyMatch;
    if (rawValue !== '') {
      root[key] = parseScalar(rawValue);
      index += 1;
      continue;
    }
    const block = collectIndented(lines, index + 1, 2);
    root[key] = parseYamlBlock(block.map((item) => item.slice(2)));
    index = block.nextIndex;
  }
  return root;
}

function collectIndented(lines, start, indent) {
  const out = [];
  let index = start;
  const pad = ' '.repeat(indent);
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { out.push(line); index += 1; continue; }
    if (!line.startsWith(pad)) break;
    out.push(line);
    index += 1;
  }
  out.nextIndex = index;
  return out;
}

function parseYamlBlock(lines) {
  const compact = lines.filter((line) => line.trim());
  if (compact.length === 0) return [];
  if (compact[0].trim().startsWith('- ')) return parseYamlList(lines);
  const obj = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    obj[key] = raw === '' ? [] : parseScalar(raw);
  }
  return obj;
}

function parseYamlList(lines) {
  const list = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const itemMatch = line.match(/^-\s*(.*)$/);
    if (!itemMatch) { i += 1; continue; }
    const first = itemMatch[1];
    if (!first) {
      list.push(null); i += 1; continue;
    }
    const keyValue = first.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyValue) {
      list.push(parseScalar(first)); i += 1; continue;
    }
    const obj = { [keyValue[1]]: parseScalar(keyValue[2]) };
    i += 1;
    while (i < lines.length && /^\s{2,}/.test(lines[i])) {
      const child = lines[i].slice(2);
      const match = child.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (match) {
        const [, key, raw] = match;
        if (raw !== '') {
          obj[key] = parseScalar(raw);
          i += 1;
        } else {
          const sub = [];
          i += 1;
          while (i < lines.length && /^\s{4,}-\s+/.test(lines[i])) {
            sub.push(parseScalar(lines[i].replace(/^\s{4,}-\s+/, '')));
            i += 1;
          }
          obj[key] = sub;
        }
      } else {
        i += 1;
      }
    }
    list.push(obj);
  }
  return list;
}

function parseScalar(value) {
  const raw = String(value || '').trim();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw.replace(/^['"]|['"]$/g, '');
}

function readJsonStrict(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function atomicWriteJson(filePath, value) {
  atomicWriteText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function atomicWriteText(filePath, content) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function looksJson(value) {
  const text = String(value || '').trim();
  return (text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'));
}

// Render a frontmatter scalar that survives the minimal YAML parser. Bare when
// it is a simple human string; double-quoted (with " collapsed to ') otherwise,
// since parseScalar strips one surrounding quote pair.
function yamlScalar(value) {
  const text = String(value || '').trim();
  if (text && /^[A-Za-z][\w \-.,/()'&]*$/.test(text)) return text;
  return `"${text.replace(/"/g, "'")}"`;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Episodic memory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// The "human-readable memory brain": the system records decisions, lessons, and
// observations as durable Markdown notes (written downstream via the Outbox),
// and recalls relevant ones on demand. Memory notes are authored by the agent
// (managed_by: client-agent) and live under 01-Agent-Brain/{Decisions,
// Lessons,Observations}/. They are NOT compiled into the policy guard.

function isMemoryFile(filePath) {
  const sep = path.sep;
  return [...MEMORY_FOLDER_NAMES].some((folder) => filePath.includes(`${sep}${folder}${sep}`));
}

function normalizeMemoryType(type) {
  const key = String(type || '').trim().toLowerCase();
  if (!MEMORY_FOLDERS[key]) {
    throw new Error(`Unsupported memory type: ${type}. Use one of: ${Object.keys(MEMORY_FOLDERS).join(', ')}.`);
  }
  return key;
}

function memoryNoteRelativePath(memory) {
  const type = normalizeMemoryType(memory.memory_type);
  const date = String(memory.created_at || nowIso()).slice(0, 10);
  const base = `${date}-${slug(memory.title || memory.memory_id || type)}`.slice(0, 110);
  return `${BRAIN_DIR}/${MEMORY_FOLDERS[type]}/${base}.md`;
}

function renderMemoryNoteMarkdown(memory) {
  const type = normalizeMemoryType(memory.memory_type);
  const created = memory.created_at || nowIso();
  const tags = Array.isArray(memory.tags) ? memory.tags.filter(Boolean) : [];
  const links = Array.isArray(memory.links) ? memory.links.filter(Boolean) : [];
  const fm = [
    '---',
    `memory_id: ${memory.memory_id || ''}`,
    `title: ${yamlScalar(memory.title || '')}`,
    'type: brain',
    'brain_domain: memory',
    `memory_type: ${type}`,
    'status: active',
    // managed_by lets the Outbox write-guard accept this file into 01-Agent-Brain.
    'managed_by: client-agent',
    `created_at: ${created}`,
  ];
  if (memory.session) fm.push(`session: ${memory.session}`);
  if (memory.related_task) fm.push(`related_task: ${memory.related_task}`);
  if (memory.source) fm.push(`source: ${memory.source}`);
  if (memory.confidence) fm.push(`confidence: ${memory.confidence}`);
  fm.push('tags:', `  - ${type}`, '  - memory');
  for (const tag of tags) fm.push(`  - ${slug(tag)}`);
  fm.push('---', '');

  const heading = MEMORY_FOLDERS[type].replace(/s$/, '');
  const body = [
    `# ${heading}: ${memory.title || '(untitled)'}`,
    '',
  ];
  if (memory.related_task) body.push(`> Related task: [[${memory.related_task}]]`, '');
  body.push(String(memory.body || '').trim(), '');
  if (links.length) {
    body.push('## Related', '');
    for (const link of links) body.push(`- [[${String(link).replace(/^\[\[|\]\]$/g, '')}]]`);
    body.push('');
  }
  body.push('---', `*Recorded by {{SITE_NAME}} agent at ${created}. Episodic memory â€” not authoritative state (SQLite wins for live status).*`, '');
  return `${fm.join('\n')}${body.join('\n')}`;
}

function collectMemoryNotes(vaultRoot, options = {}) {
  const root = brainRoot(vaultRoot);
  if (!fs.existsSync(root)) return [];
  return walkMarkdown(root)
    .filter((file) => isMemoryFile(file))
    .map((file) => parseMarkdownNote(file, vaultRoot))
    .filter((note) => note.frontmatter.type === 'brain')
    .filter((note) => options.includeArchived || note.frontmatter.status !== 'archived');
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !MEMORY_STOPWORDS.has(token));
}

function recallMemory(options = {}) {
  const vaultRoot = resolveVaultRoot(options.vaultRoot || options.vault);
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 8;
  const wantType = options.type ? normalizeMemoryType(options.type) : null;
  const wantTag = options.tag ? slug(options.tag) : null;
  const queryTokens = tokenize(options.query);

  let notes = collectMemoryNotes(vaultRoot, { includeArchived: Boolean(options.includeArchived) });
  if (wantType) notes = notes.filter((note) => note.frontmatter.memory_type === wantType);
  if (options.domain) notes = notes.filter((note) => note.frontmatter.brain_domain === options.domain);
  if (wantTag) {
    notes = notes.filter((note) => {
      const tags = Array.isArray(note.frontmatter.tags) ? note.frontmatter.tags.map((t) => slug(t)) : [];
      return tags.includes(wantTag);
    });
  }
  if (options.related_task) {
    notes = notes.filter((note) => String(note.frontmatter.related_task || '') === options.related_task);
  }

  const scored = notes.map((note) => {
    const titleTokens = tokenize(note.title);
    const tagTokens = (Array.isArray(note.frontmatter.tags) ? note.frontmatter.tags : []).flatMap((t) => tokenize(t));
    const bodyTokens = tokenize(note.body);
    let score = 0;
    if (queryTokens.length) {
      for (const token of queryTokens) {
        if (titleTokens.includes(token)) score += 5;
        if (tagTokens.includes(token)) score += 3;
        score += bodyTokens.filter((b) => b === token).length;
      }
    }
    return { note, score };
  });

  const ranked = scored
    .filter((entry) => (queryTokens.length ? entry.score > 0 : true))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Tie-break: most recent first.
      return String(b.note.frontmatter.created_at || '').localeCompare(String(a.note.frontmatter.created_at || ''));
    })
    .slice(0, limit);

  return {
    vault_root: vaultRoot,
    query: options.query || null,
    matched: ranked.length,
    scanned: notes.length,
    results: ranked.map((entry) => ({
      memory_id: entry.note.frontmatter.memory_id || null,
      memory_type: entry.note.frontmatter.memory_type || null,
      brain_domain: entry.note.frontmatter.brain_domain || null,
      title: entry.note.title,
      path: entry.note.relative_path,
      created_at: entry.note.frontmatter.created_at || null,
      related_task: entry.note.frontmatter.related_task || null,
      tags: Array.isArray(entry.note.frontmatter.tags) ? entry.note.frontmatter.tags : [],
      score: entry.score,
      snippet: memorySnippet(entry.note.body, queryTokens),
    })),
  };
}

function memorySnippet(body, queryTokens) {
  const lines = String(body || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('>') && !line.startsWith('---') && !line.startsWith('*'));
  if (!lines.length) return '';
  if (queryTokens.length) {
    const hit = lines.find((line) => queryTokens.some((token) => line.toLowerCase().includes(token)));
    if (hit) return hit.slice(0, 240);
  }
  return lines[0].slice(0, 240);
}

module.exports = {
  DEFAULT_VAULT,
  resolveVaultRoot,
  brainRoot,
  compiledRoot,
  compileBrain,
  loadBrain,
  assertAllowedByBrain,
  evaluateRiskWithBrain,
  logBrainEvent,
  parseSimpleYaml,
  computeCurrentSourceHash,
  MEMORY_FOLDERS,
  normalizeMemoryType,
  memoryNoteRelativePath,
  renderMemoryNoteMarkdown,
  collectMemoryNotes,
  recallMemory,
};
