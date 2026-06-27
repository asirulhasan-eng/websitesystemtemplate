/**
 * email-send.js Ã¢â‚¬â€ Send email notifications
 *
 * Uses lib/smtp.js for direct SMTP delivery. Supports plain text and HTML bodies,
 * file-based content, and built-in templates.
 *
 * Usage:
 *   v2 email send --subject "Daily Report" --body "All systems green"
 *   v2 email send --subject "Alert" --body-file report.txt --priority high
 *   v2 email send --subject "Weekly" --template weekly --data '{"tasks":5}'
 *
 * Options:
 *   --to             Recipient email (default: owner@example.com)
 *   --subject        Required. Email subject line
 *   --body           Plain text body
 *   --body-file      Read body from file
 *   --html           HTML body content
 *   --html-file      Read HTML body from file
 *   --template       Use built-in template: daily, weekly, alert
 *   --data           JSON data for template rendering
 *   --priority       Priority: high, normal (default: normal)
 *   --from-name      Sender display name (default from env)
 *   --json           JSON output (default)
 *   --sample         Return sample data without sending
 *   --help           Show this help text
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, requireArg, jsonArg, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { loadToolEnv } = require('../lib/env');
const { nowIso } = require('../lib/dates');

const TOOL = 'email-send';
const DEFAULT_TO = 'owner@example.com';
const LEGACY_ADMIN_RECIPIENTS = new Set([
  'owner@example.com',
  'admin@ppumbingseo.agency',
]);

function normalizeRecipient(value) {
  const to = String(value || DEFAULT_TO).trim();
  return LEGACY_ADMIN_RECIPIENTS.has(to.toLowerCase()) ? DEFAULT_TO : to;
}

const HELP = `
email-send Ã¢â‚¬â€ Send email notifications via SMTP

USAGE
  v2 email send --subject <subject> [options]

REQUIRED
  --subject         Email subject line

OPTIONS
  --to              Recipient email address (default: owner@example.com)
  --body            Plain text body content
  --body-file       Read plain text body from a file path
  --html            HTML body content (inline)
  --html-file       Read HTML body from a file path
  --template        Use built-in template: daily | weekly | alert
  --data            JSON string with data for template rendering
  --priority        Email priority: high | normal (default: normal)
  --from-name       Sender display name (default from env: Website Operations Agent)
  --json            JSON output (default)
  --sample          Return sample response without actually sending
  --help            Show this help text

EXAMPLES
  v2 email send --subject "Daily SEO Report" --body "All systems green, 5 tasks completed"
  v2 email send --subject "Critical Alert" --body-file /tmp/alert.txt --priority high
  v2 email send --subject "Weekly Summary" --template weekly --data '{"tasks_completed":12,"keywords_improved":3}'
  v2 email send --to team@example.com --subject "Test" --body "Hello" --sample

TEMPLATES
  daily   Ã¢â‚¬â€ Formatted daily activity summary
  weekly  Ã¢â‚¬â€ Week-over-week comparison with metrics
  alert   Ã¢â‚¬â€ Urgent alert with severity and recommended actions

ENVIRONMENT VARIABLES
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_USE_TLS
  EMAIL_FROM, EMAIL_FROM_NAME
`.trim();

// Derive a plain-text fallback from HTML so multipart/alternative always has
// a text part (some clients and spam filters require one).
function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Simple template engine
function renderTemplate(templateName, data) {
  const d = data || {};

  switch (templateName) {
    case 'daily':
      return {
        text: [
          `Website Operations Daily Report Ã¢â‚¬â€ ${d.date || new Date().toISOString().slice(0, 10)}`,
          'Ã¢â€¢Â'.repeat(50),
          '',
          `Tasks Completed: ${d.tasks_completed ?? 'N/A'}`,
          `Tasks Created:   ${d.tasks_created ?? 'N/A'}`,
          `Tasks Pending:   ${d.tasks_pending ?? 'N/A'}`,
          '',
          `Keywords Improved: ${d.keywords_improved ?? 'N/A'}`,
          `Keywords Declined: ${d.keywords_declined ?? 'N/A'}`,
          '',
          `GSC Clicks (today):      ${d.gsc_clicks ?? 'N/A'}`,
          `GSC Impressions (today): ${d.gsc_impressions ?? 'N/A'}`,
          '',
          d.notes ? `Notes:\n${d.notes}` : '',
          '',
          'Ã¢â‚¬â€ Website Operations Agent',
        ].filter(l => l !== undefined).join('\n'),
      };

    case 'weekly':
      return {
        text: [
          `Website Operations Weekly Report`,
          'Ã¢â€¢Â'.repeat(50),
          '',
          `Period: ${d.start_date || 'N/A'} Ã¢â‚¬â€ ${d.end_date || 'N/A'}`,
          '',
          `Tasks Completed:   ${d.tasks_completed ?? 'N/A'}`,
          `Tasks Created:     ${d.tasks_created ?? 'N/A'}`,
          `Deployments:       ${d.deployments ?? 'N/A'}`,
          '',
          `Keywords Tracked:  ${d.keywords_tracked ?? 'N/A'}`,
          `Avg Position ÃŽâ€:    ${d.avg_position_delta ?? 'N/A'}`,
          `Top Movers:        ${d.top_movers ?? 'N/A'}`,
          '',
          `GSC Clicks (week):       ${d.gsc_clicks ?? 'N/A'}`,
          `GSC Impressions (week):  ${d.gsc_impressions ?? 'N/A'}`,
          '',
          d.highlights ? `Highlights:\n${d.highlights}` : '',
          '',
          'Ã¢â‚¬â€ Website Operations Agent',
        ].filter(l => l !== undefined).join('\n'),
      };

    case 'alert':
      return {
        text: [
          `Ã¢Å¡Â  Website Operations Alert: ${d.severity || 'WARNING'}`,
          'Ã¢â€¢Â'.repeat(50),
          '',
          `Alert Type: ${d.alert_type || 'system'}`,
          `Severity:   ${d.severity || 'warning'}`,
          `Time:       ${d.triggered_at || nowIso()}`,
          '',
          `Message:`,
          d.message || 'No details provided',
          '',
          d.recommended_action ? `Recommended Action:\n${d.recommended_action}` : '',
          '',
          'Ã¢â‚¬â€ Website Operations Agent (automated alert)',
        ].filter(l => l !== undefined).join('\n'),
      };

    default:
      throw new Error(`Unknown template: ${templateName}. Use: daily, weekly, alert`);
  }
}

module.exports = async function emailSend() {
  const args = parseArgs();

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    printOutput(envelope({
      sent: true,
      to: normalizeRecipient(args.to),
      subject: args.subject || 'Sample Subject',
      priority: args.priority || 'normal',
      template: args.template || null,
      sent_at: nowIso(),
      message: 'Sample mode Ã¢â‚¬â€ email not actually sent',
    }, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    const subject = requireArg(args, 'subject', 'Missing --subject');
    const to = normalizeRecipient(args.to);
    const priority = args.priority || 'normal';

    // Resolve body content
    let bodyText = args.body || '';
    if (args['body-file']) {
      bodyText = fs.readFileSync(path.resolve(args['body-file']), 'utf8');
    }

    // Resolve HTML content (inline or file)
    let bodyHtml = args.html || '';
    if (args['html-file']) {
      bodyHtml = fs.readFileSync(path.resolve(args['html-file']), 'utf8');
    }

    // Template rendering
    if (args.template) {
      const templateData = jsonArg(args, 'data', {});
      const rendered = renderTemplate(args.template, templateData);
      bodyText = rendered.text;
      if (rendered.html) bodyHtml = rendered.html;
    }

    if (!bodyText && !bodyHtml) {
      printOutput(errorEnvelope('No body content. Provide --body, --body-file, --html, --html-file, or --template with --data', { tool: TOOL }), 'json');
      process.exitCode = 1;
      return;
    }

    // Load SMTP credentials
    const config = loadToolEnv();
    const { smtpCredentials } = require('../lib/email_credentials');
    const creds = smtpCredentials(config);
    const { sendSmtpMail } = require('../lib/smtp');

    const message = {
      to,
      subject: priority === 'high' ? `[URGENT] ${subject}` : subject,
      text: bodyText || htmlToText(bodyHtml),
      fromName: args['from-name'] || creds.fromName,
    };
    if (bodyHtml) message.html = bodyHtml;

    await sendSmtpMail({
      host: creds.host,
      port: creds.port,
      secure: creds.secure,
      user: creds.user,
      pass: creds.pass,
      from: creds.from,
      message,
    });

    printOutput(envelope({
      sent: true,
      to,
      subject: message.subject,
      priority,
      template: args.template || null,
      content_type: bodyHtml ? 'multipart/alternative' : 'text/plain',
      sent_at: nowIso(),
      body_length: (message.text || '').length,
      html_length: bodyHtml.length,
    }, { tool: TOOL }), getOutputFormat(args));

  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}