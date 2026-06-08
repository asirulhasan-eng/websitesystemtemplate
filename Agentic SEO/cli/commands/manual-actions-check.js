#!/usr/bin/env node
/**
 * manual-actions-check.js - Normalize Google Search Console manual action checks.
 *
 * Search Console exposes Manual Actions as a report/UI surface, not as a
 * public Search Console API method. This command makes that dependency explicit
 * and can normalize exported evidence when provided.
 */
const fs = require('node:fs');
const { parseArgs, boolArg, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { loadToolEnv } = require('../lib/env');

const TOOL = 'manual-actions-check';

function main() {
  const args = parseArgs();
  if (args.help || args.h) { printHelp(); return; }

  try {
    const config = loadToolEnv({ cwd: args.cwd, envPath: args.env });
    const siteUrl = args['site-url'] || config.get('GSC_SITE_URL') || 'sc-domain:{{DOMAIN}}';

    let result;
    if (boolArg(args, 'sample')) {
      result = normalizeReport(sampleReport(args.state || 'clear'), siteUrl, 'sample');
    } else if (args['from-file']) {
      const parsed = JSON.parse(fs.readFileSync(args['from-file'], 'utf8'));
      result = normalizeReport(parsed, siteUrl, 'file');
    } else {
      result = unverifiedResult(siteUrl);
    }

    printOutput(envelope(result, { tool: TOOL }), getOutputFormat(args));
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
}

function normalizeReport(data, siteUrl, source) {
  const manualActions = data.manual_actions || data.manualActions || data.actions || data.issues || [];
  const hasManualActions = data.has_manual_actions !== undefined
    ? Boolean(data.has_manual_actions)
    : manualActions.length > 0;

  return {
    site_url: data.site_url || data.siteUrl || siteUrl,
    source,
    automated: false,
    public_api_available: false,
    checked: true,
    status: hasManualActions ? 'manual_action_present' : 'clear',
    has_manual_actions: hasManualActions,
    manual_actions: manualActions,
    blocking: hasManualActions,
    manual_followup_required: hasManualActions,
    report_url: reportUrl(siteUrl),
    notes: [
      'Google documents Manual Actions as a Search Console report and message-center notification, not as a public Search Console API method.',
      'Use --from-file to normalize exported evidence, or verify directly in the GSC Manual Actions report.',
    ],
  };
}

function unverifiedResult(siteUrl) {
  return {
    site_url: siteUrl,
    source: 'gsc_ui_required',
    automated: false,
    public_api_available: false,
    checked: false,
    status: 'requires_gsc_ui_verification',
    has_manual_actions: null,
    manual_actions: [],
    blocking: true,
    manual_followup_required: true,
    report_url: reportUrl(siteUrl),
    notes: [
      'No public Search Console API method is available for the Manual Actions report.',
      'Open the report URL and record whether actions are present before continuing emergency diagnosis.',
    ],
  };
}

function sampleReport(state) {
  if (String(state).toLowerCase() === 'action') {
    return {
      has_manual_actions: true,
      manual_actions: [
        {
          type: 'site_reputation_abuse',
          scope: 'partial',
          affected_patterns: ['https://{{DOMAIN}}/blog/*'],
          detected_at: '2026-06-03',
        },
      ],
    };
  }
  return { has_manual_actions: false, manual_actions: [] };
}

function reportUrl(siteUrl) {
  return `https://search.google.com/search-console/manual-actions?resource_id=${encodeURIComponent(siteUrl)}`;
}

function printHelp() {
  console.log(`
manual-actions-check - Normalize GSC Manual Actions report evidence

Usage:
  v2 manual-actions-check --json
  v2 manual-actions-check --from-file manual-actions.json --json

Inputs:
  --site-url <property>    GSC property, e.g. sc-domain:{{DOMAIN}}.
  --env <path>             Env file used to read GSC_SITE_URL.
  --from-file <path>       JSON export/manual record with manual_actions/actions/issues.
  --sample                 Use built-in sample data.
  --state clear|action     Sample state (default: clear).

Output:
  --json                   JSON output (default).
  --table                  Table output.

Important:
  Google does not expose a public Search Console API method for this report.
  Without --from-file/--sample, this tool returns checked=false and a GSC URL
  that must be verified manually.
`);
}

if (require.main === module) {
  main();
}
module.exports = main;
