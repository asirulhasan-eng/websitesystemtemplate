/**
 * report-format.js â€” Format arbitrary data into report templates
 *
 * Renders data through built-in templates (daily, weekly, alert) or custom format,
 * outputting as JSON, markdown, or HTML.
 *
 * Usage:
 *   v2 report format --template daily --data '{"tasks_completed":5}' --format markdown
 *   v2 report format --template alert --data '{"severity":"critical","message":"DB down"}'
 *   v2 report format --data-file report.json --format json
 *
 * Options:
 *   --template       Template name: daily, weekly, alert, custom (default: custom)
 *   --data           JSON string with data to render
 *   --data-file      Read data from a JSON file
 *   --format         Output format: json, markdown, html (default: markdown)
 *   --title          Custom title for the report (used with custom template)
 *   --json           Force JSON output (alias for --format json)
 *   --sample         Return sample formatted output
 *   --help           Show this help text
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, jsonArg, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { nowIso, localDateOnly } = require('../lib/dates');

const TOOL = 'report-format';

const HELP = `
report-format â€” Format arbitrary data into report templates

USAGE
  v2 report format --template <name> --data <json> [options]

OPTIONS
  --template        Template to use: daily | weekly | alert | workplan | custom (default: custom)
  --data            JSON string with data for the template
  --data-file       Path to a JSON file containing the data
  --format          Output format: json | markdown | html (default: markdown)
  --title           Custom report title (used with "custom" template)
  --json            Shorthand for --format json
  --sample          Return sample formatted output
  --help            Show this help text

EXAMPLES
  v2 report format --template daily --data '{"tasks_completed":5,"gsc_clicks":120}' --format markdown
  v2 report format --template alert --data '{"severity":"critical","message":"DB integrity failed"}'
  v2 report format --data-file /tmp/report-data.json --format html
  v2 report format --template custom --title "Deployment Summary" --data '{"branch":"main","status":"live"}'

TEMPLATES
  daily   â€” Formatted daily activity summary with task/GSC/SERP sections
  weekly  â€” Week-over-week comparison with daily breakdown table
  alert   â€” Urgent alert with severity, message, and recommended actions
  workplan â€” Reviewable 12-hour work plan email (opt-out via Telegram)
  custom  â€” Generic key-value rendering with optional custom title
`.trim();

function renderDaily(data) {
  const d = data || {};
  const date = d.date || d.report_date || localDateOnly();
  const lines = [
    `# Daily Report â€” ${date}`,
    '',
    '## Tasks',
    `- Completed: ${d.tasks_completed ?? 'N/A'}`,
    `- Created: ${d.tasks_created ?? 'N/A'}`,
    `- Pending: ${d.tasks_pending ?? 'N/A'}`,
    `- Total: ${d.total_tasks ?? 'N/A'}`,
    '',
    '## Search Performance',
    `- GSC Clicks: ${d.gsc_clicks ?? 'N/A'}`,
    `- GSC Impressions: ${d.gsc_impressions ?? 'N/A'}`,
    `- SERP Checks: ${d.serp_checks ?? 'N/A'}`,
    '',
    '## Keywords',
    `- Improved: ${d.keywords_improved ?? 'N/A'}`,
    `- Declined: ${d.keywords_declined ?? 'N/A'}`,
    '',
  ];
  if (d.notes) lines.push(`## Notes\n${d.notes}\n`);
  lines.push('---', `*Generated ${nowIso()}*`);
  return lines.join('\n');
}

function renderWeekly(data) {
  const d = data || {};
  const lines = [
    `# Weekly Report`,
    '',
    `Period: ${d.start_date || 'N/A'} â€” ${d.end_date || 'N/A'}`,
    '',
    '## Summary',
    `- Tasks Completed: ${d.tasks_completed ?? 'N/A'}`,
    `- Tasks Created: ${d.tasks_created ?? 'N/A'}`,
    `- Deployments: ${d.deployments ?? 'N/A'}`,
    '',
    '## Search Performance',
    `- GSC Clicks: ${d.gsc_clicks ?? 'N/A'}`,
    `- GSC Impressions: ${d.gsc_impressions ?? 'N/A'}`,
    `- Avg Position Î”: ${d.avg_position_delta ?? 'N/A'}`,
    '',
  ];
  if (d.highlights) lines.push(`## Highlights\n${d.highlights}\n`);
  lines.push('---', `*Generated ${nowIso()}*`);
  return lines.join('\n');
}

function renderAlert(data) {
  const d = data || {};
  const lines = [
    `# âš  Alert: ${d.severity || 'WARNING'}`,
    '',
    `**Type:** ${d.alert_type || d.type || 'system'}`,
    `**Severity:** ${d.severity || 'warning'}`,
    `**Time:** ${d.triggered_at || nowIso()}`,
    '',
    '## Message',
    d.message || 'No details provided.',
    '',
  ];
  if (d.recommended_action) {
    lines.push('## Recommended Action', d.recommended_action, '');
  }
  if (d.details) {
    lines.push('## Details', '```json', JSON.stringify(d.details, null, 2), '```', '');
  }
  lines.push('---', `*Generated ${nowIso()}*`);
  return lines.join('\n');
}

function renderCustom(data, title) {
  const d = data || {};
  const lines = [
    `# ${title || 'Report'}`,
    '',
    `Generated: ${nowIso()}`,
    '',
  ];

  for (const [key, value] of Object.entries(d)) {
    if (typeof value === 'object' && value !== null) {
      lines.push(`## ${key}`);
      lines.push('```json');
      lines.push(JSON.stringify(value, null, 2));
      lines.push('```');
      lines.push('');
    } else {
      lines.push(`- **${key}:** ${value}`);
    }
  }

  lines.push('', '---', `*Generated by {{SITE_NAME}} Agent*`);
  return lines.join('\n');
}

// Reviewable 12-hour work plan email. Negative-consent model: everything listed
// runs automatically unless the owner replies via Telegram to stop/modify it.
// Output stays within the markdownToHtml feature set (headings + bullet lists).
function renderWorkplan(data) {
  const d = data || {};
  const sessionRaw = String(d.session || '').toLowerCase();
  const session = sessionRaw === 'evening' ? 'Evening' : sessionRaw === 'morning' ? 'Morning' : (d.session || 'Daily');
  const window = d.window || d.window_label || 'next 12 hours';
  const health = String(d.health || 'unknown').toLowerCase();
  const healthIcon = health === 'green' ? 'ðŸŸ¢' : health === 'yellow' ? 'ðŸŸ¡' : health === 'red' ? 'ðŸ”´' : 'âšª';
  const planned = Array.isArray(d.planned) ? d.planned : [];
  const needsGo = Array.isArray(d.needs_explicit_go) ? d.needs_explicit_go : [];
  const alerts = Array.isArray(d.ranking_alerts) ? d.ranking_alerts : [];

  const laneLabel = {
    safe: 'Safe â€” auto-applied & deployed to production',
    semi: 'Semi-safe â€” built on a preview branch for your review',
    semi_safe: 'Semi-safe â€” built on a preview branch for your review',
    high: 'High-risk â€” reversible, will run unless you stop it',
    high_risk: 'High-risk â€” reversible, will run unless you stop it',
  };
  const laneOrder = ['safe', 'semi', 'semi_safe', 'high', 'high_risk'];

  const lines = [];
  lines.push(`# ${healthIcon} {{SITE_NAME}} Work Plan â€” ${session}`);
  lines.push('');
  lines.push(`**Window:** ${window}`);
  lines.push(`**System health:** ${health}`);
  lines.push(`**Planned actions:** ${planned.length}${needsGo.length ? ` (+${needsGo.length} awaiting your go-ahead)` : ''}`);
  lines.push('');

  lines.push('## âœ… How to review');
  lines.push('- Everything in **Planned actions** below runs **automatically** during this window.');
  lines.push('- To stop or change any item, reply on **Telegram** with the task ID, e.g. `stop TSK-...` or `change TSK-... to ...`.');
  lines.push('- Do nothing and the plan proceeds as listed. Safe items deploy live; semi-safe items wait on a preview branch.');
  lines.push('');

  // Group planned actions by lane
  const byLane = {};
  for (const t of planned) {
    const lane = String(t.lane || 'safe').toLowerCase();
    (byLane[lane] = byLane[lane] || []).push(t);
  }
  const seenLanes = laneOrder.filter((l) => byLane[l] && byLane[l].length);
  // include any lane keys not in laneOrder
  for (const l of Object.keys(byLane)) if (!seenLanes.includes(l)) seenLanes.push(l);

  if (planned.length === 0) {
    lines.push('## Planned actions');
    lines.push('- No actions planned this window. The system is monitoring only.');
    lines.push('');
  } else {
    for (const lane of seenLanes) {
      lines.push(`## ${laneLabel[lane] || lane}`);
      for (const t of byLane[lane]) {
        lines.push(`### ${t.id ? `${t.id} â€” ` : ''}${t.title || 'Untitled task'}`);
        if (t.target) lines.push(`- **Target:** ${t.target}`);
        if (t.action) lines.push(`- **Action:** ${t.action}`);
        if (t.why) lines.push(`- **Why:** ${t.why}`);
        if (t.when) lines.push(`- **When:** ${t.when}`);
        lines.push('');
      }
    }
  }

  if (needsGo.length > 0) {
    lines.push('## â›” Needs your explicit go-ahead (will NOT auto-run)');
    lines.push('These are irreversible or destructive, so silence is not approval. Reply `approve TSK-...` on Telegram to proceed.');
    lines.push('');
    for (const t of needsGo) {
      lines.push(`### ${t.id ? `${t.id} â€” ` : ''}${t.title || 'Untitled task'}`);
      if (t.target) lines.push(`- **Target:** ${t.target}`);
      if (t.action) lines.push(`- **Action:** ${t.action}`);
      if (t.why) lines.push(`- **Why:** ${t.why}`);
      lines.push('');
    }
  }

  if (alerts.length > 0) {
    lines.push('## ðŸ“‰ Ranking alerts');
    for (const a of alerts) {
      const text = typeof a === 'string' ? a : `${a.keyword || 'keyword'}: ${a.detail || a.message || JSON.stringify(a)}`;
      lines.push(`- ${text}`);
    }
    lines.push('');
  }

  if (d.notes) {
    lines.push('## Notes');
    lines.push(String(d.notes));
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated ${nowIso()} Â· {{SITE_NAME}} Agent Â· reply on Telegram to intervene*`);
  return lines.join('\n');
}

function markdownToHtml(md) {
  // Minimal markdown â†’ HTML conversion
  let html = md
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/```json\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/```\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>\n$1</ul>\n');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{{SITE_NAME}} Report</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;color:#333}
h1{color:#1a1a1a;border-bottom:2px solid #0066cc;padding-bottom:.5rem}
h2{color:#333;margin-top:1.5rem}
pre{background:#f4f4f4;padding:1rem;border-radius:4px;overflow-x:auto}
ul{padding-left:1.5rem}li{margin:.25rem 0}
hr{border:none;border-top:1px solid #ddd;margin:2rem 0}
</style></head><body>
${html}
</body></html>`;
}

module.exports = function reportFormat() {
  const args = parseArgs();

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    const sampleData = {
      tasks_completed: 5,
      tasks_created: 3,
      gsc_clicks: 120,
      gsc_impressions: 3500,
      notes: 'All systems operational.',
    };
    const md = renderDaily(sampleData);
    printOutput(envelope({
      template: 'daily',
      format: 'markdown',
      rendered: md,
    }, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    const template = args.template || 'custom';
    const outputFormat = args.format || (args.json ? 'json' : 'markdown');

    // Load data
    let data;
    if (args['data-file']) {
      const filePath = path.resolve(args['data-file']);
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } else {
      data = jsonArg(args, 'data', {});
    }

    if (!data || Object.keys(data).length === 0) {
      printOutput(errorEnvelope('No data provided. Use --data <json> or --data-file <path>', { tool: TOOL }), 'json');
      process.exitCode = 1;
      return;
    }

    // Render template
    let rendered;
    switch (template) {
      case 'daily':
        rendered = renderDaily(data);
        break;
      case 'weekly':
        rendered = renderWeekly(data);
        break;
      case 'alert':
        rendered = renderAlert(data);
        break;
      case 'workplan':
        rendered = renderWorkplan(data);
        break;
      case 'custom':
        rendered = renderCustom(data, args.title);
        break;
      default:
        printOutput(errorEnvelope(`Unknown template: ${template}. Use: daily, weekly, alert, workplan, custom`, { tool: TOOL }), 'json');
        process.exitCode = 1;
        return;
    }

    // Convert to requested format
    if (outputFormat === 'html') {
      const html = markdownToHtml(rendered);
      if (args.json) {
        printOutput(envelope({ template, format: 'html', rendered: html }, { tool: TOOL }), 'json');
      } else {
        console.log(html);
      }
    } else if (outputFormat === 'json') {
      printOutput(envelope({
        template,
        format: 'json',
        data,
        rendered,
      }, { tool: TOOL }), 'json');
    } else {
      // markdown
      if (args.json) {
        printOutput(envelope({ template, format: 'markdown', rendered }, { tool: TOOL }), 'json');
      } else {
        console.log(rendered);
      }
    }

  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
};

// Self-invoke only when run directly. When required through v2.js the router
// calls the exported function itself, so guarding here prevents a double run
// (which would emit the report twice and corrupt piped JSON/email output).
if (require.main === module) {
  module.exports();
}
