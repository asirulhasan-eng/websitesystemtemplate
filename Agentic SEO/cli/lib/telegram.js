/**
 * telegram.js â€” Send proactive Telegram messages via the Bot API.
 *
 * The Hermes Gateway uses a Telegram bot for owner approvals (the owner sends
 * `approve <id>` / `stop <id>` to it). This helper lets the CLI push messages
 * the OTHER way â€” bot â†’ owner â€” so cron jobs can notify the owner without email.
 *
 * Reuses the gateway's bot token (TELEGRAM_BOT_TOKEN) and needs a destination
 * chat id (TELEGRAM_CHAT_ID â€” the owner's chat with the bot).
 *
 * Telegram caps a single message at 4096 chars; we split on line boundaries so a
 * long audit report arrives as a few sequential messages rather than being cut.
 */

const TELEGRAM_API = 'https://api.telegram.org';
const MAX_MESSAGE_CHARS = 4096;

function resolveTelegramConfig(config) {
  const token = config.get('TELEGRAM_BOT_TOKEN');
  const chatId = config.get('TELEGRAM_CHAT_ID') || config.get('TELEGRAM_ADMIN_CHAT_ID');
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN (set it in ~/.hermes/.env or the agent .env).');
  if (!chatId) throw new Error('Missing TELEGRAM_CHAT_ID (the owner chat id the bot should message).');
  return { token, chatId: String(chatId) };
}

// Split text into <=4096-char chunks, preferring line boundaries so formatting
// (and Markdown) survives. A single over-long line is hard-split as a fallback.
function splitForTelegram(text, limit = MAX_MESSAGE_CHARS) {
  const chunks = [];
  let current = '';
  for (const line of String(text).split('\n')) {
    if (line.length > limit) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
      continue;
    }
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > limit) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [''];
}

/**
 * Send a Telegram message (auto-split into multiple messages if long).
 * @param {object} opts
 * @param {string} opts.token   Bot token
 * @param {string} opts.chatId  Destination chat id
 * @param {string} opts.text    Message body
 * @param {string} [opts.parseMode]  'Markdown' | 'HTML' | undefined
 * @param {boolean} [opts.disablePreview]  Suppress link previews (default true)
 * @returns {Promise<{messageIds:number[], parts:number}>}
 */
async function sendTelegramMessage({ token, chatId, text, parseMode, disablePreview = true }) {
  const parts = splitForTelegram(text);
  const messageIds = [];
  for (const part of parts) {
    const payload = {
      chat_id: chatId,
      text: part,
      disable_web_page_preview: disablePreview,
    };
    if (parseMode) payload.parse_mode = parseMode;

    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      const detail = body.description || `HTTP ${res.status}`;
      throw new Error(`Telegram sendMessage failed: ${detail}`);
    }
    messageIds.push(body.result && body.result.message_id);
  }
  return { messageIds, parts: parts.length };
}

module.exports = { resolveTelegramConfig, sendTelegramMessage, splitForTelegram };
