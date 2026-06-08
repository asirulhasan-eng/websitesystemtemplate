/**
 * email-check.js â€” Check inbox for approvals/replies via IMAP
 *
 * Usage:
 *   v2 email check --json
 *   v2 email check --days 3 --from {{ADMIN_EMAIL}}
 *   v2 email check --subject-contains "approve" --unread-only
 *
 * Options:
 *   --days             Look back N days (default: 1)
 *   --from             Filter by sender email address
 *   --subject-contains Filter by subject substring
 *   --unread-only      Only show unread messages (default: false)
 *   --limit            Max messages to return (default: 50)
 *   --mark-read        Mark retrieved messages as read
 *   --json             JSON output (default)
 *   --table            Table output
 *   --csv              CSV output
 *   --sample           Return sample data without IMAP connection
 *   --help             Show this help text
 */

const { parseArgs, numberArg, boolArg, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { loadToolEnv } = require('../lib/env');
const { nowIso, daysAgo } = require('../lib/dates');

const TOOL = 'email-check';

const HELP = `
email-check â€” Check inbox for approvals and replies via IMAP

USAGE
  v2 email check [options]

OPTIONS
  --days              Look back N days for messages (default: 1)
  --from              Filter messages by sender email address
  --subject-contains  Filter by subject line substring
  --unread-only       Only return unread/unseen messages
  --limit             Maximum messages to return (default: 50)
  --mark-read         Mark retrieved messages as read
  --json              JSON output (default)
  --table             Table output
  --csv               CSV output
  --sample            Return sample data without connecting to IMAP
  --help              Show this help text

EXAMPLES
  v2 email check --json
  v2 email check --days 3 --from admin@example.com --table
  v2 email check --subject-contains "approve" --unread-only
  v2 email check --days 7 --mark-read --json

ENVIRONMENT VARIABLES
  IMAP_HOST (default: imap.gmail.com)
  IMAP_PORT (default: 993)
  IMAP_USER (falls back to SMTP_USER)
  IMAP_PASS (falls back to SMTP_PASS)

OUTPUT
  Each message includes: from, to, subject, date, body_preview, message_id,
  has_approval_token (detected if body contains approval patterns).
`.trim();

module.exports = async function emailCheck() {
  const args = parseArgs();

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    const sampleMessages = [
      {
        from: '{{ADMIN_EMAIL}}',
        to: 'agent@{{DOMAIN}}',
        subject: 'Re: [Approval Required] Update meta tags for /services/{{NICHE}}',
        date: '2026-06-03T10:00:00.000Z',
        body_preview: 'APPROVED â€” go ahead with the changes.',
        message_id: '<sample1@{{DOMAIN}}>',
        has_approval_token: true,
        is_approval: true,
      },
      {
        from: '{{ADMIN_EMAIL}}',
        to: 'agent@{{DOMAIN}}',
        subject: 'Re: Daily SEO Report',
        date: '2026-06-03T08:00:00.000Z',
        body_preview: 'Looks good, keep it up.',
        message_id: '<sample2@{{DOMAIN}}>',
        has_approval_token: false,
        is_approval: false,
      },
    ];
    printOutput(envelope({
      messages: sampleMessages,
      count: sampleMessages.length,
      search_criteria: { days: 1, unread_only: false },
    }, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    const days = numberArg(args, 'days', 1);
    const fromFilter = args.from || null;
    const subjectContains = args['subject-contains'] || null;
    const unreadOnly = boolArg(args, 'unread-only');
    const maxMessages = numberArg(args, 'limit', 50);
    const markRead = boolArg(args, 'mark-read');

    // Load IMAP credentials
    const config = loadToolEnv();
    const { imapCredentials } = require('../lib/email_credentials');
    const creds = imapCredentials(config);
    const { ImapClient } = require('../lib/imap');
    const { parseHeaders, normalizeEmail } = require('../lib/email');

    const client = new ImapClient(creds);
    await client.connect();

    try {
      await client.select('INBOX');

      // Build IMAP search criteria
      const sinceDate = daysAgo(days);
      const formattedDate = new Date(`${sinceDate}T00:00:00Z`).toUTCString().replace(/\d{2}:\d{2}:\d{2}\s+\w+$/, '').trim();
      let criteria = `SINCE "${formattedDate}"`;
      if (unreadOnly) criteria += ' UNSEEN';
      if (fromFilter) criteria += ` FROM "${fromFilter}"`;

      const ids = await client.search(criteria);

      if (ids.length === 0) {
        printOutput(envelope({
          messages: [],
          count: 0,
          search_criteria: { days, from: fromFilter, subject_contains: subjectContains, unread_only: unreadOnly },
        }, { tool: TOOL }), getOutputFormat(args));
        return;
      }

      // Fetch limited set
      const fetchIds = ids.slice(-maxMessages);
      const bodies = await client.fetchBodies(fetchIds, markRead);

      // Parse messages
      const messages = [];
      for (const raw of bodies) {
        const headers = parseHeaders(raw);
        const subject = headers.subject || '(no subject)';

        // Apply subject filter
        if (subjectContains && !subject.toLowerCase().includes(subjectContains.toLowerCase())) {
          continue;
        }

        // Apply from filter (double-check since IMAP search is approximate)
        if (fromFilter) {
          const senderEmail = normalizeEmail(headers.from || '');
          if (!senderEmail.includes(fromFilter.toLowerCase())) continue;
        }

        // Extract body text (first 500 chars after headers)
        const bodyParts = raw.split(/\r?\n\r?\n/);
        const bodyText = bodyParts.slice(1).join('\n\n').trim();
        const bodyPreview = bodyText.slice(0, 500);

        // Detect approval patterns
        const approvalPatterns = /\b(APPROVED?|LGTM|GO AHEAD|PROCEED|YES|CONFIRM(ED)?)\b/i;
        const hasApproval = approvalPatterns.test(bodyText);

        messages.push({
          from: headers.from || '',
          to: headers.to || '',
          subject,
          date: headers.date || '',
          body_preview: bodyPreview,
          message_id: headers['message-id'] || '',
          has_approval_token: hasApproval,
          is_approval: hasApproval,
        });
      }

      // Note: fetchBodies already handles markSeen when markRead=true

      const fmt = getOutputFormat(args);
      if (fmt === 'json') {
        printOutput(envelope({
          messages,
          count: messages.length,
          total_matching_ids: ids.length,
          search_criteria: { days, from: fromFilter, subject_contains: subjectContains, unread_only: unreadOnly },
        }, { tool: TOOL }), fmt);
      } else {
        printOutput(messages, fmt);
      }

    } finally {
      await client.logout();
    }

  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}