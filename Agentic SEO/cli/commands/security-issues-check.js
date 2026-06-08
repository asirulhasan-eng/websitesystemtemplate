#!/usr/bin/env node
/**
 * security-issues-check.js - Normalize Google Search Console security checks.
 *
 * Search Console exposes Security Issues as a report/UI surface, not as a
 * public Search Console API method. This command makes that dependency explicit
 * and can normalize exported evidence when provided.
 */
const fs = require('node:fs');
const { parseArgs, boolArg, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { loadToolEnv } = require('../lib/env');

const TOOL = 'security-issues-check';

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
  const securityIssues = data.security_issues || data.securityIssues || data.issues || [];
  const hasSecurityIssues = data.has_security_issues !== undefined
    ? Boolean(data.has_security_issues)
    : securityIssues.length > 0;

  return {
    site_url: data.site_url || data.siteUrl || siteUrl,
    source,
    automated: false,
    public_api_available: false,
    checked: true,
    status: hasSecurityIssues ? 'security_issue_present' : 'clear',
    has_security_issues: hasSecurityIssues,
    security_issues: securityIssues,
    blocking: hasSecurityIssues,
    manual_followup_required: hasSecurityIssues,
    report_url: reportUrl(siteUrl),
    notes: [
      'Google documents Security Issues as a Search Console report, not as a public Search Console API method.',
      'Use --from-file to normalize exported evidence, or verify directly in the GSC Security Issues report.',
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
    has_security_issues: null,
    security_issues: [],
    blocking: true,
    manual_followup_required: true,
    report_url: reportUrl(siteUrl),
    notes: [
      'No public Search Console API method is available for the Security Issues report.',
      'Open the report URL and record whether issues are present before continuing emergency diagnosis.',
    ],
  };
}

function sampleReport(state) {
  if (String(state).toLowerCase() === 'issue') {
    return {
      has_security_issues: true,
      security_issues: [
        {
          type: 'hacked_content',
          scope: 'partial',
          affected_patterns: ['https://{{DOMAIN}}/*'],
          detected_at: '2026-06-03',
        },
      ],
    };
  }
  return { has_security_issues: false, security_issues: [] };
}

function reportUrl(siteUrl) {
  return `https://search.google.com/search-console/security-issues?resource_id=${encodeURIComponent(siteUrl)}`;
}

function printHelp() {
  console.log(`
security-issues-check - Normalize GSC Security Issues report evidence

Usage:
  v2 security-issues-check --json
  v2 security-issues-check --from-file security-issues.json --json

Inputs:
  --site-url <property>    GSC property, e.g. sc-domain:{{DOMAIN}}.
  --env <path>             Env file used to read GSC_SITE_URL.
  --from-file <path>       JSON export/manual record with security_issues/issues.
  --sample                 Use built-in sample data.
  --state clear|issue      Sample state (default: clear).

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
