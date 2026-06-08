/**
 * notify-telegram.js â€” Push a Telegram message to the owner.
 *
 * Bot â†’ owner notifications (the reverse of the gateway's owner â†’ bot approvals).
 * Used by cron jobs (e.g. the Self-Evaluation Auditor) to notify the owner
 * without sending email. Reuses the Hermes gateway bot token.
 *
 * Usage:
 *   v2 notify telegram --text "Audit complete â€” Grade A"
 *   v2 notify telegram --body-file /tmp/audit.md --markdown
 *   v2 notify telegram --text "..." --chat-id 123456789
 *
 * Options:
 *   --text          Message body (inline)
 *   --body-file     Read message body from a file path
 *   --markdown      Send with Telegram Markdown parse mode
 *   --html          Send with Telegram HTML parse mode
 *   --chat-id       Override destination chat id (default: TELEGRAM_CHAT_ID)
 *   --preview       Allow link previews (default: suppressed)
 *   --json          JSON output (default)
 *   --sample        Validate config without sending
 *   --help          Show this help text
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { loadToolEnv } = require('../lib/env');
const { nowIso } = require('../lib/dates');
const { resolveTelegramConfig, sendTelegramMessage } = require('../lib/telegram');

const TOOL = 'notify-telegram';

const HELP = `
notify-telegram â€” Push a Telegram message to the owner

USAGE
  v2 notify telegram --text <message> [options]

REQUIRED (one of)
  --text            Message body (inline)
  --body-file       Read message body from a file path

OPTIONS
  --markdown        Use Telegram Markdown parse mode
  --html            Use Telegram HTML parse mode
  --chat-id         Override destination chat id (default: env TELEGRAM_CHAT_ID)
  --preview         Allow link previews (default: suppressed)
  --json            JSON output (default)
  --sample          Validate token/chat config without sending
  --help            Show this help text

ENVIRONMENT VARIABLES
  TELEGRAM_BOT_TOKEN   Bot token (shared with the Hermes gateway)
  TELEGRAM_CHAT_ID     Owner chat id the bot should message
`.trim();

module.exports = async function notifyTelegram() {
  const args = parseArgs();

  if (args.help) {
    console.log(HELP);
    return;
  }

  try {
    const config = loadToolEnv();
    const { token, chatId } = resolveTelegramConfig(config);
    const destination = args['chat-id'] ? String(args['chat-id']) : chatId;

    if (args.sample) {
      printOutput(envelope({
        sent: false,
        chat_id: destination,
        has_token: Boolean(token),
        message: 'Sample mode â€” Telegram config resolved, message not sent',
      }, { tool: TOOL }), getOutputFormat(args));
      return;
    }

    let text = args.text || '';
    if (args['body-file']) {
      text = fs.readFileSync(path.resolve(args['body-file']), 'utf8');
    }
    if (!text || !String(text).trim()) {
      printOutput(errorEnvelope('No message content. Provide --text or --body-file.', { tool: TOOL }), 'json');
      process.exitCode = 1;
      return;
    }

    const parseMode = args.markdown ? 'Markdown' : (args.html ? 'HTML' : undefined);

    const result = await sendTelegramMessage({
      token,
      chatId: destination,
      text,
      parseMode,
      disablePreview: !args.preview,
    });

    printOutput(envelope({
      sent: true,
      chat_id: destination,
      parts: result.parts,
      message_ids: result.messageIds,
      parse_mode: parseMode || 'none',
      body_length: String(text).length,
      sent_at: nowIso(),
    }, { tool: TOOL }), getOutputFormat(args));

  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
};

if (require.main === module) {
  module.exports();
}
